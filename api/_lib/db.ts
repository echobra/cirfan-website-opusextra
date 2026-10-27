// api/_lib/db.ts
// Supabase (Postgres) client for server functions only. The service role key never reaches a browser.
// Tables are created by supabase/schema.sql.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export const db = () => {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
};

export type Actor = 'client' | 'admin' | 'system';

/** Writes one row to the activity log. Never throws: logging must not break the action it records. */
export const logEvent = async (
  clientId: string,
  actor: Actor,
  event: string,
  detail: Record<string, unknown> = {},
  meta: { ip?: string; userAgent?: string } = {},
) => {
  try {
    const { error } = await db()
      .from('events')
      .insert({ client_id: clientId, actor, event, detail, ip: meta.ip ?? null, user_agent: meta.userAgent ?? null });
    if (error) console.error('events insert failed:', error.message);
  } catch (error) {
    console.error('events insert failed:', (error as Error).message);
  }
};
