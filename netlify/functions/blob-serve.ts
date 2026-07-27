import type { Config } from '@netlify/functions';
import { requireAdmin, requireLearnerSession } from './_lib/auth';
import { err } from './_lib/http';
import { store, STORE_SLIDE_ASSETS } from './_lib/blobs';
import { db } from './_lib/db';
import type { PublishedCourseSnapshot } from '../../shared/types';

export const config: Config = {
  path: '/api/asset/:slideId',
};

/**
 * GET /api/asset/:slideId — serve a slide visual to an authenticated admin
 * or a registered learner. Keys are always server-derived from the slide id,
 * never taken from user input, so no path traversal is possible.
 */
export default async function handler(req: Request): Promise<Response> {
  const m = new URL(req.url).pathname.match(/^\/api\/asset\/([0-9a-f-]{36})$/);
  if (!m) return err('Not found', 404);
  const slideId = m[1];

  const admin = await requireAdmin(req);
  const learner = admin ? null : await requireLearnerSession(req);
  if (!admin && !learner) return err('Not authenticated', 401);

  // A learner may only fetch a visual that belongs to a slide in their own
  // session's course version.
  if (learner) {
    const { data: session } = await db().from('learner_sessions')
      .select('course_version_id').eq('id', learner.session_id).maybeSingle();
    if (!session) return err('Session not found', 404);
    const { data: ver } = await db().from('course_versions')
      .select('snapshot').eq('id', session.course_version_id).single();
    const snapshot = ver?.snapshot as PublishedCourseSnapshot | undefined;
    if (!snapshot?.slides.some((s) => s.slide_id === slideId)) return err('Not found', 404);
  }

  const blob = await store(STORE_SLIDE_ASSETS).getWithMetadata(`asset/${slideId}`, { type: 'arrayBuffer' });
  if (!blob || !blob.data) return err('Asset not found', 404);
  const mime = (blob.metadata?.mime as string) ?? 'application/octet-stream';
  return new Response(blob.data, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
