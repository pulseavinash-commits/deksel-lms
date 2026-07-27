import type { Config } from '@netlify/functions';
import { db } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import { rateLimit } from './_lib/ratelimit';
import { store, STORE_KNOWLEDGE_PROCESSED } from './_lib/blobs';
import { getGeminiConfig } from './_lib/settings';
import { buildTeachingInstruction, createEphemeralToken } from './_lib/gemini';
import type { KnowledgePackage, PublishedCourseSnapshot } from '../../shared/types';

export const config: Config = {
  path: '/api/learn/gemini-token',
};

/**
 * POST /api/learn/gemini-token  { slide_id }
 *
 * Creates a short-lived Gemini Live ephemeral token for ONE slide-level
 * teaching session. The system instruction — including the strict knowledge
 * rule and the slide's approved knowledge package — is locked into the token
 * server-side, so the browser can neither read another slide's knowledge nor
 * widen the scope. The permanent GEMINI_API_KEY never leaves the server.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const claims = await requireLearnerSession(req);
  if (!claims) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (req.method !== 'POST') return err('Method not allowed', 405);

  if (!(await rateLimit('gemini-token', claims.session_id, 30, 10 * 60))) {
    return err('Too many session requests. Please wait a few minutes.', 429);
  }
  if (!process.env.GEMINI_API_KEY) return err('AI trainer is not configured', 503, 'TOKEN_FAILED');

  const body = await readJson<{ slide_id?: string }>(req);
  const slideId = body?.slide_id ?? '';
  if (!/^[0-9a-f-]{36}$/.test(slideId)) return err('Invalid slide id', 400);

  const d = db();
  const { data: session } = await d.from('learner_sessions')
    .select('id, course_version_id').eq('id', claims.session_id).single();
  if (!session) return err('Session not found', 404);
  const { data: ver } = await d.from('course_versions')
    .select('snapshot').eq('id', session.course_version_id).single();
  const snapshot = ver?.snapshot as PublishedCourseSnapshot;
  const slide = snapshot?.slides.find((s) => s.slide_id === slideId);
  if (!slide) return err('Slide not in your course version', 404);

  // Load ONLY this slide's frozen knowledge package.
  let knowledge: KnowledgePackage | null = null;
  if (slide.knowledge_processed_key) {
    knowledge = (await store(STORE_KNOWLEDGE_PROCESSED)
      .get(slide.knowledge_processed_key, { type: 'json' })) as KnowledgePackage | null;
  }

  const laterTopics = snapshot.slides
    .filter((s) => s.display_order > slide.display_order)
    .map((s) => ({ slide_number: s.slide_number, title: s.title }));

  const instruction = buildTeachingInstruction(slide, knowledge, snapshot.slides.length, laterTopics);
  const cfg = await getGeminiConfig();

  try {
    const { token, expiresAt } = await createEphemeralToken(cfg.live_model, instruction, cfg.voice);
    if (!token) throw new Error('Empty token returned');
    return json({
      token,                    // short-lived, single-use — safe for the browser
      expires_at: expiresAt,
      model: cfg.live_model,
      voice: cfg.voice,
    });
  } catch (e) {
    console.error('ephemeral token failed', e);
    return err('Could not start the AI trainer session. Please try again.', 502, 'TOKEN_FAILED');
  }
}
