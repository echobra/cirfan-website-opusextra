// api/admin.ts
// Dashboard API (POST /api/admin). Protected twice: middleware.ts asks the browser for the admin username and
// password, and every request here is checked again against ADMIN_USERNAME and ADMIN_PASSWORD (exact match).
//
// Environment variables: ADMIN_USERNAME, ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and for client email updates
// RESEND_API_KEY, NOTIFY_FROM_EMAIL, NEXT_PUBLIC_EMAIL (optional R2_JURISDICTION, SITE_ORIGIN).
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, logEvent } from './_lib/db.js';
import { json, line, readJson, isSameSiteRequest, clientIp, userAgent, SITE_ORIGIN } from './_lib/http.js';
import { isAdmin, unauthorized } from './_lib/security.js';
import {
  signedUpload,
  signedPreview,
  downloadToFile,
  uploadFromFile,
  removeObject,
  removePrefix,
  safeFileName,
} from './_lib/storage.js';
import { VIDEO_TYPES, IMAGE_TYPES, extensionOf, stripVideo, stripImage, ProcessingError } from './_lib/strip.js';
import { EMAIL_PATTERN, notifyConfigured, sendUploadEmail } from './_lib/notify.js';
import { escapeSlack, postToSlack } from './_lib/slack.js';

// /tmp holds the original and the cleaned copy at once, and Vercel gives functions 512 MB of /tmp.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9-]{8,80}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const linkFor = (id: string) => `${SITE_ORIGIN}/c/${id}`;

const newClientId = (name: string) => {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'client';
  // 12 random characters: about 59 bits, so links cannot be guessed.
  const suffix = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${slug}-${suffix}`;
};

const contactMethod = (value: unknown) => (value === 'slack' ? 'slack' : 'email');

const notifyEmail = (value: unknown) => {
  const email = line(value, 254);
  return email && EMAIL_PATTERN.test(email) ? email : null;
};

const folderName = (value: unknown) => line(value, 120).replace(/[\\/]+/g, '-');

const clientRow = async (id: string) => {
  if (!ID_PATTERN.test(id)) return null;
  const { data } = await db()
    .from('clients')
    .select('id, name, password_hash, notify_email, notify_enabled, last_notified_at')
    .eq('id', id)
    .maybeSingle();
  return data;
};

const folderOf = async (id: string, folderId: unknown) => {
  const value = line(folderId, 40);
  if (!UUID_PATTERN.test(value)) return null;
  const { data } = await db().from('folders').select('id, name, archived_at').eq('id', value).eq('client_id', id).maybeSingle();
  return data;
};

/** Email updates go only to clients who created their password and have opened the page. */
const notifyState = async (client: {
  id: string;
  password_hash: string | null;
  notify_email: string | null;
  notify_enabled: boolean;
}) => {
  if (!client.notify_enabled) return 'off';
  if (!client.notify_email) return 'no_email';
  if (!notifyConfigured()) return 'not_configured';
  if (!client.password_hash) return 'waiting';
  const { data } = await db()
    .from('events')
    .select('id')
    .eq('client_id', client.id)
    .in('event', ['password_created', 'login_success'])
    .limit(1);
  return data?.length ? 'ready' : 'waiting';
};

export function GET(request: Request) {
  if (!isAdmin(request)) return unauthorized();
  return json({ ok: true });
}

export async function POST(request: Request) {
  if (!isAdmin(request)) return unauthorized();
  if (!isSameSiteRequest(request)) return json({ error: 'forbidden' }, 403);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const action = line(body.action, 40);
  const id = line(body.id, 80);
  const meta = { ip: clientIp(request), userAgent: userAgent(request) };

  try {
    if (action === 'list') {
      const { data, error } = await db().from('client_overview').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return json({ clients: (data ?? []).map((c) => ({ ...c, link: linkFor(c.id) })) });
    }

    if (action === 'create') {
      const name = line(body.name, 120);
      if (!name) return json({ error: 'name_required' }, 400);
      const method = contactMethod(body.contactMethod);
      const detail = line(body.contactDetail, 200);
      const row = {
        id: newClientId(name),
        name,
        contact_method: method,
        contact_detail: detail,
        notify_email: notifyEmail(body.notifyEmail) ?? (method === 'email' ? notifyEmail(detail) : null),
        notify_enabled: body.notifyEnabled !== false,
      };
      const { error } = await db().from('clients').insert(row);
      if (error) throw error;
      await logEvent(row.id, 'admin', 'page_created', { name }, meta);
      return json({ client: { ...row, link: linkFor(row.id) } });
    }

    // Optional: a summary of a bulk upload, posted to SLACK_ADMIN_WEBHOOK when it is set.
    if (action === 'bulk-summary') {
      if (!process.env.SLACK_ADMIN_WEBHOOK) return json({ posted: false, reason: 'not_configured' });
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 100).map((l) => escapeSlack(line(l, 400)));
      const posted = await postToSlack(process.env.SLACK_ADMIN_WEBHOOK, {
        text: 'Bulk upload finished',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Bulk upload finished' } },
          { type: 'section', text: { type: 'mrkdwn', text: lines.map((l) => `• ${l}`).join('\n').slice(0, 2900) || 'Nothing uploaded.' } },
        ],
      });
      return json({ posted });
    }

    // Everything below works on one existing client page.
    const client = await clientRow(id);
    if (!client) return json({ error: 'not_found' }, 404);

    switch (action) {
      case 'get': {
        const { data: overview, error } = await db().from('client_overview').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        const [{ data: folders }, { data: files }, { data: events }] = await Promise.all([
          db().from('folders').select('id, name, archived_at, created_at').eq('client_id', id).order('created_at', { ascending: false }),
          db()
            .from('files')
            .select('id, folder_id, file_name, kind, content_type, size_bytes, width, height, archived_at, created_at, storage_key')
            .eq('client_id', id)
            .order('created_at', { ascending: false }),
          db()
            .from('events')
            .select('id, actor, event, detail, ip, user_agent, created_at')
            .eq('client_id', id)
            .order('created_at', { ascending: false })
            .limit(2000),
        ]);
        const withPreviews = await Promise.all(
          (files ?? []).map(async ({ storage_key, ...f }) => ({ ...f, previewUrl: await signedPreview(storage_key) })),
        );
        return json({
          client: { ...overview, link: linkFor(id), notify_state: await notifyState(client) },
          folders: folders ?? [],
          files: withPreviews,
          events: events ?? [],
        });
      }

      case 'update': {
        const name = line(body.name, 120);
        if (!name) return json({ error: 'name_required' }, 400);
        const { error } = await db()
          .from('clients')
          .update({
            name,
            contact_method: contactMethod(body.contactMethod),
            contact_detail: line(body.contactDetail, 200),
            notify_email: notifyEmail(body.notifyEmail),
            notify_enabled: body.notifyEnabled !== false,
          })
          .eq('id', id);
        if (error) throw error;
        await logEvent(id, 'admin', 'page_updated', { name }, meta);
        return json({ ok: true });
      }

      case 'reset-password': {
        await db().from('clients').update({ password_hash: null, password_set_at: null }).eq('id', id);
        await db().from('sessions').delete().eq('client_id', id);
        await logEvent(id, 'admin', 'password_reset', {}, meta);
        return json({ ok: true });
      }

      case 'end-sessions': {
        await db().from('sessions').delete().eq('client_id', id);
        await logEvent(id, 'admin', 'sessions_ended', {}, meta);
        return json({ ok: true });
      }

      case 'delete': {
        await removePrefix(`clients/${id}/`);
        await removePrefix(`incoming/${id}/`);
        const { error } = await db().from('clients').delete().eq('id', id);
        if (error) throw error;
        return json({ ok: true });
      }

      // ---------- Folders ----------
      case 'create-folder': {
        const name = folderName(body.name);
        if (!name) return json({ error: 'name_required' }, 400);
        // Uploading a folder with the same name as an active folder adds to it instead of making a duplicate.
        if (body.reuse === true) {
          const { data: existing } = await db()
            .from('folders')
            .select('id, name, archived_at, created_at')
            .eq('client_id', id)
            .eq('name', name)
            .is('archived_at', null)
            .limit(1);
          if (existing?.length) return json({ folder: existing[0] });
        }
        const { data, error } = await db()
          .from('folders')
          .insert({ client_id: id, name })
          .select('id, name, archived_at, created_at')
          .single();
        if (error) throw error;
        await logEvent(id, 'admin', 'folder_created', { folder: name }, meta);
        return json({ folder: data });
      }

      case 'rename-folder': {
        const folder = await folderOf(id, body.folderId);
        const name = folderName(body.name);
        if (!folder) return json({ error: 'not_found' }, 404);
        if (!name) return json({ error: 'name_required' }, 400);
        await db().from('folders').update({ name }).eq('id', folder.id);
        await logEvent(id, 'admin', 'folder_renamed', { from: folder.name, to: name }, meta);
        return json({ ok: true });
      }

      case 'archive-folder': {
        const folder = await folderOf(id, body.folderId);
        if (!folder) return json({ error: 'not_found' }, 404);
        const archived = body.archived === true;
        await db().from('folders').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', folder.id);
        await logEvent(id, 'admin', archived ? 'folder_archived' : 'folder_restored', { folder: folder.name }, meta);
        return json({ ok: true });
      }

      case 'delete-folder': {
        const folder = await folderOf(id, body.folderId);
        if (!folder) return json({ error: 'not_found' }, 404);
        const { data: files } = await db().from('files').select('storage_key').eq('folder_id', folder.id);
        for (const f of files ?? []) await removeObject(f.storage_key);
        await db().from('folders').delete().eq('id', folder.id);
        await logEvent(id, 'admin', 'folder_deleted', { folder: folder.name, files: files?.length ?? 0 }, meta);
        return json({ ok: true });
      }

      // ---------- Files ----------
      case 'upload-url': {
        const fileName = line(body.fileName, 200);
        const size = Number(body.size);
        const ext = extensionOf(fileName);
        const contentType = VIDEO_TYPES[ext] ?? IMAGE_TYPES[ext];
        if (!contentType) return json({ error: 'unsupported_type' }, 400);
        if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return json({ error: 'too_large' }, 400);
        const key = `incoming/${id}/${randomUUID()}.${ext}`;
        return json({ url: await signedUpload(key, contentType), key, contentType });
      }

      case 'process': {
        const key = line(body.key, 200);
        const match = key.match(new RegExp(`^incoming/${id}/(${UUID})\\.([a-z0-9]+)$`));
        if (!match) return json({ error: 'bad_key' }, 400);
        const [, fileId, ext] = match;
        if (!VIDEO_TYPES[ext] && !IMAGE_TYPES[ext]) return json({ error: 'unsupported_type' }, 400);
        const isVideo = Boolean(VIDEO_TYPES[ext]);
        let folderId: string | null = null;
        if (body.folderId) {
          const folder = await folderOf(id, body.folderId);
          if (!folder) return json({ error: 'folder_not_found' }, 404);
          folderId = folder.id;
        }
        // Videos always come out as browser-safe .mp4.
        const outExt = isVideo ? 'mp4' : ext;
        const contentType = isVideo ? 'video/mp4' : IMAGE_TYPES[ext];
        const original = safeFileName(line(body.fileName, 200) || `${fileId}.${ext}`);
        const fileName = isVideo ? original.replace(/\.[^.]+$/, '') + '.mp4' : original;

        const dir = await mkdtemp(join(tmpdir(), 'strip-'));
        try {
          const input = join(dir, `in.${ext}`);
          const output = join(dir, `out.${outExt}`);
          await downloadToFile(key, input);
          let leftovers: string[];
          let width: number;
          let height: number;
          let detail: Record<string, unknown> = {};
          if (isVideo) {
            const result = await stripVideo(input, output);
            ({ leftovers, width, height } = result);
            detail = result.converted ? { converted_from: result.source, converted_to: 'H.264 MP4' } : { format: result.source };
          } else {
            ({ leftovers, width, height } = await stripImage(input, output, ext));
          }
          if (leftovers.length) {
            await removeObject(key);
            await logEvent(id, 'system', 'metadata_leak', { file: fileName, fields: leftovers.join(', ') }, meta);
            return json({ error: 'metadata_leak', fields: leftovers }, 422);
          }
          const finalKey = `clients/${id}/${fileId}.${outExt}`;
          const size = await uploadFromFile(finalKey, output, contentType);
          await removeObject(key);
          const { data, error } = await db()
            .from('files')
            .insert({
              id: fileId,
              client_id: id,
              folder_id: folderId,
              storage_key: finalKey,
              file_name: fileName,
              kind: isVideo ? 'video' : 'image',
              content_type: contentType,
              size_bytes: size,
              width,
              height,
            })
            .select('id, folder_id, file_name, kind, content_type, size_bytes, width, height, archived_at, created_at')
            .single();
          if (error) throw error;
          await logEvent(id, 'system', 'file_added', { file: fileName, size, metadata: 'cleared', ...detail }, meta);
          return json({ file: data, ...detail });
        } catch (error) {
          await removeObject(key).catch(() => {});
          // Known conversion problems get a clear answer in the dashboard and a line in the activity log.
          if (error instanceof ProcessingError) {
            await logEvent(id, 'system', 'processing_failed', { file: fileName, problem: error.code, reason: error.reason }, meta);
            return json({ error: error.code, reason: error.reason }, 422);
          }
          await logEvent(id, 'system', 'processing_failed', { file: fileName, reason: (error as Error).message.slice(0, 200) }, meta);
          throw error;
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }

      case 'move-file':
      case 'archive-file':
      case 'delete-file': {
        const fileId = line(body.fileId, 40);
        const { data: file } = await db()
          .from('files')
          .select('id, storage_key, file_name')
          .eq('id', fileId)
          .eq('client_id', id)
          .maybeSingle();
        if (!file) return json({ error: 'not_found' }, 404);

        if (action === 'delete-file') {
          await removeObject(file.storage_key);
          await db().from('files').delete().eq('id', file.id);
          await logEvent(id, 'admin', 'file_removed', { file: file.file_name }, meta);
        } else if (action === 'archive-file') {
          const archived = body.archived === true;
          await db().from('files').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', file.id);
          await logEvent(id, 'admin', archived ? 'file_archived' : 'file_restored', { file: file.file_name }, meta);
        } else {
          const folder = body.folderId ? await folderOf(id, body.folderId) : null;
          if (body.folderId && !folder) return json({ error: 'folder_not_found' }, 404);
          await db().from('files').update({ folder_id: folder?.id ?? null }).eq('id', file.id);
          await logEvent(id, 'admin', 'file_moved', { file: file.file_name, to: folder?.name ?? 'no folder' }, meta);
        }
        return json({ ok: true });
      }

      // ---------- Email update after an upload batch ----------
      case 'notify': {
        const state = await notifyState(client);
        if (state !== 'ready') return json({ sent: false, reason: state });
        const count = Math.max(1, Math.min(500, Math.floor(Number(body.count) || 0)));
        const folderIds = Array.isArray(body.folderIds) ? body.folderIds.slice(0, 50) : [];
        const names: string[] = [];
        for (const fid of folderIds) {
          const folder = await folderOf(id, fid);
          if (folder) names.push(folder.name);
        }
        await sendUploadEmail({ to: client.notify_email!, clientName: client.name, link: linkFor(id), count, folders: names, site: SITE_ORIGIN });
        await db().from('clients').update({ last_notified_at: new Date().toISOString() }).eq('id', id);
        await logEvent(id, 'system', 'client_emailed', { to: client.notify_email, files: count, folders: names.join(', ') }, meta);
        return json({ sent: true });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (error) {
    console.error(`admin ${action} failed:`, (error as Error).message);
    return json({ error: 'server_error' }, 500);
  }
}
