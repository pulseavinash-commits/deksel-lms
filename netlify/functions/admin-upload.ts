import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import { audit } from './_lib/audit';
import {
  store, safeKey, sniffMime,
  STORE_SLIDE_ASSETS, STORE_KNOWLEDGE_DOCS, STORE_KNOWLEDGE_PROCESSED,
} from './_lib/blobs';
import { extractText, cleanText, sectionize, buildPackage } from './_lib/knowledge';
import { IMAGE_MIMES, DOC_MIMES, MAX_IMAGE_BYTES, MAX_DOC_BYTES } from '../../shared/types';

export const config: Config = {
  path: '/api/admin/upload/:kind/:slideId',
};

/**
 * POST /api/admin/upload/asset/:slideId      (multipart form field "file")
 * POST /api/admin/upload/knowledge/:slideId
 *
 * Knowledge documents are processed inline (extract → clean → sectionize →
 * package). Small course documents process in well under the function limit;
 * failures set knowledge_status = 'failed' with an error the admin can see.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);
  if (req.method !== 'POST') return err('Method not allowed', 405);

  const m = new URL(req.url).pathname.match(/^\/api\/admin\/upload\/(asset|knowledge)\/([0-9a-f-]{36})$/);
  if (!m) return err('Not found', 404);
  const [, kind, slideId] = m;

  const d = db();
  const { data: slide } = await d.from('slides').select('*').eq('id', slideId).maybeSingle();
  if (!slide) return err('Slide not found', 404);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Expected multipart/form-data with a "file" field', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return err('Missing file', 400);

  const allowed = kind === 'asset' ? IMAGE_MIMES : DOC_MIMES;
  const maxBytes = kind === 'asset' ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
  if (!allowed.includes(file.type)) {
    return err(`File type ${file.type || 'unknown'} not allowed. Allowed: ${allowed.join(', ')}`, 400);
  }
  if (file.size > maxBytes) {
    return err(`File too large (max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffMime(bytes, file.type)) {
    return err('File contents do not match the declared file type', 400);
  }

  try {
    if (kind === 'asset') {
      const key = safeKey('asset', slideId);
      await store(STORE_SLIDE_ASSETS).set(key, new Blob([bytes], { type: file.type }), {
        metadata: { mime: file.type },
      });
      await d.from('slides').update({ asset_key: key, asset_mime: file.type, updated_at: isoNow() }).eq('id', slideId);
      await audit(admin.sub, 'slide.asset_upload', { slide_id: slideId, mime: file.type, bytes: file.size });
      return json({ ok: true, asset_key: key });
    }

    // ---- knowledge document ------------------------------------------------
    const docKey = safeKey('doc', slideId);
    await store(STORE_KNOWLEDGE_DOCS).set(docKey, new Blob([bytes], { type: file.type }), {
      metadata: { mime: file.type, filename: file.name.slice(0, 200) },
    });
    await d.from('slides').update({
      knowledge_key: docKey,
      knowledge_mime: file.type,
      knowledge_filename: file.name.slice(0, 200),
      knowledge_status: 'processing',
      knowledge_error: null,
      updated_at: isoNow(),
    }).eq('id', slideId);

    // Process inline: extract → clean → sectionize → package.
    try {
      const raw = await extractText(bytes, file.type);
      const cleaned = cleanText(raw);
      if (cleaned.length < 40) throw new Error('Document contains too little readable text');
      const sections = sectionize(cleaned);
      const pkg = buildPackage(slideId, file.name, cleaned, sections);
      await store(STORE_KNOWLEDGE_PROCESSED).setJSON(safeKey('slide', slideId), pkg);
      const status = sections.length <= 1 ? 'needs_review' : 'ready';
      await d.from('slides').update({ knowledge_status: status, updated_at: isoNow() }).eq('id', slideId);
      await audit(admin.sub, 'knowledge.processed', { slide_id: slideId, sections: sections.length, chars: cleaned.length });
      return json({ ok: true, status, sections: sections.length });
    } catch (pe) {
      const msg = pe instanceof Error ? pe.message : 'Processing failed';
      await d.from('slides').update({ knowledge_status: 'failed', knowledge_error: msg, updated_at: isoNow() }).eq('id', slideId);
      await audit(admin.sub, 'knowledge.failed', { slide_id: slideId, error: msg });
      return json({ ok: false, status: 'failed', error: msg });
    }
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Upload failed', 500);
  }
}
