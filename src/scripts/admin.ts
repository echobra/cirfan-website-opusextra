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
  folder_count?: number;
  last_client_activity: string | null;
  notify_email?: string | null;
  notify_enabled?: boolean;
  notify_state?: string;
  link: string;
};
type FolderRow = { id: string; name: string; archived_at: string | null; created_at: string };
type FileRow = {
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
type EventRow = { id: number; actor: string; event: string; detail: Record<string, unknown>; ip: string | null; user_agent: string | null; created_at: string };

// Which part of the Files block is showing: loose files, one folder, or the archive.
type View = { kind: 'root' } | { kind: 'folder'; id: string } | { kind: 'archive' };

const $ = <T extends Element>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)!;

const EVENT_LABELS: Record<string, string> = {
  page_view: 'Opened the page',
  password_created: 'Created the password',
  login_success: 'Signed in',
  login_failed: 'Wrong password',
  login_blocked: 'Sign-in blocked (too many attempts)',
  logout: 'Signed out',
  click: 'Clicked',
  tab_opened: 'Opened a tab',
  folder_opened: 'Opened a folder',
  video_play: 'Played a preview',
  video_pause: 'Paused a preview',
  video_ended: 'Watched a preview to the end',
  preview_failed: 'Preview failed to load',
  download_link_issued: 'Started a download',
  download_completed: 'Download completed',
  download_failed: 'Download failed',
  download_denied: 'Download refused',
  zip_links_issued: 'Started a ZIP download',
  zip_completed: 'ZIP download completed',
  zip_failed: 'ZIP download failed',
  page_hidden: 'Left the tab',
  page_visible: 'Came back to the tab',
  page_created: 'Page created',
  page_updated: 'Page edited',
  password_reset: 'Password reset',
  sessions_ended: 'All browsers signed out',
  folder_created: 'Folder created',
  folder_renamed: 'Folder renamed',
  folder_archived: 'Folder archived',
  folder_restored: 'Folder restored',
  folder_deleted: 'Folder deleted',
  file_added: 'File added, metadata removed',
  file_removed: 'File removed',
  file_moved: 'File moved',
  file_archived: 'File archived',
  file_restored: 'File restored',
  client_emailed: 'Client emailed about new files',
  metadata_leak: 'Metadata check failed, file rejected',
  processing_failed: 'File could not be processed',
};
const BAD_EVENTS = new Set(['login_failed', 'login_blocked', 'download_failed', 'download_denied', 'preview_failed', 'zip_failed', 'metadata_leak', 'processing_failed']);
const FILTERS: Record<string, (e: EventRow) => boolean> = {
  all: () => true,
  client: (e) => e.actor === 'client',
  auth: (e) => ['password_created', 'login_success', 'login_failed', 'login_blocked', 'logout', 'password_reset', 'sessions_ended'].includes(e.event),
  downloads: (e) => e.event.startsWith('download_') || e.event.startsWith('zip_'),
  admin: (e) => e.actor !== 'client',
};
const NOTIFY_STATES: Record<string, string> = {
  ready: 'On',
  waiting: 'Starts after the client creates a password and opens the page',
  no_email: 'Off: no notification email (use Edit)',
  off: 'Off for this client',
  not_configured: 'Off: RESEND_API_KEY or NOTIFY_FROM_EMAIL missing in Vercel',
};
const SUPPORTED = /\.(mp4|m4v|mov|webm|jpe?g|png|webp)$/i;
const SYSTEM_FILES = /^(\.|thumbs\.db$|desktop\.ini$)/i;

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
  if (!res.ok) {
    // Our API always answers with JSON. No JSON means the platform answered instead: a crash, a timeout,
    // or Cloudflare giving up on a slow request.
    const platform: Record<number, string> = { 500: 'server_crashed', 502: 'server_crashed', 504: 'timed_out', 524: 'cloudflare_timeout' };
    const error = new Error(body.error ?? platform[res.status] ?? `HTTP ${res.status}`) as Error & { reason?: string };
    error.reason = body.reason;
    throw error;
  }
  return body as T;
}

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const UPLOAD_ERRORS: Record<string, string> = {
  too_large: 'Too large (200 MB max)',
  unsupported_type: 'File type not supported',
  metadata_leak: 'Rejected: metadata could not be fully removed',
  conversion_timeout: 'Conversion took too long. Export a shorter clip, or H.264 1080p so no conversion is needed',
  conversion_failed: 'Could not convert this video',
  unreadable: 'Not a readable video file',
  server_crashed: 'The server crashed while processing (usually out of memory). Try again on its own; if it repeats, export H.264 1080p',
  timed_out: 'Took longer than 5 minutes. Export a shorter clip, or H.264 1080p',
  cloudflare_timeout:
    'Cloudflare stopped waiting after 100 seconds (orange cloud proxy). The server may still finish: it will appear below if it does',
};

// Only one file is processed at a time. Two 4K conversions at once can run out of memory on one server.
let processing: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
  const next = processing.then(task, task);
  processing = next.catch(() => {});
  return next;
};

const state: {
  clients: ClientRow[];
  selected: string | null;
  client: ClientRow | null;
  folders: FolderRow[];
  files: FileRow[];
  events: EventRow[];
  view: View;
} = {
  clients: [],
  selected: new URLSearchParams(location.search).get('client'),
  client: null,
  folders: [],
  files: [],
  events: [],
  view: { kind: 'root' },
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
  if (id !== state.selected) state.view = { kind: 'root' };
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
    const data = await api<{ client: ClientRow; folders: FolderRow[]; files: FileRow[]; events: EventRow[] }>('get', { id: state.selected });
    Object.assign(state, data);
    if (state.view.kind === 'folder' && !state.folders.some((f) => state.view.kind === 'folder' && f.id === state.view.id)) {
      state.view = { kind: 'root' };
    }
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
  field('files').textContent = `${state.files.length} in ${state.folders.length} ${state.folders.length === 1 ? 'folder' : 'folders'} and loose`;
  field('activity').textContent = fmt(c.last_client_activity);
  field('created').textContent = fmt(c.created_at, false);
  const notifyText = NOTIFY_STATES[c.notify_state ?? 'off'] ?? '';
  field('notify').textContent = c.notify_state === 'ready' ? `On, to ${c.notify_email}` : notifyText;
  const notify = $<HTMLInputElement>('[data-notify]');
  notify.disabled = c.notify_state !== 'ready';
  notify.checked = c.notify_state === 'ready';
  $('[data-notify-state]').textContent = c.notify_state === 'ready' ? `Sends one email to ${c.notify_email} per upload.` : notifyText;
  renderFiles();
  renderLog();
}

// ---------- Files, folders and archive ----------
const activeFolders = () => state.folders.filter((f) => !f.archived_at);
const folderById = (id: string | null) => state.folders.find((f) => f.id === id) ?? null;
const filesIn = (folderId: string | null) => state.files.filter((f) => f.folder_id === folderId && !f.archived_at);

function tab(label: string, pressed: boolean, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tab';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

function setView(view: View) {
  state.view = view;
  renderFiles();
}

function renderFiles() {
  const v = state.view;
  const tabs = $('[data-tabs]');
  const archivedCount = state.folders.filter((f) => f.archived_at).length + state.files.filter((f) => f.archived_at).length;
  tabs.replaceChildren(
    tab(`Loose files (${filesIn(null).length})`, v.kind === 'root', () => setView({ kind: 'root' })),
    ...activeFolders().map((f) =>
      tab(`${f.name} (${filesIn(f.id).length})`, v.kind === 'folder' && v.id === f.id, () => setView({ kind: 'folder', id: f.id })),
    ),
    tab(`Archive (${archivedCount})`, v.kind === 'archive', () => setView({ kind: 'archive' })),
  );

  const folder = v.kind === 'folder' ? folderById(v.id) : null;
  $('[data-folder-bar]').toggleAttribute('hidden', !folder);
  if (folder) {
    $('[data-folder-name]').textContent = folder.archived_at ? `${folder.name} (archived)` : folder.name;
    $('[data-folder-archive]').textContent = folder.archived_at ? 'Restore' : 'Archive';
  }
  $('[data-upload]').toggleAttribute('hidden', v.kind === 'archive' || Boolean(folder?.archived_at));
  $('[data-archive-note]').toggleAttribute('hidden', v.kind !== 'archive');
  $('[data-drop-target]').textContent = folder ? `Files go into “${folder.name}”. Dropped folders become new folders.` : 'Files go in loose. Dropped folders become new folders.';

  // Folder cards: archived folders in the Archive view.
  const folderGrid = $<HTMLUListElement>('[data-folder-grid]');
  const folderTpl = $<HTMLTemplateElement>('#tpl-folder');
  folderGrid.replaceChildren();
  if (v.kind === 'archive') {
    for (const f of state.folders.filter((f) => f.archived_at)) {
      const li = folderTpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
      $('.folder-card__name', li).textContent = f.name;
      $('.folder-card__meta', li).textContent = `${state.files.filter((x) => x.folder_id === f.id).length} files, archived ${fmt(f.archived_at, false)}`;
      $('button', li).addEventListener('click', () => setView({ kind: 'folder', id: f.id }));
      folderGrid.append(li);
    }
  }

  const shown =
    v.kind === 'archive'
      ? state.files.filter((f) => f.archived_at)
      : v.kind === 'folder'
        ? state.files.filter((f) => f.folder_id === v.id && (folder?.archived_at ? true : !f.archived_at))
        : filesIn(null);
  renderFileCards(shown);
  $('[data-files-empty]').toggleAttribute('hidden', shown.length > 0 || folderGrid.children.length > 0);
}

function renderFileCards(files: FileRow[]) {
  const grid = $<HTMLUListElement>('[data-file-grid]');
  const tpl = $<HTMLTemplateElement>('#tpl-file');
  grid.replaceChildren();
  for (const f of files) {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const preview = $('.file__preview', li);
    if (f.kind === 'video') {
      const video = document.createElement('video');
      video.src = f.previewUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      if (f.width && f.height) {
        video.width = f.width;
        video.height = f.height;
      }
      preview.append(video);
    } else {
      const img = document.createElement('img');
      img.src = f.previewUrl;
      img.alt = f.file_name;
      img.loading = 'lazy';
      if (f.width && f.height) {
        img.width = f.width;
        img.height = f.height;
      }
      preview.append(img);
    }
    $('.file__name', li).textContent = f.file_name;
    const where = f.folder_id ? folderById(f.folder_id)?.name ?? 'folder' : 'loose';
    $('.file__meta', li).textContent = `${size(f.size_bytes)}${f.width ? `, ${f.width}x${f.height}` : ''}, ${where}, added ${fmt(f.created_at, false)}`;

    const move = $<HTMLSelectElement>('[data-move]', li);
    const options: [string, string][] = [['', 'No folder'], ...state.folders.map((x): [string, string] => [x.id, x.archived_at ? `${x.name} (archived)` : x.name])];
    for (const [value, label] of options) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = value === (f.folder_id ?? '') ? `In: ${label}` : `Move to: ${label}`;
      o.selected = value === (f.folder_id ?? '');
      move.append(o);
    }
    move.addEventListener('change', async () => {
      await api('move-file', { id: state.selected, fileId: f.id, folderId: move.value || null });
      await refresh();
    });

    const archive = $<HTMLButtonElement>('[data-archive]', li);
    archive.textContent = f.archived_at ? 'Restore' : 'Archive';
    archive.addEventListener('click', async () => {
      await api('archive-file', { id: state.selected, fileId: f.id, archived: !f.archived_at });
      await refresh();
    });

    $('[data-remove]', li).addEventListener('click', async () => {
      if (!(await confirmAction('Remove this file?', `“${f.file_name}” will be deleted and the client will no longer see it.`))) return;
      await api('delete-file', { id: state.selected, fileId: f.id });
      await refresh();
    });
    grid.append(li);
  }
}

$('[data-new-folder]').addEventListener('click', async () => {
  const name = await promptText('New folder', 'Folder name', '');
  if (!name) return;
  const { folder } = await api<{ folder: FolderRow }>('create-folder', { id: state.selected, name });
  state.view = { kind: 'folder', id: folder.id };
  await refresh();
});

$('[data-folder-rename]').addEventListener('click', async () => {
  const folder = state.view.kind === 'folder' ? folderById(state.view.id) : null;
  if (!folder) return;
  const name = await promptText('Rename folder', 'Folder name', folder.name);
  if (!name || name === folder.name) return;
  await api('rename-folder', { id: state.selected, folderId: folder.id, name });
  await refresh();
});

$('[data-folder-archive]').addEventListener('click', async () => {
  const folder = state.view.kind === 'folder' ? folderById(state.view.id) : null;
  if (!folder) return;
  await api('archive-folder', { id: state.selected, folderId: folder.id, archived: !folder.archived_at });
  state.view = folder.archived_at ? { kind: 'folder', id: folder.id } : { kind: 'archive' };
  await refresh();
});

$('[data-folder-delete]').addEventListener('click', async () => {
  const folder = state.view.kind === 'folder' ? folderById(state.view.id) : null;
  if (!folder) return;
  const count = state.files.filter((f) => f.folder_id === folder.id).length;
  const ok = await confirmAction('Delete this folder?', `“${folder.name}” and its ${count} ${count === 1 ? 'file' : 'files'} will be deleted for good.`, folder.name);
  if (!ok) return;
  await api('delete-folder', { id: state.selected, folderId: folder.id });
  state.view = { kind: 'root' };
  await refresh();
});

// ---------- Activity log ----------
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

// ---------- Page actions ----------
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
    'The link stops working and every folder, file and log entry for this page is deleted for good. Download the activity CSV first if you need the record.',
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
    const c = state.client;
    (clientForm.elements.namedItem('name') as HTMLInputElement).value = c.name;
    (clientForm.elements.namedItem('contactDetail') as HTMLInputElement).value = c.contact_detail;
    (clientForm.elements.namedItem('notifyEmail') as HTMLInputElement).value = c.notify_email ?? '';
    (clientForm.elements.namedItem('notifyEnabled') as HTMLInputElement).checked = c.notify_enabled !== false;
    const radio = clientForm.querySelector<HTMLInputElement>(`input[name="contactMethod"][value="${c.contact_method}"]`);
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
    notifyEmail: String(data.get('notifyEmail') ?? ''),
    notifyEnabled: data.get('notifyEnabled') === 'on',
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

// ---------- Confirm and prompt dialog ----------
const confirmDialog = $<HTMLDialogElement>('[data-confirm-dialog]');
function openConfirm(title: string, text: string, input?: { label: string; value: string; mustEqual?: string }) {
  return new Promise<string | null>((resolve) => {
    $('[data-confirm-title]').textContent = title;
    $('[data-confirm-text]').textContent = text;
    $('[data-confirm-text]').toggleAttribute('hidden', !text);
    const wrap = $('[data-confirm-type-wrap]');
    const field = $<HTMLInputElement>('[data-confirm-type]');
    const ok = $<HTMLButtonElement>('[data-confirm-ok]');
    wrap.toggleAttribute('hidden', !input);
    field.value = input?.value ?? '';
    field.maxLength = 120;
    if (input) $('[data-confirm-type-label]').textContent = input.label;
    const validate = () => (ok.disabled = Boolean(input && (input.mustEqual ? field.value !== input.mustEqual : !field.value.trim())));
    field.oninput = validate;
    validate();
    const done = (value: string | null) => {
      confirmDialog.close();
      resolve(value);
    };
    $<HTMLFormElement>('[data-confirm-form]').onsubmit = (e) => {
      e.preventDefault();
      done(input ? field.value.trim() : 'ok');
    };
    $<HTMLButtonElement>('[data-confirm-cancel]').onclick = () => done(null);
    confirmDialog.oncancel = () => resolve(null);
    confirmDialog.showModal();
    if (input) field.focus();
  });
}
const confirmAction = async (title: string, text: string, typeToConfirm?: string) =>
  (await openConfirm(title, text, typeToConfirm ? { label: `Type “${typeToConfirm}” to confirm`, value: '', mustEqual: typeToConfirm } : undefined)) !== null;
const promptText = (title: string, label: string, value: string) => openConfirm(title, '', { label, value });

// ---------- Uploads (files and whole folders) ----------
type Pending = { file: File; folderName: string | null };

const drop = $<HTMLLabelElement>('[data-drop]');
const fileInput = $<HTMLInputElement>('[data-file-input]');
const folderInput = $<HTMLInputElement>('[data-folder-input]');
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

// Walks dropped folders (including subfolders). Everything inside one dropped folder lands in one folder.
async function fromDrop(items: DataTransferItemList): Promise<Pending[]> {
  const out: Pending[] = [];
  const readDir = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = dir.createReader();
      const all: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        }, reject);
      next();
    });
  const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));
  const walk = async (entry: FileSystemEntry, top: string | null): Promise<void> => {
    if (entry.isFile) out.push({ file: await fileOf(entry as FileSystemFileEntry), folderName: top });
    else for (const child of await readDir(entry as FileSystemDirectoryEntry)) await walk(child, top ?? entry.name);
  };
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  for (const entry of entries) await walk(entry, null);
  return out;
}

async function uploadAll(pending: Pending[]) {
  const id = state.selected;
  if (!id || !pending.length) return;
  const targetFolder = state.view.kind === 'folder' ? state.view.id : null;
  const tpl = $<HTMLTemplateElement>('#tpl-queue');

  // One folder per dropped folder name (reuses an active folder with the same name).
  const folderIds = new Map<string, string>();
  for (const name of new Set(pending.map((p) => p.folderName).filter((n): n is string => Boolean(n)))) {
    const { folder } = await api<{ folder: FolderRow }>('create-folder', { id, name, reuse: true });
    folderIds.set(name, folder.id);
  }

  // Unsupported and oversized files are marked straight away and never wait in the queue.
  const jobs: { file: File; folderId: string | null; li: HTMLLIElement }[] = [];
  for (const { file, folderName } of pending) {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const status = $('.queue__status', li);
    $('.queue__name', li).textContent = folderName ? `${folderName} / ${file.name}` : file.name;
    queueEl.append(li);
    if (SYSTEM_FILES.test(file.name) || !SUPPORTED.test(file.name)) {
      status.textContent = 'Skipped: not a supported file';
    } else if (file.size > MAX_UPLOAD_BYTES) {
      status.textContent = `Skipped: ${size(file.size)} is over the 200 MB limit`;
      status.classList.add('is-error');
    } else {
      status.textContent = 'Waiting';
      jobs.push({ file, folderId: folderName ? folderIds.get(folderName)! : targetFolder, li });
    }
  }

  let succeeded = 0;
  let cutOffByCloudflare = false;
  const touched = new Set<string>();
  const runJob = async ({ file, folderId, li }: (typeof jobs)[number]) => {
    const status = $('.queue__status', li);
    const bar = $<HTMLElement>('.queue__bar span', li);
    let timer = 0;
    try {
      status.textContent = 'Uploading';
      const { url, key, contentType } = await api<{ url: string; key: string; contentType: string }>('upload-url', {
        id,
        fileName: file.name,
        size: file.size,
      });
      await putWithProgress(url, file, contentType, (p) => (bar.style.transform = `scaleX(${p})`));
      status.textContent = 'Uploaded, waiting for its turn to process';
      const result = await oneAtATime(() => {
        const started = Date.now();
        const tick = () => {
          const s = Math.floor((Date.now() - started) / 1000);
          status.textContent = `Removing metadata, converting if needed (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
        };
        tick();
        timer = window.setInterval(tick, 1000);
        return api<{ converted_from?: string }>('process', { id, key, fileName: file.name, folderId });
      });
      status.textContent = result.converted_from ? `Ready, converted from ${result.converted_from} to H.264 so it plays everywhere` : 'Ready';
      succeeded++;
      if (folderId) touched.add(folderId);
    } catch (e) {
      const err = e as Error & { reason?: string };
      if (err.message === 'cloudflare_timeout') cutOffByCloudflare = true;
      const known = UPLOAD_ERRORS[err.message];
      status.textContent = known ? `${known}${err.reason ? ` (${err.reason})` : ''}` : `Failed: ${err.message}`;
      status.classList.add('is-error');
    } finally {
      window.clearInterval(timer);
    }
  };

  // Two at a time: quicker for folders of creatives, still within the function limits.
  const queue = [...jobs];
  await Promise.all(
    [0, 1].map(async () => {
      while (queue.length) await runJob(queue.shift()!);
    }),
  );

  const notify = $<HTMLInputElement>('[data-notify]');
  if (succeeded > 0 && notify.checked && !notify.disabled) {
    const li = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    $('.queue__name', li).textContent = 'Client email';
    queueEl.append(li);
    try {
      const { sent, reason } = await api<{ sent: boolean; reason?: string }>('notify', { id, count: succeeded, folderIds: [...touched] });
      $('.queue__status', li).textContent = sent ? `Sent to ${state.client?.notify_email}` : `Not sent: ${NOTIFY_STATES[reason ?? ''] ?? reason}`;
    } catch (e) {
      $('.queue__status', li).textContent = `Not sent: ${(e as Error).message}`;
      $('.queue__status', li).classList.add('is-error');
    }
  }
  fileInput.value = '';
  folderInput.value = '';
  await refresh();
  // Requests Cloudflare cut off keep running on the server; look again for files that finished late.
  if (cutOffByCloudflare) [60_000, 180_000, 300_000].forEach((ms) => setTimeout(() => refresh(), ms));
}

fileInput.addEventListener('change', () => fileInput.files && uploadAll(Array.from(fileInput.files).map((file) => ({ file, folderName: null }))));
$('[data-pick-folder]').addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', () => {
  if (!folderInput.files) return;
  uploadAll(
    Array.from(folderInput.files).map((file) => ({
      file,
      folderName: (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] || null,
    })),
  );
});
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => (e.preventDefault(), drop.classList.add('is-over'))));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (e.dataTransfer?.items.length) uploadAll(await fromDrop(e.dataTransfer.items));
});

// ---------- Start ----------
loadList().then(() => select(state.selected && state.clients.some((c) => c.id === state.selected) ? state.selected : null));
