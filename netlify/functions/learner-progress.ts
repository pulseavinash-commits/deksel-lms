import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import type { PublishedCourseSnapshot, SlideState } from '../../shared/types';

export const config: Config = {
  path: ['/api/learn/progress/event', '/api/learn/progress/timer', '/api/learn/transcript'],
};

type EventType =
  | 'slide_opened'
  | 'explanation_started'
  | 'explanation_completed'
  | 'learner_question'
  | 'assessment_started';

const EVENT_STATE: Record<EventType, SlideState | null> = {
  slide_opened: null,
  explanation_started: 'explanation_in_progress',
  explanation_completed: 'explanation_completed',
  learner_question: null,
  assessment_started: 'assessment_in_progress',
};

/** States ranked so autosave never moves a slide backwards. */
const STATE_RANK: Record<SlideState, number> = {
  not_started: 0,
  explanation_in_progress: 1,
  explanation_completed: 2,
  assessment_pending: 3,
  assessment_in_progress: 4,
  corrective_required: 5,
  assessment_completed: 6,
  slide_completed: 7,
};

export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const claims = await requireLearnerSession(req);
  if (!claims) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const path = new URL(req.url).pathname;
  const d = db();

  try {
    // ---- POST /api/learn/progress/event -----------------------------------
    if (path === '/api/learn/progress/event') {
      const body = await readJson<{ type?: EventType; slide_id?: string; resume_state?: Record<string, unknown> }>(req);
      const type = body?.type;
      const slideId = body?.slide_id ?? '';
      if (!type || !(type in EVENT_STATE)) return err('Unknown event type', 400);
      if (!/^[0-9a-f-]{36}$/.test(slideId)) return err('Invalid slide id', 400);

      // Slide must exist in this session's frozen snapshot.
      const { data: session } = await d.from('learner_sessions')
        .select('id, status, course_version_id, resume_state').eq('id', claims.session_id).single();
      if (!session) return err('Session not found', 404);
      const { data: ver } = await d.from('course_versions').select('snapshot').eq('id', session.course_version_id).single();
      const snapshot = ver?.snapshot as PublishedCourseSnapshot;
      if (!snapshot?.slides.some((s) => s.slide_id === slideId)) return err('Slide not in course version', 400);

      // Upsert slide progress without ever regressing the state.
      const { data: existing } = await d.from('slide_progress')
        .select('*').eq('session_id', session.id).eq('slide_id', slideId).maybeSingle();

      const targetState = EVENT_STATE[type];
      if (!existing) {
        await d.from('slide_progress').insert({
          session_id: session.id,
          slide_id: slideId,
          state: targetState ?? 'not_started',
          explanation_completed_at: type === 'explanation_completed' ? isoNow() : null,
        });
      } else if (targetState && STATE_RANK[targetState] > STATE_RANK[existing.state as SlideState]) {
        await d.from('slide_progress').update({
          state: targetState,
          explanation_completed_at:
            type === 'explanation_completed' ? isoNow() : existing.explanation_completed_at,
          updated_at: isoNow(),
        }).eq('id', existing.id);
      }

      const patch: Record<string, unknown> = {
        current_slide_id: slideId,
        last_activity_at: isoNow(),
      };
      if (session.status === 'registered') patch.status = 'in_progress';
      if (body?.resume_state && typeof body.resume_state === 'object') {
        patch.resume_state = { ...(session.resume_state as object), ...body.resume_state };
      }
      await d.from('learner_sessions').update(patch).eq('id', session.id);
      return json({ ok: true });
    }

    // ---- POST /api/learn/progress/timer ------------------------------------
    if (path === '/api/learn/progress/timer') {
      const body = await readJson<{ active_delta?: number; inactive_delta?: number }>(req);
      // Deltas are clamped: the client syncs every ≤60s, so any larger delta
      // is rejected as tampering/clock drift.
      const active = Math.max(0, Math.min(90, Number(body?.active_delta) || 0));
      const inactive = Math.max(0, Math.min(600, Number(body?.inactive_delta) || 0));
      const { data: session } = await d.from('learner_sessions')
        .select('active_seconds, inactive_seconds, total_elapsed_seconds').eq('id', claims.session_id).single();
      if (!session) return err('Session not found', 404);
      await d.from('learner_sessions').update({
        active_seconds: session.active_seconds + Math.round(active),
        inactive_seconds: session.inactive_seconds + Math.round(inactive),
        total_elapsed_seconds: session.total_elapsed_seconds + Math.round(active + inactive),
        last_activity_at: isoNow(),
      }).eq('id', claims.session_id);
      return json({ ok: true });
    }

    // ---- POST /api/learn/transcript — store hidden transcript entries ------
    if (path === '/api/learn/transcript') {
      const body = await readJson<{ entries?: Array<{ slide_id?: string; role?: string; kind?: string; text?: string }> }>(req);
      const entries = (body?.entries ?? []).slice(0, 50);
      const rows = entries
        .filter((e) => ['trainer', 'learner'].includes(e.role ?? '') &&
                       ['teaching', 'question', 'answer', 'system'].includes(e.kind ?? '') &&
                       typeof e.text === 'string' && e.text.trim())
        .map((e) => ({
          session_id: claims.session_id,
          slide_id: e.slide_id && /^[0-9a-f-]{36}$/.test(e.slide_id) ? e.slide_id : null,
          role: e.role,
          kind: e.kind,
          text: (e.text as string).slice(0, 8000),
        }));
      if (rows.length) await d.from('transcripts').insert(rows);
      return json({ ok: true, stored: rows.length });
    }

    return err('Not found', 404);
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Save failed', 500, 'SAVE_FAILED');
  }
}
