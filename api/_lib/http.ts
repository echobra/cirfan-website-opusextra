// api/_lib/http.ts
// Small helpers shared by every server function: origin checks, JSON in/out, client IP.

export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://cirfan.com';

export const allowedOrigins = () => {
  const origins = new Set<string>([SITE_ORIGIN, 'https://cirfan.com', 'https://www.cirfan.com']);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = process.env[key];
    if (host) origins.add(`https://${host}`);
  }
  // `vercel dev` runs on localhost:3000.
  if (!process.env.VERCEL || process.env.VERCEL_ENV === 'development') origins.add('http://localhost:3000');
  return origins;
};

/** Browsers always send Origin on POST. Anything else is a script, a bot or another site. */
export const isSameSiteRequest = (request: Request) => {
  const origin = request.headers.get('origin');
  return Boolean(origin && allowedOrigins().has(origin));
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export const go = (path: string) =>
  new Response(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });

/** Reads a JSON body with a size cap. Returns null when the body is missing, too big, or not an object. */
export const readJson = async (request: Request, maxBytes = 64_000): Promise<Record<string, unknown> | null> => {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return null;
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const clientIp = (request: Request) =>
  (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim().slice(0, 64);

export const userAgent = (request: Request) => (request.headers.get('user-agent') ?? '').slice(0, 300);

/** Single-line text: control characters removed, trimmed, capped. */
export const line = (value: unknown, max: number) =>
  typeof value === 'string' ? value.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '';

export const getCookie = (request: Request, name: string) => {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
};
