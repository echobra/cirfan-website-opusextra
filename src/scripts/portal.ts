// src/scripts/portal.ts
// Client delivery page. The sign-in itself lives in an HttpOnly cookie set by /api/portal; this script never
// sees or stores the session token. Clicks on anything marked data-track, preview plays and every download
// (completed or failed) are reported to the activity log.

type Delivery = {
  id: string;
  folder_id: string | null;
  file_name: string;
  kind: 'video' | 'image';
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  archived_at: string | null;
  created_at: string;
  previewUrl: string;
};
type ApiError = Error & { status?: number; body?: Record<string, unknown> };

const root = document.querySelector<HTMLElement>('[data-portal]');
const id = location.pathname.split('/').filter(Boolean)[1] ?? '';

const views = Array.from(document.querySelectorAll<HTMLElement>('[data-view]'));
const show = (name: string) => views.forEach((v) => v.toggleAttribute('hidden', v.dataset.view !== name));

async function api<T = Record<string, unknown>>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/portal', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id, ...data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(String(body.error ?? body.state ?? res.status)) as ApiError;
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body as T;
}

const track = (event: string, detail: Record<string, string | number | boolean> = {}) => {
  fetch('/api/portal', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'track', id, event, detail }),
  }).catch(() => {});
};

const size = (bytes: number) => (bytes > 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// ---------- Password forms ----------
let minPassword = 10;

document.querySelectorAll<HTMLInputElement>('[data-show-password]').forEach((box) => {
  box.addEventListener('change', () => {
    box.closest('form')?.querySelectorAll<HTMLInputElement>('input[name="password"], input[name="confirm"]').forEach((input) => {
      input.type = box.checked ? 'text' : 'password';
    });
  });
});

const setupForm = document.querySelector<HTMLFormElement>('[data-view="setup"]')!;
const loginForm = document.querySelector<HTMLFormElement>('[data-view="login"]')!;
const errorIn = (form: HTMLFormElement, message: string) => {
  form.querySelector<HTMLElement>('[data-error]')!.textContent = message;
};

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(setupForm);
  const password = String(data.get('password') ?? '');
  if (password.length < minPassword) return errorIn(setupForm, `Use at least ${minPassword} characters.`);
  if (password !== String(data.get('confirm') ?? '')) return errorIn(setupForm, 'The two passwords don’t match.');
  try {
    await api('setup', { password });
    setupForm.reset();
    await openFiles();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 409) {
      errorIn(setupForm, 'A password was already created for this page. Sign in instead.');
      show('login');
    } else errorIn(setupForm, 'That didn’t work. Try again in a moment.');
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = String(new FormData(loginForm).get('password') ?? '');
  if (!password) return errorIn(loginForm, 'Enter the password.');
  try {
    await api('login', { password });
    loginForm.reset();
    errorIn(loginForm, '');
    await openFiles();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 429) show('locked');
    else if (err.status === 401) errorIn(loginForm, 'That password isn’t right.');
    else errorIn(loginForm, 'That didn’t work. Try again in a moment.');
  }
});

// ---------- Files, folders, archive ----------
type Folder = { id: string; name: string; archived_at: string | null; created_at: string };
type View = { tab: 'files' | 'archive'; folder: string | null };

const data: { folders: Folder[]; files: Delivery[] } = { folders: [], files: [] };
let view: View = { tab: 'files', folder: null };

async function download(file: Delivery, button: HTMLButtonElement, status: HTMLElement) {
  button.disabled = true;
  status.textContent = 'Preparing';
  const started = performance.now();
  try {
    const { url, fileName, size: expected } = await api<{ url: string; fileName: string; size: number }>('download', { fileId: file.id });
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`storage responded ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      status.textContent = `Downloading ${Math.floor((received / expected) * 100)}%`;
    }
    if (received !== expected) throw new Error(`incomplete (${received} of ${expected} bytes)`);
    saveBlob(new Blob(chunks, { type: file.content_type }), fileName);
    status.textContent = 'Downloaded';
    track('download_completed', { file: fileName, file_id: file.id, bytes: received, seconds: Math.round((performance.now() - started) / 100) / 10 });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      show('login');
      return;
    }
    status.textContent = 'Download failed. Try again.';
    track('download_failed', { file: file.file_name, file_id: file.id, reason: String(err.message).slice(0, 150) });
  } finally {
    button.disabled = false;
  }
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const zipName = (name: string) => `${name.replace(/[^\w.\- ]+/g, '').trim() || 'cirfan-files'}.zip`;

// Downloads a whole folder as one ZIP. Files are streamed into the ZIP one by one (stored, not recompressed:
// videos and images are already compressed). On Chrome and Edge the ZIP is written straight to disk, so even
// large folders don't fill memory; other browsers build it in memory first.
async function downloadFolder(folder: Folder, button: HTMLButtonElement, status: HTMLElement) {
  button.disabled = true;
  const started = performance.now();
  const picker = (window as Window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  let handle: FileSystemFileHandle | null = null;
  try {
    if (picker) {
      try {
        handle = await picker({ suggestedName: zipName(folder.name), types: [{ description: 'ZIP file', accept: { 'application/zip': ['.zip'] } }] });
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          status.textContent = 'Cancelled';
          return;
        }
      }
    }
    status.textContent = 'Preparing';
    const { files } = await api<{ files: { id: string; fileName: string; size: number; createdAt: string; url: string }[] }>('download-folder', {
      folderId: folder.id,
    });
    if (!files.length) throw new Error('folder is empty');
    const { downloadZip, makeZip } = await import('client-zip');
    const used = new Map<string, number>();
    const unique = (name: string) => {
      const n = used.get(name) ?? 0;
      used.set(name, n + 1);
      return n ? name.replace(/(\.[^.]+)?$/, ` (${n + 1})$1`) : name;
    };
    let added = 0;
    let bytes = 0;
    async function* entries() {
      for (const f of files) {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`${f.fileName}: storage responded ${res.status}`);
        added++;
        bytes += f.size;
        status.textContent = `Adding ${added} of ${files.length}`;
        yield { name: unique(f.fileName), input: res, size: f.size, lastModified: new Date(f.createdAt) };
      }
    }
    if (handle) {
      await makeZip(entries()).pipeTo(await handle.createWritable());
    } else {
      saveBlob(await downloadZip(entries()).blob(), zipName(folder.name));
    }
    status.textContent = `Downloaded ${files.length} files. See below for how to open the ZIP.`;
    track('zip_completed', {
      folder: folder.name,
      files: files.length,
      bytes,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      method: handle ? 'saved_to_disk' : 'browser_download',
    });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      show('login');
      return;
    }
    status.textContent = 'ZIP download failed. Try again, or download files one by one.';
    track('zip_failed', { folder: folder.name, reason: String(err.message).slice(0, 150) });
  } finally {
    button.disabled = false;
  }
}

function contactLine(method: string, detail: string) {
  const email = root?.dataset.email ?? '';
  if (method === 'slack') return `Questions or feedback? Use your private Slack channel${detail ? ` (${detail})` : ''}.`;
  return `Questions or feedback? Email ${email}.`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const folderById = (id: string | null) => data.folders.find((f) => f.id === id) ?? null;

function fileCard(file: Delivery) {
  const tpl = document.querySelector<HTMLTemplateElement>('#tpl-delivery')!;
  const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  const media = li.querySelector('.delivery__media')!;
  if (file.kind === 'video') {
    const video = document.createElement('video');
    video.src = file.previewUrl;
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    if (file.width && file.height) {
      video.width = file.width;
      video.height = file.height;
    }
    video.setAttribute('controlslist', 'nodownload');
    for (const type of ['play', 'pause', 'ended'] as const) {
      video.addEventListener(type, () => track(`video_${type}`, { file: file.file_name, at: Math.round(video.currentTime) }));
    }
    video.addEventListener('error', () => track('preview_failed', { file: file.file_name }), { once: true });
    media.append(video);
  } else {
    const img = document.createElement('img');
    img.src = file.previewUrl;
    img.alt = file.file_name;
    img.loading = 'lazy';
    if (file.width && file.height) {
      img.width = file.width;
      img.height = file.height;
    }
    img.addEventListener('error', () => track('preview_failed', { file: file.file_name }), { once: true });
    media.append(img);
  }
  li.querySelector('.delivery__name')!.textContent = file.file_name;
  li.querySelector('.delivery__meta')!.textContent = `${file.kind === 'video' ? 'Video' : 'Image'}, ${size(file.size_bytes)}, added ${date.format(new Date(file.created_at))}`;
  const button = li.querySelector<HTMLButtonElement>('button')!;
  button.dataset.track = 'download';
  button.dataset.trackFile = file.file_name;
  button.addEventListener('click', () => download(file, button, li.querySelector<HTMLElement>('.delivery__status')!));
  return li;
}

function folderCard(folder: Folder) {
  const tpl = document.querySelector<HTMLTemplateElement>('#tpl-folder')!;
  const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  const count = data.files.filter((f) => f.folder_id === folder.id).length;
  li.querySelector('.folder__name')!.textContent = folder.name;
  li.querySelector('.folder__meta')!.textContent = `${plural(count, 'file')}, added ${date.format(new Date(folder.created_at))}`;
  const button = li.querySelector<HTMLButtonElement>('button')!;
  button.dataset.track = 'open_folder';
  button.dataset.trackFile = folder.name;
  button.addEventListener('click', () => go({ tab: view.tab, folder: folder.id }));
  return li;
}

function render() {
  const folder = folderById(view.folder);
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === view.tab)));
  const archivedCount = data.folders.filter((f) => f.archived_at).length + data.files.filter((f) => f.archived_at && !folderById(f.folder_id)?.archived_at).length;
  document.querySelector<HTMLButtonElement>('[data-tab="archive"]')!.textContent = archivedCount ? `Archive (${archivedCount})` : 'Archive';

  const head = document.querySelector<HTMLElement>('[data-folder-head]')!;
  head.hidden = !folder;
  let folders: Folder[] = [];
  let files: Delivery[];
  if (folder) {
    document.querySelector('[data-folder-title]')!.textContent = folder.name;
    document.querySelector('[data-back]')!.textContent = view.tab === 'archive' ? 'Archive' : 'All files';
    files = data.files.filter((f) => f.folder_id === folder.id && (folder.archived_at || !f.archived_at));
    const total = files.reduce((sum, f) => sum + f.size_bytes, 0);
    document.querySelector('[data-folder-count]')!.textContent = `${plural(files.length, 'file')}, ${size(total)}`;
    document.querySelector<HTMLButtonElement>('[data-zip]')!.disabled = files.length === 0;
    document.querySelector('[data-zip-status]')!.textContent = '';
  } else if (view.tab === 'archive') {
    folders = data.folders.filter((f) => f.archived_at);
    files = data.files.filter((f) => f.archived_at && !folderById(f.folder_id)?.archived_at);
  } else {
    folders = data.folders.filter((f) => !f.archived_at);
    files = data.files.filter((f) => !f.folder_id && !f.archived_at);
  }

  const folderList = document.querySelector<HTMLUListElement>('[data-folders]')!;
  folderList.replaceChildren(...folders.map(folderCard));
  document.querySelector<HTMLElement>('[data-section="folders"]')!.hidden = folders.length === 0;

  const list = document.querySelector<HTMLUListElement>('[data-deliveries]')!;
  list.replaceChildren(...files.map(fileCard));
  document.querySelector<HTMLElement>('[data-section="files"]')!.hidden = files.length === 0;
  document.querySelector('[data-files-label]')!.textContent = folder ? 'Files in this folder' : folders.length ? 'Other files' : 'Files';

  const empty = document.querySelector<HTMLElement>('[data-files-empty]')!;
  empty.hidden = folders.length + files.length > 0;
  empty.textContent = folder
    ? 'This folder is empty.'
    : view.tab === 'archive'
      ? 'Nothing archived yet. Older deliveries move here so the main view stays tidy.'
      : 'No files yet. You’ll hear from cirfan when they’re ready.';
}

function go(next: View, push = true) {
  const changedFolder = next.folder !== view.folder;
  const changedTab = next.tab !== view.tab;
  view = next;
  if (push) {
    const url = new URL(location.href);
    url.search = '';
    if (next.tab === 'archive') url.searchParams.set('tab', 'archive');
    if (next.folder) url.searchParams.set('folder', next.folder);
    history.pushState(null, '', url);
  }
  if (changedTab && push) track('tab_opened', { tab: next.tab });
  const folder = folderById(next.folder);
  if (changedFolder && folder) track('folder_opened', { folder: folder.name });
  render();
  window.scrollTo({ top: 0 });
}

const readView = (): View => {
  const params = new URLSearchParams(location.search);
  const folder = params.get('folder');
  return { tab: params.get('tab') === 'archive' ? 'archive' : 'files', folder: folder && folderById(folder) ? folder : null };
};

window.addEventListener('popstate', () => go(readView(), false));
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => go({ tab: b.dataset.tab === 'archive' ? 'archive' : 'files', folder: null })),
);
document.querySelector('[data-back]')?.addEventListener('click', () => go({ tab: view.tab, folder: null }));
document.querySelector('[data-zip]')?.addEventListener('click', (event) => {
  const folder = folderById(view.folder);
  if (folder) downloadFolder(folder, event.currentTarget as HTMLButtonElement, document.querySelector<HTMLElement>('[data-zip-status]')!);
});

async function openFiles() {
  try {
    const result = await api<{ client: { name: string; contactMethod: string; contactDetail: string }; folders: Folder[]; files: Delivery[] }>('files');
    document.querySelector('[data-client-name]')!.textContent = `Deliveries for ${result.client.name}`;
    document.querySelector('[data-contact]')!.textContent = contactLine(result.client.contactMethod, result.client.contactDetail);
    data.folders = result.folders ?? [];
    data.files = result.files;
    view = readView();
    render();
    show('files');
  } catch (e) {
    if ((e as ApiError).status === 401) show('login');
    else show('missing');
  }
}

document.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
  await api('logout').catch(() => {});
  show('login');
});

// Every element marked data-track is logged when clicked.
document.addEventListener('click', (event) => {
  const el = (event.target as Element).closest<HTMLElement>('[data-track]');
  if (!el) return;
  const detail: Record<string, string> = { target: el.dataset.track ?? '' };
  if (el.dataset.trackFile) detail.file = el.dataset.trackFile;
  track('click', detail);
});

document.addEventListener('visibilitychange', () => {
  const view = views.find((v) => !v.hidden)?.dataset.view;
  if (view === 'files') track(document.hidden ? 'page_hidden' : 'page_visible');
});

// ---------- Start ----------
(async () => {
  if (!id) return show('missing');
  try {
    const status = await api<{ state: string; minPassword: number }>('status');
    minPassword = status.minPassword ?? minPassword;
    setupForm.querySelector('[data-rule]')!.textContent = `At least ${minPassword} characters. A short phrase is easier to remember than a random word.`;
    if (status.state === 'ready') await openFiles();
    else show(status.state);
  } catch {
    show('missing');
  }
})();
