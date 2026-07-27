import type { Config } from '@netlify/functions';
import { db } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import { rateLimit } from './_lib/ratelimit';
import { createHmac } from 'node:crypto';
import { getGeminiConfig } from './_lib/settings';
import {
  narrationStatus, markNarrationGenerating, getNarrationScript,
  getNarrationAudio, narrationHash, loadKnowledge,
  ensureTts, getTtsAudio,
} from './_lib/narration';
import type { PublishedCourseSnapshot, PublishedSlide } from '../../shared/types';

export const config: Config = {
  path: [
    '/api/learn/narration',
    '/api/learn/narration/audio/:slideId',
    '/api/learn/tts',
    '/api/learn/tts/audio/:hash',
  ],
};

const UUID = /^[0-9a-f-]{36}$/;
const HEX = /^[0-9a-f]{16,64}$/;

/** Load the learner's session snapshot + one slide from it. */
async function slideForSession(sessionId: string, slideId: string): Promise<
  { snapshot: PublishedCourseSnapshot; slide: PublishedSlide; courseVersionId: string } | null
> {
  const d = db();
  const { data: session } = await d.from('learner_sessions')
    .select('course_version_id').eq('id', sessionId).maybeSingle();
  if (!session) return null;
  const { data: ver } = await d.from('course_versions')
    .select('snapshot').eq('id', session.course_version_id).single();
  const snapshot = ver?.snapshot as PublishedCourseSnapshot | undefined;
  const slide = snapshot?.slides.find((s) => s.slide_id === slideId);
  if (!snapshot || !slide) return null;
  return { snapshot, slide, courseVersionId: session.course_version_id };
}

function audioResponse(buf: ArrayBuffer): Response {
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      // Content-addressed by hash → safe to cache aggressively per-user.
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ---- GET narration audio ------------------------------------------------
  let m = path.match(/^\/api\/learn\/narration\/audio\/([0-9a-f-]{36})$/);
  if (m) {
    const learner = await requireLearnerSession(req);
    if (!learner) return err('Session expired', 401, 'SESSION_EXPIRED');
    const slideId = m[1];
    const ctx = await slideForSession(learner.session_id, slideId);
    if (!ctx) return err('Not found', 404);
    const cfg = await getGeminiConfig();
    const hash = url.searchParams.get('v') || narrationHash(ctx.slide, await loadKnowledge(ctx.slide), cfg.voice);
    const buf = await getNarrationAudio(slideId, hash);
    if (!buf) return err('Narration not generated yet', 404, 'NOT_READY');
    return audioResponse(buf);
  }

  // ---- GET tts audio ------------------------------------------------------
  m = path.match(/^\/api\/learn\/tts\/audio\/([0-9a-f]{16,64})$/);
  if (m) {
    const learner = await requireLearnerSession(req);
    if (!learner) return err('Session expired', 401, 'SESSION_EXPIRED');
    const buf = await getTtsAudio(m[1]);
    if (!buf) return err('Audio not generated yet', 404, 'NOT_READY');
    return audioResponse(buf);
  }

  // ---- POST endpoints (generation) ---------------------------------------
  if (req.method !== 'POST') return err('Method not allowed', 405);
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const learner = await requireLearnerSession(req);
  if (!learner) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (!process.env.GEMINI_API_KEY) return err('Narration is not configured', 503, 'TTS_FAILED');

  // ---- POST /api/learn/narration { slide_id } ----------------------------
  // Non-blocking: returns the cached audio if ready, otherwise kicks off a
  // background render and returns { ready:false } so the client can poll.
  if (path === '/api/learn/narration') {
    const body = await readJson<{ slide_id?: string }>(req);
    const slideId = body?.slide_id ?? '';
    if (!UUID.test(slideId)) return err('Invalid slide id', 400);
    const ctx = await slideForSession(learner.session_id, slideId);
    if (!ctx) return err('Slide not in your course version', 404);

    try {
      const cfg = await getGeminiConfig();
      const st = await narrationStatus(ctx.slide, cfg.voice);
      if (st.ready) {
        const script = await getNarrationScript(slideId, st.hash);
        return json({ ready: true, audio_url: `/api/learn/narration/audio/${slideId}?v=${st.hash}`, script });
      }
      // Not cached yet — start a background render unless one is already running.
      if (!st.generating) {
        if (!(await rateLimit('narration', learner.session_id, 20, 10 * 60))) {
          return err('Too many requests. Please wait a moment.', 429);
        }
        await markNarrationGenerating(slideId, st.hash);
        const sig = createHmac('sha256', process.env.SESSION_SECRET ?? '')
          .update(`${slideId}.${ctx.courseVersionId}`).digest('hex');
        // Fire the background function; abort after 3s so we return quickly.
        // Aborting the request does not stop the background job on Netlify.
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 3000);
        try {
          await fetch(`${new URL(req.url).origin}/.netlify/functions/narration-build-background`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slideId, courseVersionId: ctx.courseVersionId, sig }),
            signal: ac.signal,
          });
        } catch { /* expected on abort; job runs independently */ }
        finally { clearTimeout(to); }
      }
      return json({ ready: false, status: 'generating' }, 202);
    } catch (e) {
      console.error('narration request failed', e);
      return err('Could not prepare the narration. Please try again.', 502, 'TTS_FAILED');
    }
  }

  // ---- POST /api/learn/tts { text } --------------------------------------
  if (path === '/api/learn/tts') {
    const body = await readJson<{ text?: string }>(req);
    const text = (body?.text ?? '').trim().slice(0, 800);
    if (!text) return err('No text provided', 400);
    if (!(await rateLimit('tts', learner.session_id, 90, 10 * 60))) {
      return err('Too many requests. Please wait a moment.', 429);
    }
    try {
      const cfg = await getGeminiConfig();
      const hash = await ensureTts(text, cfg.voice);
      return json({ audio_url: `/api/learn/tts/audio/${hash}`, hash });
    } catch (e) {
      console.error('tts generation failed', e);
      return err('Could not prepare the audio. Please try again.', 502, 'TTS_FAILED');
    }
  }

  return err('Not found', 404);
}
