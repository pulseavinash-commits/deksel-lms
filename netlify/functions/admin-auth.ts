import type { Config } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { db } from './_lib/db';
import { json, err, csrfCheck, readJson, clientIp } from './_lib/http';
import { issueAdminCookie, clearAdminCookie, requireAdmin } from './_lib/auth';
import { rateLimit } from './_lib/ratelimit';
import { audit } from './_lib/audit';

export const config: Config = {
  path: ['/api/admin/login', '/api/admin/logout', '/api/admin/me', '/api/admin/bootstrap'],
};

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!csrfCheck(req)) return err('CSRF check failed', 403);

  // ---- POST /api/admin/bootstrap ------------------------------------------
  // One-time creation of the first admin from env vars. No-ops if any admin
  // already exists, so it is safe to leave exposed.
  if (url.pathname === '/api/admin/bootstrap' && req.method === 'POST') {
    const { count } = await db().from('admins').select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) return json({ ok: true, created: false });
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password || password.length < 10) {
      return err('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) in environment variables first', 400);
    }
    const hash = await bcrypt.hash(password, 12);
    const { error } = await db().from('admins').insert({ email: email.toLowerCase(), password_hash: hash });
    if (error) return err(error.message, 500);
    await audit(null, 'admin.bootstrap', { email });
    return json({ ok: true, created: true });
  }

  // ---- POST /api/admin/login ----------------------------------------------
  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!(await rateLimit('admin-login', ip, 8, 15 * 60))) {
      return err('Too many login attempts. Try again in 15 minutes.', 429);
    }
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = (body?.email ?? '').trim().toLowerCase();
    const password = body?.password ?? '';
    if (!email || !password || email.length > 200 || password.length > 200) {
      return err('Email and password are required', 400);
    }
    const { data: admin } = await db().from('admins').select('*').eq('email', email).maybeSingle();
    // Constant-shape response: hash compare even when the user is missing.
    const hash = admin?.password_hash ?? '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBl5nGvXkXo0N8p1nZq0hHqYyC1p2u';
    const ok = await bcrypt.compare(password, hash);
    if (!admin || !ok) return err('Invalid email or password', 401);

    const cookie = await issueAdminCookie({ sub: admin.id, email: admin.email, role: 'admin' });
    await audit(admin.id, 'admin.login', { ip });
    return json({ ok: true, email: admin.email }, 200, { 'Set-Cookie': cookie });
  }

  // ---- POST /api/admin/logout ---------------------------------------------
  if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie() });
  }

  // ---- GET /api/admin/me ----------------------------------------------------
  if (url.pathname === '/api/admin/me' && req.method === 'GET') {
    const claims = await requireAdmin(req);
    if (!claims) return err('Not authenticated', 401);
    return json({ email: claims.email, role: claims.role });
  }

  return err('Not found', 404);
}
