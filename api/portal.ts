// api/portal.ts
// Client delivery pages API (POST /api/portal). Each page (/c/<id>) is locked by a password the client creates
// on their first visit. Sign-in lasts PORTAL_SESSION_DAYS (default 183, about six months) in an HttpOnly cookie
// that page scripts cannot read. Every visit, sign-in, click, preview and download is logged with a timestamp.
import { db, logEvent } from './_lib/db.js';
import { json, line, readJson, isSameSiteRequest, clientIp, userAgent, getCookie } from './_lib/http.js';
import { hashPassword, verifyPassword, newToken, sha256 } from './_lib/security.js';
import { signedDownload, signedPreview } from './_lib/storage.js';

const ID_PATTERN = /^[a-z0-9-]{8,80}$/;
const SESSION_DAYS = Math.max(1, Number(process.env.PORTAL_SESSION_DAYS ?? 183));
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;
const LOCK_AFTER_FAILURES = 8;
const LOCK_MINUTES = 15;

// Events the page itself may report. Sign-ins, links and errors are logged by the server, not the browser.
const TRACKABLE = new Set([
  'click',
  'video_play',
  'video_pause',
  'video_ended',
  'preview_failed',
  'download_completed',
  'download_failed',
  'page_hidden',
  'page_visible',
]);

const cookieName = (id: string) => `cp_${id}`;

const sessionCookie = (id: string, token: string) =>
  `${cookieName(id)}=${token}; Path=/api/portal; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;

const clearCookie = (id: string) => `${cookieName(id)}=; Path=/api/portal; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

const cleanDetail = (value: unknown) => {
  const out: Record<string, string | number | boolean> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 6)) {
    if (!/^[a-z_]{1,24}$/.test(key)) continue;
    if (typeof raw === 'string') out[key] = line(raw, 200);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'boolean') out[key] = raw;
  }
  return out;
};

const hasSession = async (request: Request, id: string) => {
  const token = getCookie(request, cookieName(id));
  if (!token || token.length > 100) return false;
  const { data } = await db()
    .from('sessions')
    .select('token_hash')
    .eq('token_hash', sha256(token))
    .eq('client_id', id)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return Boolean(data);
};

const startSession = async (id: string, meta: { ip: string; userAgent: string }) => {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  const { error } = await db()
    .from('sessions')
    .insert({ token_hash: sha256(token), client_id: id, expires_at: expires, ip: meta.ip, user_agent: meta.userAgent });
  if (error) throw error;
  return token;
};

const lockedUntil = async (id: string) => {
  const since = new Date(Date.now() - LOCK_MINUTES * 60 * 1000).toISOString();
  const { data } = await db()
    .from('events')
    .select('created_at')
    .eq('client_id', id)
    .eq('event', 'login_failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(LOCK_AFTER_FAILURES);
  if (!data || data.length < LOCK_AFTER_FAILURES) return null;
  return new Date(new Date(data[0].created_at).getTime() + LOCK_MINUTES * 60 * 1000);
};

export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) return json({ error: 'forbidden' }, 403);
  const body = await readJson(request, 8_000);
  if (!body) return json({ error: 'bad_request' }, 400);

  const action = line(body.action, 40);
  const id = line(body.id, 80);
  const meta = { ip: clientIp(request), userAgent: userAgent(request) };
  if (!ID_PATTERN.test(id)) return json({ state: 'missing' }, 404);

  try {
    const { data: client } = await db()
      .from('clients')
      .select('id, name, contact_method, contact_detail, password_hash')
      .eq('id', id)
      .maybeSingle();
    if (!client) return json({ state: 'missing' }, 404);

    switch (action) {
      case 'status': {
        let state = !client.password_hash ? 'setup' : (await hasSession(request, id)) ? 'ready' : 'login';
        if (state === 'login' && (await lockedUntil(id))) state = 'locked';
        await logEvent(id, 'client', 'page_view', { state }, meta);
        return json({ state, minPassword: MIN_PASSWORD });
      }

      case 'setup': {
        const password = typeof body.password === 'string' ? body.password : '';
        if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return json({ error: 'weak_password' }, 400);
        // Only succeeds if no password exists yet, even if two people submit at the same moment.
        const { data: updated, error } = await db()
          .from('clients')
          .update({ password_hash: await hashPassword(password), password_set_at: new Date().toISOString() })
          .eq('id', id)
          .is('password_hash', null)
          .select('id');
        if (error) throw error;
        if (!updated?.length) return json({ error: 'already_set' }, 409);
        const token = await startSession(id, meta);
        await logEvent(id, 'client', 'password_created', {}, meta);
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(id, token) });
      }

      case 'login': {
        if (!client.password_hash) return json({ error: 'no_password' }, 409);
        const until = await lockedUntil(id);
        if (until) {
          await logEvent(id, 'client', 'login_blocked', { until: until.toISOString() }, meta);
          return json({ error: 'locked', until: until.toISOString() }, 429);
        }
        const password = typeof body.password === 'string' ? body.password.slice(0, MAX_PASSWORD) : '';
        if (!password || !(await verifyPassword(password, client.password_hash))) {
          await logEvent(id, 'client', 'login_failed', {}, meta);
          return json({ error: 'wrong_password' }, 401);
        }
        const token = await startSession(id, meta);
        await logEvent(id, 'client', 'login_success', {}, meta);
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(id, token) });
      }

      case 'logout': {
        const token = getCookie(request, cookieName(id));
        if (token) await db().from('sessions').delete().eq('token_hash', sha256(token));
        await logEvent(id, 'client', 'logout', {}, meta);
        return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(id) });
      }

      case 'files': {
        if (!(await hasSession(request, id))) return json({ error: 'signed_out' }, 401);
        const { data: files, error } = await db()
          .from('files')
          .select('id, file_name, kind, content_type, size_bytes, created_at, storage_key')
          .eq('client_id', id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json({
          client: { name: client.name, contactMethod: client.contact_method, contactDetail: client.contact_detail },
          files: await Promise.all(
            (files ?? []).map(async ({ storage_key, ...f }) => ({ ...f, previewUrl: await signedPreview(storage_key) })),
          ),
        });
      }

      case 'download': {
        if (!(await hasSession(request, id))) return json({ error: 'signed_out' }, 401);
        const fileId = line(body.fileId, 40);
        const { data: file } = await db()
          .from('files')
          .select('id, file_name, storage_key, size_bytes')
          .eq('id', fileId)
          .eq('client_id', id)
          .maybeSingle();
        if (!file) {
          await logEvent(id, 'client', 'download_denied', { file_id: fileId }, meta);
          return json({ error: 'not_found' }, 404);
        }
        const url = await signedDownload(file.storage_key, file.file_name, 300);
        await logEvent(id, 'client', 'download_link_issued', { file: file.file_name, file_id: file.id }, meta);
        return json({ url, fileName: file.file_name, size: file.size_bytes });
      }

      case 'track': {
        const event = line(body.event, 40);
        if (!TRACKABLE.has(event)) return json({ error: 'unknown_event' }, 400);
        const signedIn = await hasSession(request, id);
        await logEvent(id, 'client', event, { ...cleanDetail(body.detail), signed_in: signedIn }, meta);
        return json({ ok: true });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (error) {
    console.error(`portal ${action} failed:`, (error as Error).message);
    return json({ error: 'server_error' }, 500);
  }
}
