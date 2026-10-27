// api/_lib/security.ts
// Password hashing (scrypt), session tokens and the admin Basic Auth check.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Format: scrypt$N$r$p$salt$hash (base64url). Only the hash is stored, never the password. */
export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
};

export const verifyPassword = async (password: string, stored: string) => {
  const [scheme, n, r, p, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const key = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
};

export const newToken = () => randomBytes(32).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison (hashing first makes the lengths equal). */
export const safeEqual = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export const ADMIN_REALM = 'cirfan admin';

/** Exact match against ADMIN_USERNAME and ADMIN_PASSWORD. Fails closed if either is missing. */
export const isAdmin = (request: Request) => {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const userOk = safeEqual(decoded.slice(0, split), user);
  const passOk = safeEqual(decoded.slice(split + 1), pass);
  return userOk && passOk;
};

export const unauthorized = () =>
  new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
  });
