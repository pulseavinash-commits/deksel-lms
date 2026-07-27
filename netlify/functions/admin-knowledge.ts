import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import { audit } from './_lib/audit';
import { store, safeKey, STORE_KNOWLEDGE_PROCESSED } from './_lib/blobs';
import type { KnowledgePackage, KnowledgeSection } from '../../shared/types';

export const config: Config = {
  path: '/api/admin/knowledge/:slideId',
};

/**
 * GET  /api/admin/knowledge/:slideId  — preview extracted knowledge package
 * PUT  /api/admin/knowledge/:slideId  — edit sections / approve for publishing
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);

  const m = new URL(req.url).pathname.match(/^\/api\/admin\/knowledge\/([0-9a-f-]{36})$/);
  if (!m) return err('Not found', 404);
  const slideId = m[1];

  const s = store(STORE_KNOWLEDGE_PROCESSED);
  const key = safeKey('slide', slideId);

  if (req.method === 'GET') {
    const pkg = (await s.get(key, { type: 'json' })) as KnowledgePackage | null;
    if (!pkg) return err('No processed knowledge for this slide', 404);
    return json({ package: pkg });
  }

  if (req.method === 'PUT') {
    const body = await readJson<{ sections?: KnowledgeSection[]; approve?: boolean }>(req);
    if (!body) return err('Invalid body');
    const pkg = (await s.get(key, { type: 'json' })) as KnowledgePackage | null;
    if (!pkg) return err('No processed knowledge for this slide', 404);

    if (Array.isArray(body.sections)) {
      const sections = body.sections
        .filter((x) => typeof x?.heading === 'string' && typeof x?.content === 'string')
        .map((x) => ({ heading: x.heading.slice(0, 200), content: x.content.slice(0, 20000) }))
        .slice(0, 60);
      if (sections.length === 0) return err('At least one section is required', 400);
      pkg.sections = sections;
      pkg.full_text = sections.map((x) => `${x.heading}\n${x.content}`).join('\n\n');
      pkg.edited_by_admin = true;
      await s.setJSON(key, pkg);
    }

    if (body.approve) {
      await db().from('slides').update({ knowledge_status: 'ready', knowledge_error: null, updated_at: isoNow() }).eq('id', slideId);
    }
    await audit(admin.sub, 'knowledge.edit', { slide_id: slideId, approved: !!body.approve });
    return json({ ok: true });
  }

  return err('Method not allowed', 405);
}
