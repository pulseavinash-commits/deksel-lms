import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import type { PublishedCourseSnapshot } from '../../shared/types';

export const config: Config = {
  path: '/api/learn/rating',
};

/**
 * POST /api/learn/rating — final course rating. Module completion happens
 * HERE and only here: every active slide completed + rating submitted.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const claims = await requireLearnerSession(req);
  if (!claims) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const body = await readJson<{
    overall?: number; clarity?: number; usefulness?: number; feedback?: string;
  }>(req);
  const overall = Number(body?.overall);
  const clarity = Number(body?.clarity);
  const usefulness = Number(body?.usefulness);
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  if (!valid(overall) || !valid(clarity) || !valid(usefulness)) {
    return err('All three ratings (1–5) are required', 400);
  }
  const feedback = (body?.feedback ?? '').trim().slice(0, 4000) || null;

  const d = db();
  const { data: session } = await d.from('learner_sessions')
    .select('*').eq('id', claims.session_id).single();
  if (!session) return err('Session not found', 404);

  // All active slides in this session's version must be completed first.
  const { data: ver } = await d.from('course_versions')
    .select('snapshot').eq('id', session.course_version_id).single();
  const snapshot = ver?.snapshot as PublishedCourseSnapshot;
  const { data: progress } = await d.from('slide_progress')
    .select('slide_id, state').eq('session_id', session.id);
  const incomplete = snapshot.slides.filter(
    (s) => !(progress ?? []).some((p) => p.slide_id === s.slide_id && p.state === 'slide_completed'),
  );
  if (incomplete.length > 0) {
    return err(`Complete all slides first (${incomplete.length} remaining)`, 409, 'SLIDES_INCOMPLETE');
  }

  const { error } = await d.from('ratings').upsert({
    session_id: session.id, overall, clarity, usefulness, feedback,
  }, { onConflict: 'session_id' });
  if (error) return err(error.message, 500);

  // Module completion: slides done + assessments done (implied by slide state)
  // + rating submitted. Timer/last-slide alone never complete the module.
  await d.from('learner_sessions').update({
    status: 'completed',
    completed_at: session.completed_at ?? isoNow(),
    last_activity_at: isoNow(),
  }).eq('id', session.id);

  return json({ ok: true, module_completed: true });
}
