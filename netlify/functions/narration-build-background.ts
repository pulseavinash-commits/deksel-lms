import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './_lib/db';
import { getGeminiConfig } from './_lib/settings';
import { ensureNarration } from './_lib/narration';
import type { PublishedCourseSnapshot } from '../../shared/types';

/**
 * Netlify BACKGROUND function (the `-background` filename suffix gives it up to
 * 15 minutes instead of the ~26s synchronous limit). It renders one slide's
 * narration (script -> TTS) and caches it in Netlify Blobs.
 *
 * It is invoked server-to-server by learner-narration and is NOT publicly
 * usable: the caller must present an HMAC of "slideId.courseVersionId" keyed
 * by SESSION_SECRET, so the browser can never drive TTS spend directly.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null) as
    | { slideId?: string; courseVersionId?: string; sig?: string } | null;
  const slideId = body?.slideId ?? '';
  const courseVersionId = body?.courseVersionId ?? '';
  const sig = body?.sig ?? '';
  if (!slideId || !courseVersionId || !sig) return new Response('Bad request', { status: 400 });

  const secret = process.env.SESSION_SECRET ?? '';
  const expected = createHmac('sha256', secret).update(`${slideId}.${courseVersionId}`).digest('hex');
  const ok = sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return new Response('Forbidden', { status: 403 });

  const { data: ver } = await db().from('course_versions')
    .select('snapshot').eq('id', courseVersionId).single();
  const snapshot = ver?.snapshot as PublishedCourseSnapshot | undefined;
  const slide = snapshot?.slides.find((s) => s.slide_id === slideId);
  if (!snapshot || !slide) return new Response('Not found', { status: 404 });

  try {
    const cfg = await getGeminiConfig();
    await ensureNarration(slide, snapshot, cfg.voice);
  } catch (e) {
    console.error('background narration failed', e);
  }
  return new Response('ok');
}
