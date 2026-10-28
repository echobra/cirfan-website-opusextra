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
  if (bulkRunning && id) return;
  if (id) document.querySelector('[data-bulk]')?.toggleAttribute('hidden', true);
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

// ---------- Uploads (shared by one-client uploads and bulk uploads) ----------
type Pending = { file: File; path: string[] };
type Job = { file: File; folderId: string | null; li: HTMLLIElement };
type BatchResult = { succeeded: number; failed: number; touched: Set<string>; cutOff: boolean };

const queueTpl = () => $<HTMLTemplateElement>('#tpl-queue');

function queueRow(container: HTMLElement, label: string) {
  const li = queueTpl().content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  $('.queue__name', li).textContent = label;
  container.append(li);
  return li;
}

/** Why a file can't be uploaded, or null if it can. Checked before anything is sent. */
const skipReason = (file: File) =>
  SYSTEM_FILES.test(file.name) || !SUPPORTED.test(file.name)
    ? 'Skipped: not a supported file'
    : file.size > MAX_UPLOAD_BYTES
      ? `Skipped: ${size(file.size)} is over the 200 MB limit`
      : null;

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

/** Uploads two files at a time and processes them one at a time. Never throws; every outcome is shown on its line. */
async function runJobs(clientId: string, jobs: Job[], onDone?: () => void): Promise<BatchResult> {
  const result: BatchResult = { succeeded: 0, failed: 0, touched: new Set(), cutOff: false };
  const runJob = async ({ file, folderId, li }: Job) => {
    const status = $('.queue__status', li);
    const bar = $<HTMLElement>('.queue__bar span', li);
    let timer = 0;
    try {
      status.textContent = 'Uploading';
      const { url, key, contentType } = await api<{ url: string; key: string; contentType: string }>('upload-url', {
        id: clientId,
        fileName: file.name,
        size: file.size,
      });
      await putWithProgress(url, file, contentType, (p) => (bar.style.transform = `scaleX(${p})`));
      status.textContent = 'Uploaded, waiting for its turn to process';
      const done = await oneAtATime(() => {
        const started = Date.now();
        const tick = () => {
          const s = Math.floor((Date.now() - started) / 1000);
          status.textContent = `Removing metadata, converting if needed (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
        };
        tick();
        timer = window.setInterval(tick, 1000);
        return api<{ converted_from?: string }>('process', { id: clientId, key, fileName: file.name, folderId });
      });
      status.textContent = done.converted_from ? `Ready, converted from ${done.converted_from} to H.264 so it plays everywhere` : 'Ready';
      result.succeeded++;
      if (folderId) result.touched.add(folderId);
    } catch (e) {
      const err = e as Error & { reason?: string };
      if (err.message === 'cloudflare_timeout') result.cutOff = true;
      const known = UPLOAD_ERRORS[err.message];
      status.textContent = known ? `${known}${err.reason ? ` (${err.reason})` : ''}` : `Failed: ${err.message}`;
      status.classList.add('is-error');
      result.failed++;
    } finally {
      window.clearInterval(timer);
      onDone?.();
    }
  };
  const queue = [...jobs];
  await Promise.all(
    [0, 1].map(async () => {
      while (queue.length) await runJob(queue.shift()!);
    }),
  );
  return result;
}

/** Sends the "new files" email if the client is eligible. Returns a short line for the queue or summary. */
async function notifyClient(clientId: string, count: number, folderIds: string[]) {
  try {
    const { sent, reason } = await api<{ sent: boolean; reason?: string }>('notify', { id: clientId, count, folderIds });
    return sent ? 'Client emailed' : `Not emailed: ${(NOTIFY_STATES[reason ?? ''] ?? reason ?? '').toLowerCase()}`;
  } catch (e) {
    return `Not emailed: ${(e as Error).message}`;
  }
}

// Reads dropped files and folders, keeping each file's path (folder names, then the file name).
async function collectDrop(items: DataTransferItemList): Promise<Pending[]> {
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
  const walk = async (entry: FileSystemEntry, parents: string[]): Promise<void> => {
    if (entry.isFile) out.push({ file: await fileOf(entry as FileSystemFileEntry), path: [...parents, entry.name] });
    else for (const child of await readDir(entry as FileSystemDirectoryEntry)) await walk(child, [...parents, entry.name]);
  };
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));
  for (const entry of entries) await walk(entry, []);
  return out;
}

const fromFolderInput = (input: HTMLInputElement): Pending[] =>
  Array.from(input.files ?? []).map((file) => ({
    file,
    path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).split('/'),
  }));

// ---------- One client: files and folders dropped on its page ----------
const drop = $<HTMLLabelElement>('[data-drop]');
const fileInput = $<HTMLInputElement>('[data-file-input]');
const folderInput = $<HTMLInputElement>('[data-folder-input]');
const queueEl = $<HTMLUListElement>('[data-queue]');

async function uploadToSelected(pending: Pending[]) {
  const id = state.selected;
  if (!id || !pending.length) return;
  const targetFolder = state.view.kind === 'folder' ? state.view.id : null;

  // Everything inside one dropped folder lands in one folder on the page (reusing an active one with that name).
  const folderIds = new Map<string, string>();
  for (const name of new Set(pending.filter((p) => p.path.length > 1).map((p) => p.path[0]))) {
    const { folder } = await api<{ folder: FolderRow }>('create-folder', { id, name, reuse: true });
    folderIds.set(name, folder.id);
  }

  const jobs: Job[] = [];
  for (const { file, path } of pending) {
    const folderName = path.length > 1 ? path[0] : null;
    const li = queueRow(queueEl, folderName ? `${folderName} / ${file.name}` : file.name);
    const skip = skipReason(file);
    const status = $('.queue__status', li);
    status.textContent = skip ?? 'Waiting';
    if (skip) status.classList.toggle('is-error', skip.includes('limit'));
    else jobs.push({ file, folderId: folderName ? folderIds.get(folderName)! : targetFolder, li });
  }

  const result = await runJobs(id, jobs);
  const notify = $<HTMLInputElement>('[data-notify]');
  if (result.succeeded > 0 && notify.checked && !notify.disabled) {
    const li = queueRow(queueEl, 'Client email');
    $('.queue__status', li).textContent = await notifyClient(id, result.succeeded, [...result.touched]);
  }
  fileInput.value = '';
  folderInput.value = '';
  await refresh();
  // Requests Cloudflare cut off keep running on the server; look again for files that finished late.
  if (result.cutOff) [60_000, 180_000, 300_000].forEach((ms) => setTimeout(() => refresh(), ms));
}

fileInput.addEventListener('change', () => fileInput.files && uploadToSelected(Array.from(fileInput.files).map((file) => ({ file, path: [file.name] }))));
$('[data-pick-folder]').addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', () => uploadToSelected(fromFolderInput(folderInput)));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => (e.preventDefault(), drop.classList.add('is-over'))));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (e.dataTransfer?.items.length) uploadToSelected(await collectDrop(e.dataTransfer.items));
});

// ---------- Bulk upload: many clients in one drop ----------
// Top folder = client page (matched by name), folder inside it = folder on that page, files inside = deliverables.
type ClientPlan = {
  folder: string;
  target: string; // client id, 'new' to create a page, or '' to skip
  matches: ClientRow[];
  loose: Pending[];
  subfolders: Map<string, Pending[]>;
  existing: Set<string>; // "folder name|file name" already on the page
};

const bulkPanel = $<HTMLElement>('[data-bulk]');
const bulkDrop = $<HTMLLabelElement>('[data-bulk-drop]');
const bulkInput = $<HTMLInputElement>('[data-bulk-input]');
let plans: ClientPlan[] = [];
let bulkRunning = false;

const normalize = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// The page id is "<name-slug>-<12 random characters>"; the slug also counts as a name.
const slugOf = (id: string) => id.replace(/-[a-z2-9]{12}$/, '').replace(/-/g, ' ');
const matchesFor = (folder: string) => state.clients.filter((c) => normalize(c.name) === normalize(folder) || slugOf(c.id) === normalize(folder));

// The name a file will have once processed: same cleaning as the server, and videos always end in .mp4.
const storedName = (name: string) => {
  const clean = (name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'file').slice(0, 120);
  return /\.(mp4|m4v|mov|webm)$/i.test(clean) ? clean.replace(/\.[^.]+$/, '.mp4') : clean;
};
const existingKey = (folder: string, file: string) => `${normalize(folder)}|${storedName(file).toLowerCase()}`;

function showBulk(open: boolean) {
  bulkPanel.toggleAttribute('hidden', !open);
  if (open) {
    $('[data-detail-empty]').toggleAttribute('hidden', true);
    $('[data-detail]').toggleAttribute('hidden', true);
  } else select(state.selected);
}

$('[data-bulk-open]').addEventListener('click', () => {
  if (state.selected) {
    state.selected = null;
    renderList();
  }
  showBulk(true);
});
$('[data-bulk-close]').addEventListener('click', () => !bulkRunning && showBulk(false));

async function planFrom(pending: Pending[]) {
  if (!pending.length) return;
  await loadList();
  let items = pending.filter((p) => !SYSTEM_FILES.test(p.file.name));
  const note: string[] = [];

  // Dropped the folder that holds the client folders (e.g. "cirfan-client-work")? Look one level inside it.
  const tops = new Set(items.map((p) => p.path[0]));
  if (tops.size === 1 && items.every((p) => p.path.length > 2) && !matchesFor(items[0].path[0]).length) {
    note.push(`“${items[0].path[0]}” holds the client folders, so the folders inside it are used.`);
    items = items.map((p) => ({ ...p, path: p.path.slice(1) }));
  }
  const strays = items.filter((p) => p.path.length < 2);
  if (strays.length) note.push(`${strays.length} file${strays.length === 1 ? ' is' : 's are'} not inside a client folder and will be ignored.`);
  if (items.some((p) => p.path.length > 3)) note.push('Folders more than one level inside a client folder are merged into their parent folder.');

  const byClient = new Map<string, Pending[]>();
  for (const p of items.filter((x) => x.path.length >= 2)) {
    if (!byClient.has(p.path[0])) byClient.set(p.path[0], []);
    byClient.get(p.path[0])!.push(p);
  }

  plans = await Promise.all(
    [...byClient.entries()].map(async ([folder, files]): Promise<ClientPlan> => {
      const matches = matchesFor(folder);
      const subfolders = new Map<string, Pending[]>();
      const loose: Pending[] = [];
      for (const p of files) {
        if (p.path.length === 2) loose.push(p);
        else {
          if (!subfolders.has(p.path[1])) subfolders.set(p.path[1], []);
          subfolders.get(p.path[1])!.push(p);
        }
      }
      const plan: ClientPlan = { folder, target: matches.length === 1 ? matches[0].id : '', matches, loose, subfolders, existing: new Set() };
      if (plan.target) await loadExisting(plan);
      return plan;
    }),
  );
  plans.sort((a, b) => a.folder.localeCompare(b.folder));
  $('[data-bulk-note]').textContent = note.join(' ');
  renderPlan();
}

async function loadExisting(plan: ClientPlan) {
  plan.existing = new Set();
  if (!plan.target || plan.target === 'new') return;
  const { folders, files } = await api<{ folders: FolderRow[]; files: FileRow[] }>('get', { id: plan.target });
  const nameOf = (folderId: string | null) => (folderId ? folders.find((f) => f.id === folderId)?.name ?? '' : '');
  for (const f of files) {
    const folder = folders.find((x) => x.id === f.folder_id);
    if (folder?.archived_at) continue; // an archived folder never receives new files, so its contents don't count
    plan.existing.add(existingKey(nameOf(f.folder_id), f.file_name));
  }
}

const planCounts = (plan: ClientPlan) => {
  const all = [...plan.loose.map((p) => ({ p, folder: '' })), ...[...plan.subfolders].flatMap(([folder, ps]) => ps.map((p) => ({ p, folder })))];
  const skipIfExisting = $<HTMLInputElement>('[data-bulk-skip-existing]').checked;
  const already = all.filter(({ p, folder }) => skipIfExisting && plan.existing.has(existingKey(folder, p.file.name))).length;
  const invalid = all.filter(({ p }) => skipReason(p.file)).length;
  return { total: all.length, already, invalid, upload: all.length - already - invalid };
};

function renderPlan() {
  const body = $<HTMLTableSectionElement>('[data-bulk-rows]');
  body.replaceChildren();
  for (const plan of plans) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = plan.folder;
    const target = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'input input--small';
    select.setAttribute('aria-label', `Client page for ${plan.folder}`);
    const add = (value: string, label: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      o.selected = value === plan.target;
      select.append(o);
    };
    add('', plan.matches.length > 1 ? 'Several pages match: choose one' : 'No matching page: skip');
    add('new', `Create a new page “${plan.folder}”`);
    for (const c of state.clients) add(c.id, plan.matches.some((m) => m.id === c.id) ? `${c.name} (match)` : c.name);
    select.addEventListener('change', async () => {
      plan.target = select.value;
      await loadExisting(plan);
      renderPlan();
    });
    target.append(select);
    const contents = document.createElement('td');
    const c = planCounts(plan);
    const folderList = [...plan.subfolders.keys()];
    contents.textContent = [
      folderList.length ? `Folders: ${folderList.join(', ')}` : 'No folders',
      plan.loose.length ? `${plan.loose.length} loose` : '',
      `${c.upload} to upload`,
      c.already ? `${c.already} already on the page` : '',
      c.invalid ? `${c.invalid} skipped (type or size)` : '',
    ]
      .filter(Boolean)
      .join(', ');
    tr.append(name, target, contents);
    if (!plan.target) tr.className = 'is-skipped';
    body.append(tr);
  }
  const ready = plans.filter((p) => p.target && planCounts(p).upload > 0);
  $<HTMLButtonElement>('[data-bulk-start]').disabled = ready.length === 0;
  $('[data-bulk-summary]').textContent = ready.length
    ? `${ready.reduce((n, p) => n + planCounts(p).upload, 0)} files for ${ready.length} client page${ready.length === 1 ? '' : 's'}.`
    : 'Nothing to upload yet. Pick a page for each folder you want to send.';
  $('[data-bulk-plan]').toggleAttribute('hidden', plans.length === 0);
  $('[data-bulk-run]').toggleAttribute('hidden', true);
}

$('[data-bulk-skip-existing]').addEventListener('change', renderPlan);

// Keeps the screen awake and warns before closing the tab while a bulk upload runs.
let wakeLock: { release: () => Promise<void> } | null = null;
const guardLeave = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

$('[data-bulk-start]').addEventListener('click', async () => {
  const work = plans.filter((p) => p.target && planCounts(p).upload > 0);
  if (!work.length || bulkRunning) return;
  bulkRunning = true;
  const emailClients = $<HTMLInputElement>('[data-bulk-email]').checked;
  const skipIfExisting = $<HTMLInputElement>('[data-bulk-skip-existing]').checked;
  $('[data-bulk-plan]').toggleAttribute('hidden', true);
  $('[data-bulk-run]').toggleAttribute('hidden', false);
  $<HTMLButtonElement>('[data-bulk-close]').disabled = true;
  window.addEventListener('beforeunload', guardLeave);
  try {
    wakeLock = await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
  } catch {
    wakeLock = null;
  }

  const runList = $<HTMLUListElement>('[data-bulk-progress]');
  runList.replaceChildren();
  const totalFiles = work.reduce((n, p) => n + planCounts(p).upload, 0);
  let finished = 0;
  const tickTitle = () => (document.title = `${finished} of ${totalFiles} | Bulk upload | cirfan`);
  tickTitle();
  const summary: string[] = [];
  let cutOff = false;

  // One client after another, so each client's email goes out as soon as their files are ready.
  for (const plan of work) {
    const li = document.createElement('li');
    li.className = 'bulk-client';
    const head = document.createElement('p');
    head.className = 'bulk-client__head';
    const title = document.createElement('strong');
    const status = document.createElement('span');
    head.append(title, status);
    const details = document.createElement('details');
    const summ = document.createElement('summary');
    summ.textContent = 'Files';
    const files = document.createElement('ul');
    files.className = 'queue';
    details.append(summ, files);
    li.append(head, details);
    runList.append(li);
    title.textContent = plan.folder;
    status.textContent = 'Preparing';

    try {
      let clientId = plan.target;
      let created: ClientRow | null = null;
      if (clientId === 'new') {
        ({ client: created } = await api<{ client: ClientRow }>('create', { name: plan.folder, contactMethod: 'email', contactDetail: '' }));
        clientId = created.id;
      }
      const clientName = created?.name ?? state.clients.find((c) => c.id === clientId)?.name ?? plan.folder;
      title.textContent = `${plan.folder} → ${clientName}`;

      const folderIds = new Map<string, string>();
      for (const name of plan.subfolders.keys()) {
        const { folder } = await api<{ folder: FolderRow }>('create-folder', { id: clientId, name, reuse: true });
        folderIds.set(name, folder.id);
      }
      const jobs: Job[] = [];
      const entries = [...plan.loose.map((p) => ({ p, folder: '' })), ...[...plan.subfolders].flatMap(([folder, ps]) => ps.map((p) => ({ p, folder })))];
      for (const { p, folder } of entries) {
        const row = queueRow(files, folder ? `${folder} / ${p.file.name}` : p.file.name);
        const rowStatus = $('.queue__status', row);
        const skip = skipReason(p.file) ?? (skipIfExisting && plan.existing.has(existingKey(folder, p.file.name)) ? 'Skipped: already on the page' : null);
        if (skip) rowStatus.textContent = skip;
        else jobs.push({ file: p.file, folderId: folder ? folderIds.get(folder)! : null, li: row });
      }

      let done = 0;
      status.textContent = `0 of ${jobs.length} ready`;
      const result = await runJobs(clientId, jobs, () => {
        done++;
        finished++;
        tickTitle();
        status.textContent = `${done} of ${jobs.length} processed`;
      });
      cutOff ||= result.cutOff;

      let emailLine = '';
      if (created) emailLine = `New page, not emailed. Send the client this link: ${created.link}`;
      else if (!emailClients) emailLine = 'Not emailed (turned off for this upload)';
      else if (result.succeeded > 0) emailLine = await notifyClient(clientId, result.succeeded, [...result.touched]);
      const line = `${result.succeeded} added${result.failed ? `, ${result.failed} failed` : ''}. ${emailLine}`.trim();
      status.textContent = line;
      if (result.failed) {
        status.classList.add('is-error');
        details.open = true;
      }
      summary.push(`${clientName}: ${line}`);
    } catch (e) {
      status.textContent = `Stopped: ${(e as Error).message}`;
      status.classList.add('is-error');
      summary.push(`${plan.folder}: stopped (${(e as Error).message})`);
    }
  }

  document.title = `Done | Bulk upload | cirfan`;
  window.removeEventListener('beforeunload', guardLeave);
  await wakeLock?.release().catch(() => {});
  bulkRunning = false;
  $<HTMLButtonElement>('[data-bulk-close]').disabled = false;
  const done = document.createElement('li');
  done.className = 'bulk-client bulk-client--done';
  done.textContent = 'All done. Each line above shows what was added and whether the client was emailed.';
  runList.append(done);
  const { posted } = await api<{ posted: boolean }>('bulk-summary', { lines: summary }).catch(() => ({ posted: false }));
  if (posted) done.textContent += ' A summary was posted to Slack.';
  bulkInput.value = '';
  await loadList();
  if (cutOff) [60_000, 180_000, 300_000].forEach((ms) => setTimeout(() => loadList(), ms));
});

$('[data-bulk-cancel]').addEventListener('click', () => {
  plans = [];
  $('[data-bulk-plan]').toggleAttribute('hidden', true);
});
$('[data-bulk-pick]').addEventListener('click', () => bulkInput.click());
bulkInput.addEventListener('change', () => planFrom(fromFolderInput(bulkInput)));
['dragenter', 'dragover'].forEach((t) => bulkDrop.addEventListener(t, (e) => (e.preventDefault(), bulkDrop.classList.add('is-over'))));
['dragleave', 'drop'].forEach((t) => bulkDrop.addEventListener(t, () => bulkDrop.classList.remove('is-over')));
bulkDrop.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (!bulkRunning && e.dataTransfer?.items.length) planFrom(await collectDrop(e.dataTransfer.items));
});

// ---------- Start ----------
loadList().then(() => select(state.selected && state.clients.some((c) => c.id === state.selected) ? state.selected : null));
