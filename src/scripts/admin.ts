// src/scripts/admin.ts
// Dashboard logic. Everything shown comes from /api/admin and is written with textContent, never innerHTML,
// so names, file names and logged details can't inject markup.

type ClientRow = {
  id: string;
  name: string;
  contact_method: 'email' | 'slack';
  contact_detail: string;
  password_set_at: string | null;
  created_at: string;
  file_count: number;
  last_client_activity: string | null;
  link: string;
};
type FileRow = { id: string; file_name: string; kind: 'video' | 'image'; content_type: string; size_bytes: number; created_at: string; previewUrl: string };
type EventRow = { id: number; actor: string; event: string; detail: Record<string, unknown>; ip: string | null; user_agent: string | null; created_at: string };

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

const EVENT_LABELS: Record<string, string> = {
  page_view: 'Opened the page',
  password_created: 'Created the password',
  login_success: 'Signed in',
  login_failed: 'Wrong password',
  login_blocked: 'Sign-in blocked (too many attempts)',
  logout: 'Signed out',
  click: 'Clicked',
  video_play: 'Played a preview',
  video_pause: 'Paused a preview',
  video_ended: 'Watched a preview to the end',
  preview_failed: 'Preview failed to load',
  download_link_issued: 'Started a download',
  download_completed: 'Download completed',
  download_failed: 'Download failed',
  download_denied: 'Download refused',
  page_hidden: 'Left the tab',
  page_visible: 'Came back to the tab',
  page_created: 'Page created',
  page_updated: 'Page edited',
  password_reset: 'Password reset',
  sessions_ended: 'All browsers signed out',
  file_added: 'File added, metadata removed',
  file_removed: 'File removed',
  metadata_leak: 'Metadata check failed, file rejected',
};
const BAD_EVENTS = new Set(['login_failed', 'login_blocked', 'download_failed', 'download_denied', 'preview_failed', 'metadata_leak']);
const FILTERS: Record<string, (e: EventRow) => boolean> = {
  all: () => true,
  client: (e) => e.actor === 'client',
  auth: (e) => ['password_created', 'login_success', 'login_failed', 'login_blocked', 'logout', 'password_reset', 'sessions_ended'].includes(e.event),
  downloads: (e) => e.event.startsWith('download_'),
  admin: (e) => e.actor !== 'client',
};

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fmt = (iso: string | null, withTime = true) => (iso ? (withTime ? dateTime : dateOnly).format(new Date(iso)) : 'Never');
const size = (bytes: number) =>
  bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes > 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
const ago = (iso: string | null) => {
  if (!iso) return 'no client activity';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'active just now';
  if (minutes < 60) return `active ${minutes} min ago`;
  if (minutes < 1440) return `active ${Math.round(minutes / 60)} h ago`;
  return `active ${Math.round(minutes / 1440)} d ago`;
};
const device = (ua: string | null) => {
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
};
const describe = (detail: Record<string, unknown>) =>
  Object.entries(detail ?? {})
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`)
    .join(', ');

async function api<T = Record<string, unknown>>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const state: { clients: ClientRow[]; selected: string | null; files: FileRow[]; events: EventRow[]; client: ClientRow | null } = {
  clients: [],
  selected: new URLSearchParams(location.search).get('client'),
  files: [],
  events: [],
  client: null,
};

// ---------- Client list ----------
const listEl = $<HTMLUListElement>('[data-client-list]');
const searchEl = $<HTMLInputElement>('[data-search]');

function renderList() {
  const query = searchEl.value.trim().toLowerCase();
  const tpl = $<HTMLTemplateElement>('#tpl-client');
  listEl.replaceChildren();
  for (const c of state.clients.filter((c) => c.name.toLowerCase().includes(query))) {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const button = $<HTMLButtonElement>('.client', li);
    $('.client__name', li).textContent = c.name;
    $('.client__meta', li).textContent = `${c.file_count} ${c.file_count === 1 ? 'file' : 'files'}, ${ago(c.last_client_activity)}`;
    button.setAttribute('aria-current', String(c.id === state.selected));
    button.addEventListener('click', () => select(c.id));
    listEl.append(li);
  }
  $('[data-list-empty]').toggleAttribute('hidden', state.clients.length > 0);
}

async function loadList() {
  try {
    const { clients } = await api<{ clients: ClientRow[] }>('list');
    state.clients = clients;
    $('[data-list-error]').toggleAttribute('hidden', true);
  } catch (e) {
    const el = $('[data-list-error]');
    el.textContent = `Could not load client pages (${(e as Error).message}). Check the environment variables in Vercel.`;
    el.toggleAttribute('hidden', false);
  }
  renderList();
}

searchEl.addEventListener('input', renderList);

// ---------- Detail ----------
async function select(id: string | null) {
  state.selected = id;
  const url = new URL(location.href);
  if (id) url.searchParams.set('client', id);
  else url.searchParams.delete('client');
  history.replaceState(null, '', url);
  renderList();
  $('[data-detail-empty]').toggleAttribute('hidden', Boolean(id));
  $('[data-detail]').toggleAttribute('hidden', !id);
  if (id) await loadDetail();
}

async function loadDetail() {
  if (!state.selected) return;
  try {
    const data = await api<{ client: ClientRow; files: FileRow[]; events: EventRow[] }>('get', { id: state.selected });
    Object.assign(state, data);
    renderDetail();
  } catch (e) {
    if ((e as Error).message === 'not_found') await select(null);
  }
}

function renderDetail() {
  const c = state.client!;
  const field = (name: string) => $(`[data-field="${name}"]`);
  field('name').textContent = c.name;
  field('contact').textContent =
    c.contact_method === 'slack'
      ? `Communication: private Slack channel${c.contact_detail ? ` (${c.contact_detail})` : ''}`
      : `Communication: email${c.contact_detail ? ` (${c.contact_detail})` : ''}`;
  field('link').textContent = c.link;
  $<HTMLAnchorElement>('[data-open-link]').href = c.link;
  field('password').textContent = c.password_set_at ? `Set ${fmt(c.password_set_at, false)}` : 'Not set yet';
  field('files').textContent = String(state.files.length);
  field('activity').textContent = fmt(c.last_client_activity);
  field('created').textContent = fmt(c.created_at, false);
  renderFiles();
  renderLog();
}

function renderFiles() {
  const grid = $<HTMLUListElement>('[data-file-grid]');
  const tpl = $<HTMLTemplateElement>('#tpl-file');
  grid.replaceChildren();
  for (const f of state.files) {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const preview = $('.file__preview', li);
    if (f.kind === 'video') {
      const video = document.createElement('video');
      video.src = f.previewUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      preview.append(video);
    } else {
      const img = document.createElement('img');
      img.src = f.previewUrl;
      img.alt = f.file_name;
      img.loading = 'lazy';
      preview.append(img);
    }
    $('.file__name', li).textContent = f.file_name;
    $('.file__meta', li).textContent = `${size(f.size_bytes)}, added ${fmt(f.created_at, false)}`;
    $('button', li).addEventListener('click', async () => {
      if (!(await confirmAction('Remove this file?', `“${f.file_name}” will be deleted and the client will no longer see it.`))) return;
      await api('delete-file', { id: state.selected, fileId: f.id });
      await refresh();
    });
    grid.append(li);
  }
  $('[data-files-empty]').toggleAttribute('hidden', state.files.length > 0);
}

const filterEl = $<HTMLSelectElement>('[data-log-filter]');
const visibleEvents = () => state.events.filter(FILTERS[filterEl.value] ?? FILTERS.all);

function renderLog() {
  const body = $<HTMLTableSectionElement>('[data-log]');
  body.replaceChildren();
  const rows = visibleEvents();
  for (const e of rows) {
    const tr = document.createElement('tr');
    if (BAD_EVENTS.has(e.event)) tr.className = 'is-bad';
    const cells = [
      fmt(e.created_at),
      e.actor === 'client' ? 'Client' : e.actor === 'admin' ? 'You' : 'System',
      EVENT_LABELS[e.event] ?? e.event,
      describe(e.detail),
      e.ip ?? '',
      device(e.user_agent),
    ];
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    if (e.user_agent) tr.title = e.user_agent;
    body.append(tr);
  }
  $('[data-log-empty]').toggleAttribute('hidden', rows.length > 0);
}
filterEl.addEventListener('change', renderLog);

// CSV for records. Cells that start with = + - @ are prefixed so spreadsheet apps never run them as formulas.
$('[data-csv]').addEventListener('click', () => {
  const cell = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['time_utc', 'actor', 'event', 'details', 'ip', 'user_agent'].join(',')];
  for (const e of visibleEvents()) lines.push([e.created_at, e.actor, e.event, describe(e.detail), e.ip, e.user_agent].map(cell).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.selected}-activity.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});

async function refresh() {
  await Promise.all([loadDetail(), loadList()]);
}

// ---------- Actions ----------
$('[data-copy-link]').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(state.client!.link);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => (button.textContent = 'Copy link'), 1800);
});

$('[data-reset]').addEventListener('click', async () => {
  const ok = await confirmAction(
    'Reset the password?',
    'Every signed-in browser is signed out. The next person to open the link creates a new password, so send the link only to the client.',
  );
  if (!ok) return;
  await api('reset-password', { id: state.selected });
  await refresh();
});

$('[data-end-sessions]').addEventListener('click', async () => {
  if (!(await confirmAction('Sign out all browsers?', 'The client keeps the same password and signs in again next visit.'))) return;
  await api('end-sessions', { id: state.selected });
  await refresh();
});

$('[data-delete]').addEventListener('click', async () => {
  const c = state.client!;
  const ok = await confirmAction(
    'Delete this page?',
    'The link stops working and every file and log entry for this page is deleted for good. Download the activity CSV first if you need the record.',
    c.name,
  );
  if (!ok) return;
  await api('delete', { id: c.id });
  await select(null);
  await loadList();
});

// ---------- Create and edit dialog ----------
const clientDialog = $<HTMLDialogElement>('[data-client-dialog]');
const clientForm = $<HTMLFormElement>('[data-client-form]');
let editing = false;

function openClientDialog(edit: boolean) {
  editing = edit;
  clientForm.reset();
  $('[data-dialog-error]').toggleAttribute('hidden', true);
  $('[data-dialog-title]').textContent = edit ? 'Edit client page' : 'New client page';
  if (edit && state.client) {
    (clientForm.elements.namedItem('name') as HTMLInputElement).value = state.client.name;
    (clientForm.elements.namedItem('contactDetail') as HTMLInputElement).value = state.client.contact_detail;
    const radio = clientForm.querySelector<HTMLInputElement>(`input[name="contactMethod"][value="${state.client.contact_method}"]`);
    if (radio) radio.checked = true;
  }
  clientDialog.showModal();
}

$('[data-new-client]').addEventListener('click', () => openClientDialog(false));
$('[data-edit]').addEventListener('click', () => openClientDialog(true));
$('[data-dialog-cancel]').addEventListener('click', () => clientDialog.close());

clientForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(clientForm);
  const payload = {
    name: String(data.get('name') ?? ''),
    contactMethod: String(data.get('contactMethod') ?? 'email'),
    contactDetail: String(data.get('contactDetail') ?? ''),
  };
  try {
    if (editing) {
      await api('update', { id: state.selected, ...payload });
      clientDialog.close();
      await refresh();
    } else {
      const { client } = await api<{ client: ClientRow }>('create', payload);
      clientDialog.close();
      await loadList();
      await select(client.id);
    }
  } catch (e) {
    const el = $('[data-dialog-error]');
    el.textContent = `Could not save (${(e as Error).message}).`;
    el.toggleAttribute('hidden', false);
  }
});

// ---------- Confirm dialog ----------
const confirmDialog = $<HTMLDialogElement>('[data-confirm-dialog]');
function confirmAction(title: string, text: string, typeToConfirm?: string) {
  return new Promise<boolean>((resolve) => {
    $('[data-confirm-title]').textContent = title;
    $('[data-confirm-text]').textContent = text;
    const wrap = $('[data-confirm-type-wrap]');
    const input = $<HTMLInputElement>('[data-confirm-type]');
    const ok = $<HTMLButtonElement>('[data-confirm-ok]');
    input.value = '';
    wrap.toggleAttribute('hidden', !typeToConfirm);
    if (typeToConfirm) {
      $('[data-confirm-type-label]').textContent = `Type “${typeToConfirm}” to confirm`;
      ok.disabled = true;
      input.oninput = () => (ok.disabled = input.value !== typeToConfirm);
    } else {
      ok.disabled = false;
    }
    const done = (value: boolean) => {
      confirmDialog.close();
      resolve(value);
    };
    $<HTMLFormElement>('[data-confirm-form]').onsubmit = (e) => {
      e.preventDefault();
      done(true);
    };
    $<HTMLButtonElement>('[data-confirm-cancel]').onclick = () => done(false);
    confirmDialog.oncancel = () => resolve(false);
    confirmDialog.showModal();
  });
}

// ---------- Uploads ----------
const drop = $<HTMLLabelElement>('[data-drop]');
const fileInput = $<HTMLInputElement>('[data-file-input]');
const queueEl = $<HTMLUListElement>('[data-queue]');

const putWithProgress = (url: string, file: File, contentType: string, onProgress: (p: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`storage responded ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('network error (check the R2 CORS rule)'));
    xhr.send(file);
  });

async function uploadAll(files: FileList | File[]) {
  const id = state.selected;
  if (!id) return;
  const tpl = $<HTMLTemplateElement>('#tpl-queue');
  const items = Array.from(files).map((file) => {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    $('.queue__name', li).textContent = file.name;
    $('.queue__status', li).textContent = 'Waiting';
    queueEl.append(li);
    return { file, li };
  });
  // One at a time keeps the processing function within its limits.
  for (const { file, li } of items) {
    const status = $('.queue__status', li);
    const bar = $<HTMLElement>('.queue__bar span', li);
    try {
      status.textContent = 'Uploading';
      const { url, key, contentType } = await api<{ url: string; key: string; contentType: string }>('upload-url', {
        id,
        fileName: file.name,
        size: file.size,
      });
      await putWithProgress(url, file, contentType, (p) => (bar.style.transform = `scaleX(${p})`));
      status.textContent = 'Removing metadata';
      await api('process', { id, key, fileName: file.name });
      status.textContent = 'Ready';
      setTimeout(() => li.remove(), 4000);
    } catch (e) {
      const reason = (e as Error).message;
      status.textContent =
        reason === 'too_large' ? 'Too large (200 MB max)' : reason === 'unsupported_type' ? 'File type not supported' : reason === 'metadata_leak' ? 'Rejected: metadata could not be fully removed' : `Failed: ${reason}`;
      status.classList.add('is-error');
    }
  }
  fileInput.value = '';
  await refresh();
}

fileInput.addEventListener('change', () => fileInput.files && uploadAll(fileInput.files));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => (e.preventDefault(), drop.classList.add('is-over'))));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) uploadAll(e.dataTransfer.files);
});

// ---------- Start ----------
loadList().then(() => select(state.selected && state.clients.some((c) => c.id === state.selected) ? state.selected : null));
