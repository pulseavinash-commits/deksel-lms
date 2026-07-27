import type { Config } from '@netlify/functions';
import { db } from './_lib/db';
import { json, err, csrfCheck } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import { getGeminiConfig } from './_lib/settings';
import type { PublishedCourseSnapshot } from '../../shared/types';

export const config: Config = {
  path: '/api/learn/course',
};

/**
 * GET /api/learn/course — the exact published snapshot bound to this
 * learner's session (never the live draft), plus saved progress for resume.
 * Expected answers/keywords are stripped before sending to the browser.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const claims = await requireLearnerSession(req);
  if (!claims) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (req.method !== 'GET') return err('Method not allowed', 405);

  const d = db();
  const { data: session } = await d.from('learner_sessions').select('*').eq('id', claims.session_id).maybeSingle();
  if (!session) return err('Session not found', 404);

  const { data: version } = await d.from('course_versions')
    .select('version, snapshot').eq('id', session.course_version_id).single();
  if (!version) return err('Course version not found', 404);
  const snapshot = version.snapshot as PublishedCourseSnapshot;

  const { data: progress } = await d.from('slide_progress').select('*').eq('session_id', session.id);
  const { data: rating } = await d.from('ratings').select('id').eq('session_id', session.id).maybeSingle();
  const { data: attempts } = await d.from('assessment_attempts')
    .select('slide_id, question_position, attempt_number, is_corrective, passed, score, feedback, question, created_at')
    .eq('session_id', session.id).order('created_at');

  // Never ship expected answers or keyword lists to the learner's browser.
  const safeSlides = snapshot.slides
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => ({
      slide_id: s.slide_id,
      slide_number: s.slide_number,
      title: s.title,
      learning_objective: s.learning_objective,
      key_message: s.key_message,
      display_order: s.display_order,
      has_asset: !!s.asset_key,
      passing_score: s.passing_score,
      max_attempts: s.max_attempts,
      questions: s.questions.map((q) => ({
        position: q.position,
        question_type: q.question_type,
        // Question text is delivered at assessment time by the server;
        // admin-written text may be shown, but answers never leave the server.
        question: q.question,
      })),
    }));

  return json({
    session: {
      session_id: session.id,
      status: session.status,
      started_at: session.started_at,
      total_elapsed_seconds: session.total_elapsed_seconds,
      active_seconds: session.active_seconds,
      inactive_seconds: session.inactive_seconds,
      current_slide_id: session.current_slide_id,
      resume_state: session.resume_state,
      rating_submitted: !!rating,
    },
    course: {
      title: snapshot.title,
      description: snapshot.description,
      version: version.version,
      expected_duration_minutes: snapshot.expected_duration_minutes,
      inactivity_warning_seconds: snapshot.inactivity_warning_seconds,
      inactivity_stop_seconds: snapshot.inactivity_stop_seconds,
      slides: safeSlides,
    },
    progress: progress ?? [],
    attempts: attempts ?? [],
    privacy: await (async () => {
      const g = await getGeminiConfig();
      return { store_raw_audio: g.store_raw_audio, data_retention_days: g.data_retention_days };
    })(),
  });
}
