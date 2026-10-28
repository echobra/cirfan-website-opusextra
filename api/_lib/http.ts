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

// ---------- Visitor IP ----------
// Vercel puts the address that connected to it in x-real-ip. When the domain is proxied through Cloudflare
// (orange cloud), that address is a Cloudflare server, and the visitor's real IP is in cf-connecting-ip.
// That header is only trusted when the connection really came from Cloudflare; otherwise anyone could fake it.
// Ranges from https://www.cloudflare.com/ips (last changed Sep 28, 2023).
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const v4ToInt = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
};

const v6ToBigInt = (ip: string): bigint | null => {
  if (!/^[0-9a-f:.]+$/i.test(ip) || ip.split('::').length > 2) return null;
  let text = ip;
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped tail, e.g. ::ffff:1.2.3.4
  if (tail) {
    const n = v4ToInt(tail[1]);
    if (n === null) return null;
    text = text.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest ? rest.split(':') : [];
  const missing = 8 - a.length - b.length;
  if (rest === undefined ? a.length !== 8 : missing < 1) return null;
  const groups = [...a, ...Array(rest === undefined ? 0 : missing).fill('0'), ...b];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
};

const inV4 = (ip: number, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return ((ip & mask) >>> 0) === ((v4ToInt(base)! & mask) >>> 0);
};

const inV6 = (ip: bigint, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const shift = BigInt(128 - Number(bits));
  return ip >> shift === v6ToBigInt(base)! >> shift;
};

export const isIp = (value: string) => v4ToInt(value) !== null || v6ToBigInt(value) !== null;

export const isCloudflare = (ip: string) => {
  const v4 = v4ToInt(ip);
  if (v4 !== null) return CLOUDFLARE_V4.some((c) => inV4(v4, c));
  const v6 = v6ToBigInt(ip);
  return v6 !== null && CLOUDFLARE_V6.some((c) => inV6(v6, c));
};

export const clientIp = (request: Request) => {
  const direct = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  const viaCloudflare = (request.headers.get('cf-connecting-ip') ?? '').trim();
  if (viaCloudflare && isIp(viaCloudflare) && isCloudflare(direct)) return viaCloudflare.slice(0, 64);
  return direct.slice(0, 64);
};

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
