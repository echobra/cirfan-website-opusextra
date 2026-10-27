// api/admin.ts
// Dashboard API (POST /api/admin). Protected twice: middleware.ts asks the browser for the admin username and
// password, and every request here is checked again against ADMIN_USERNAME and ADMIN_PASSWORD (exact match).
//
// Environment variables: ADMIN_USERNAME, ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (optional R2_JURISDICTION, SITE_ORIGIN).
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
import { VIDEO_TYPES, IMAGE_TYPES, extensionOf, stripVideo, stripImage } from './_lib/strip.js';

// /tmp holds the original and the cleaned copy at once, and Vercel gives functions 512 MB of /tmp.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9-]{8,80}$/;
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

const clientExists = async (id: string) => {
  if (!ID_PATTERN.test(id)) return false;
  const { data } = await db().from('clients').select('id').eq('id', id).maybeSingle();
  return Boolean(data);
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
    switch (action) {
      case 'list': {
        const { data, error } = await db().from('client_overview').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return json({ clients: (data ?? []).map((c) => ({ ...c, link: linkFor(c.id) })) });
      }

      case 'create': {
        const name = line(body.name, 120);
        if (!name) return json({ error: 'name_required' }, 400);
        const row = {
          id: newClientId(name),
          name,
          contact_method: contactMethod(body.contactMethod),
          contact_detail: line(body.contactDetail, 200),
        };
        const { error } = await db().from('clients').insert(row);
        if (error) throw error;
        await logEvent(row.id, 'admin', 'page_created', { name }, meta);
        return json({ client: { ...row, link: linkFor(row.id) } });
      }

      case 'get': {
        if (!ID_PATTERN.test(id)) return json({ error: 'not_found' }, 404);
        const { data: client, error } = await db().from('client_overview').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!client) return json({ error: 'not_found' }, 404);
        const { data: files } = await db()
          .from('files')
          .select('id, file_name, kind, content_type, size_bytes, created_at, storage_key')
          .eq('client_id', id)
          .order('created_at', { ascending: false });
        const { data: events } = await db()
          .from('events')
          .select('id, actor, event, detail, ip, user_agent, created_at')
          .eq('client_id', id)
          .order('created_at', { ascending: false })
          .limit(2000);
        const withPreviews = await Promise.all(
          (files ?? []).map(async ({ storage_key, ...f }) => ({ ...f, previewUrl: await signedPreview(storage_key) })),
        );
        return json({ client: { ...client, link: linkFor(id) }, files: withPreviews, events: events ?? [] });
      }

      case 'update': {
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
        const name = line(body.name, 120);
        if (!name) return json({ error: 'name_required' }, 400);
        const { error } = await db()
          .from('clients')
          .update({ name, contact_method: contactMethod(body.contactMethod), contact_detail: line(body.contactDetail, 200) })
          .eq('id', id);
        if (error) throw error;
        await logEvent(id, 'admin', 'page_updated', { name }, meta);
        return json({ ok: true });
      }

      case 'reset-password': {
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
        await db().from('clients').update({ password_hash: null, password_set_at: null }).eq('id', id);
        await db().from('sessions').delete().eq('client_id', id);
        await logEvent(id, 'admin', 'password_reset', {}, meta);
        return json({ ok: true });
      }

      case 'end-sessions': {
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
        await db().from('sessions').delete().eq('client_id', id);
        await logEvent(id, 'admin', 'sessions_ended', {}, meta);
        return json({ ok: true });
      }

      case 'delete': {
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
        await removePrefix(`clients/${id}/`);
        await removePrefix(`incoming/${id}/`);
        const { error } = await db().from('clients').delete().eq('id', id);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'upload-url': {
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
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
        if (!(await clientExists(id))) return json({ error: 'not_found' }, 404);
        const key = line(body.key, 200);
        const match = key.match(new RegExp(`^incoming/${id}/(${UUID})\\.([a-z0-9]+)$`));
        if (!match) return json({ error: 'bad_key' }, 400);
        const [, fileId, ext] = match;
        const contentType = VIDEO_TYPES[ext] ?? IMAGE_TYPES[ext];
        if (!contentType) return json({ error: 'unsupported_type' }, 400);
        const kind = VIDEO_TYPES[ext] ? 'video' : 'image';
        const fileName = safeFileName(line(body.fileName, 200) || `${fileId}.${ext}`);

        const dir = await mkdtemp(join(tmpdir(), 'strip-'));
        try {
          const input = join(dir, `in.${ext}`);
          const output = join(dir, `out.${ext}`);
          await downloadToFile(key, input);
          const leftovers = kind === 'video' ? await stripVideo(input, output, ext) : await stripImage(input, output, ext);
          if (leftovers.length) {
            await removeObject(key);
            await logEvent(id, 'system', 'metadata_leak', { file: fileName, fields: leftovers.join(', ') }, meta);
            return json({ error: 'metadata_leak', fields: leftovers }, 422);
          }
          const finalKey = `clients/${id}/${fileId}.${ext}`;
          const size = await uploadFromFile(finalKey, output, contentType);
          await removeObject(key);
          const { data, error } = await db()
            .from('files')
            .insert({ id: fileId, client_id: id, storage_key: finalKey, file_name: fileName, kind, content_type: contentType, size_bytes: size })
            .select('id, file_name, kind, content_type, size_bytes, created_at')
            .single();
          if (error) throw error;
          await logEvent(id, 'system', 'file_added', { file: fileName, size, metadata: 'cleared' }, meta);
          return json({ file: data });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }

      case 'delete-file': {
        const fileId = line(body.fileId, 40);
        const { data: file } = await db()
          .from('files')
          .select('id, storage_key, file_name')
          .eq('id', fileId)
          .eq('client_id', id)
          .maybeSingle();
        if (!file) return json({ error: 'not_found' }, 404);
        await removeObject(file.storage_key);
        await db().from('files').delete().eq('id', file.id);
        await logEvent(id, 'admin', 'file_removed', { file: file.file_name }, meta);
        return json({ ok: true });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (error) {
    console.error(`admin ${action} failed:`, (error as Error).message);
    return json({ error: 'server_error' }, 500);
  }
}
