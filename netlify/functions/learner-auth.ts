import type { Config } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { db } from './_lib/db';
import { json, err, csrfCheck, readJson, clientIp } from './_lib/http';
import {
  issueLearnerCookie, clearLearnerCookie, requireLearnerAccess, requireLearnerSession,
} from './_lib/auth';
import { rateLimit } from './_lib/ratelimit';
import { getSetting } from './_lib/settings';

export const config: Config = {
  path: ['/api/learn/access', '/api/learn/register', '/api/learn/me', '/api/learn/logout'],
};

export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const path = new URL(req.url).pathname;
  const d = db();

  // ---- POST /api/learn/access — verify the learner access password ---------
  if (path === '/api/learn/access' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!(await rateLimit('learner-access', ip, 10, 15 * 60))) {
      return err('Too many attempts. Please try again in 15 minutes.', 429);
    }
    const body = await readJson<{ password?: string }>(req);
    const pw = body?.password ?? '';
    if (!pw || pw.length > 200) return err('Password required', 400);

    // Prefer the rotated hash in settings; fall back to the bootstrap env var.
    const storedHash = await getSetting<string | null>('learner_password_hash', null);
    let ok = false;
    if (storedHash) {
      ok = await bcrypt.compare(pw, storedHash);
    } else if (process.env.LEARNER_ACCESS_PASSWORD) {
      // Constant-time-ish compare of equal-length digests.
      const a = new TextEncoder().encode(pw);
      const b = new TextEncoder().encode(process.env.LEARNER_ACCESS_PASSWORD);
      ok = a.length === b.length && a.every((v, i) => v === b[i]);
    }
    if (!ok) return err('Incorrect access password', 401);

    const cookie = await issueLearnerCookie({ sub: '', session_id: '', access: true });
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  // ---- POST /api/learn/register — collect learner details ------------------
  if (path === '/api/learn/register' && req.method === 'POST') {
    const claims = await requireLearnerAccess(req);
    if (!claims) return err('Access verification required', 401);
    const body = await readJson<{
      name?: string; designation?: string; headquarter?: string; employee_code?: string;
    }>(req);
    const name = (body?.name ?? '').trim().slice(0, 120);
    const designation = (body?.designation ?? '').trim().slice(0, 120);
    const headquarter = (body?.headquarter ?? '').trim().slice(0, 120);
    const employee_code = (body?.employee_code ?? '').trim().slice(0, 60) || null;
    if (!name || !designation || !headquarter) {
      return err('Name, designation and headquarter are required', 400);
    }

    // Latest published course version.
    const { data: course } = await d.from('courses').select('*').eq('status', 'published').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (!course) return err('No published course is available yet. Please contact your administrator.', 404, 'NO_COURSE');
    const { data: version } = await d.from('course_versions')
      .select('id, version').eq('course_id', course.id).eq('version', course.current_version).single();
    if (!version) return err('Published course version missing', 500);

    const { data: learner, error: lerr } = await d.from('learners')
      .insert({ name, designation, headquarter, employee_code }).select('*').single();
    if (lerr) return err(lerr.message, 500);

    const { data: session, error: serr } = await d.from('learner_sessions').insert({
      learner_id: learner.id,
      course_id: course.id,
      course_version_id: version.id,
      status: 'registered',
    }).select('*').single();
    if (serr) return err(serr.message, 500);

    const cookie = await issueLearnerCookie({ sub: learner.id, session_id: session.id, access: true });
    return json({ ok: true, session_id: session.id }, 200, { 'Set-Cookie': cookie });
  }

  // ---- GET /api/learn/me ----------------------------------------------------
  if (path === '/api/learn/me' && req.method === 'GET') {
    const claims = await requireLearnerAccess(req);
    if (!claims) return json({ access: false, registered: false });
    if (!claims.session_id) return json({ access: true, registered: false });
    const { data: session } = await d.from('learner_sessions')
      .select('id, status, learners(name)').eq('id', claims.session_id).maybeSingle();
    if (!session) return json({ access: true, registered: false });
    return json({
      access: true,
      registered: true,
      session_id: session.id,
      status: session.status,
      name: (session.learners as unknown as { name: string })?.name ?? '',
    });
  }

  // ---- POST /api/learn/logout -----------------------------------------------
  if (path === '/api/learn/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearLearnerCookie() });
  }

  return err('Not found', 404);
}
