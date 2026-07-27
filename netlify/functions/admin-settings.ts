import type { Config } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import { audit } from './_lib/audit';
import { setSetting, getSetting } from './_lib/settings';

export const config: Config = {
  path: '/api/admin/learner-password',
};

/**
 * GET — whether a learner access password is set
 * PUT — rotate the learner access password (stored as bcrypt hash only)
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);

  if (req.method === 'GET') {
    const hash = await getSetting<string | null>('learner_password_hash', null);
    return json({ set: !!hash || !!process.env.LEARNER_ACCESS_PASSWORD });
  }

  if (req.method === 'PUT') {
    const body = await readJson<{ password?: string }>(req);
    const pw = body?.password ?? '';
    if (pw.length < 6 || pw.length > 100) return err('Password must be 6–100 characters', 400);
    const hash = await bcrypt.hash(pw, 12);
    await setSetting('learner_password_hash', hash);
    await audit(admin.sub, 'learner_password.rotate', {});
    return json({ ok: true });
  }

  return err('Method not allowed', 405);
}
