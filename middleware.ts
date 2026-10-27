// middleware.ts
// Vercel Routing Middleware. Puts the browser's own username and password prompt in front of the dashboard,
// the same approach as the Mediacrater test site. Credentials come from ADMIN_USERNAME and ADMIN_PASSWORD
// and must match exactly. api/admin.ts checks them again on every request.

// Same response as next() from @vercel/functions: tells Vercel to continue to the requested page.
// Written out here so the site doesn't need that package (its dependency tree currently has a high audit finding).
const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export const config = {
  matcher: ['/admin', '/admin.html', '/admin/:path*'],
};

const REALM = 'cirfan admin';

const digest = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

// Compares hashes byte by byte without stopping early, so timing reveals nothing.
const sameText = async (a: string, b: string) => {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
};

const decodeBasic = (header: string) => {
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const split = text.indexOf(':');
    return split < 0 ? null : { user: text.slice(0, split), pass: text.slice(split + 1) };
  } catch {
    return null;
  }
};

export default async function middleware(request: Request) {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Basic ') ? decodeBasic(header) : null;

  if (user && pass && given) {
    const [userOk, passOk] = await Promise.all([sameText(given.user, user), sameText(given.pass, pass)]);
    if (userOk && passOk) return next();
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
