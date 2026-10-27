// src/scripts/portal.ts
// Client delivery page. The sign-in itself lives in an HttpOnly cookie set by /api/portal; this script never
// sees or stores the session token. Clicks on anything marked data-track, preview plays and every download
// (completed or failed) are reported to the activity log.

type Delivery = { id: string; file_name: string; kind: 'video' | 'image'; content_type: string; size_bytes: number; created_at: string; previewUrl: string };
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

// ---------- Files ----------
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
    const href = URL.createObjectURL(new Blob(chunks, { type: file.content_type }));
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
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

function contactLine(method: string, detail: string) {
  const email = root?.dataset.email ?? '';
  if (method === 'slack') return `Questions or feedback? Use your private Slack channel${detail ? ` (${detail})` : ''}.`;
  return `Questions or feedback? Email ${email}.`;
}

async function openFiles() {
  try {
    const { client, files } = await api<{ client: { name: string; contactMethod: string; contactDetail: string }; files: Delivery[] }>('files');
    document.querySelector('[data-client-name]')!.textContent = `Deliveries for ${client.name}`;
    document.querySelector('[data-contact]')!.textContent = contactLine(client.contactMethod, client.contactDetail);
    const list = document.querySelector<HTMLUListElement>('[data-deliveries]')!;
    const tpl = document.querySelector<HTMLTemplateElement>('#tpl-delivery')!;
    list.replaceChildren();
    for (const file of files) {
      const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
      const media = li.querySelector('.delivery__media')!;
      if (file.kind === 'video') {
        const video = document.createElement('video');
        video.src = file.previewUrl;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
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
        img.addEventListener('error', () => track('preview_failed', { file: file.file_name }), { once: true });
        media.append(img);
      }
      li.querySelector('.delivery__name')!.textContent = file.file_name;
      li.querySelector('.delivery__meta')!.textContent = `${file.kind === 'video' ? 'Video' : 'Image'}, ${size(file.size_bytes)}, added ${date.format(new Date(file.created_at))}`;
      const button = li.querySelector<HTMLButtonElement>('button')!;
      button.dataset.track = 'download';
      button.dataset.trackFile = file.file_name;
      button.addEventListener('click', () => download(file, button, li.querySelector<HTMLElement>('.delivery__status')!));
      list.append(li);
    }
    document.querySelector('[data-files-empty]')!.toggleAttribute('hidden', files.length > 0);
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
