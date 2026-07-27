import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import { audit } from './_lib/audit';
import { store, STORE_KNOWLEDGE_PROCESSED, safeKey } from './_lib/blobs';
import type {
  PublishedCourseSnapshot,
  PublishedSlide,
  SlideQuestion,
  KnowledgePackage,
} from '../../shared/types';
import { MAX_SLIDES } from '../../shared/types';

export const config: Config = {
  path: [
    '/api/admin/course',
    '/api/admin/course/slides',
    '/api/admin/course/slide/:slideId',
    '/api/admin/course/publish',
    '/api/admin/course/settings',
  ],
};

async function getOrCreateCourse() {
  const d = db();
  const { data: existing } = await d.from('courses').select('*').order('created_at').limit(1).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await d
    .from('courses')
    .insert({ title: 'New training module' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return created;
}

export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);

  const url = new URL(req.url);
  const path = url.pathname;
  const d = db();

  try {
    // ---- GET /api/admin/course — course + all slides + questions ----------
    if (path === '/api/admin/course' && req.method === 'GET') {
      const course = await getOrCreateCourse();
      const { data: slides } = await d
        .from('slides').select('*').eq('course_id', course.id).order('display_order');
      const { data: questions } = await d
        .from('slide_questions').select('*').in('slide_id', (slides ?? []).map((s) => s.id));
      return json({
        course,
        slides: (slides ?? []).map((s) => ({
          ...s,
          questions: (questions ?? [])
            .filter((q) => q.slide_id === s.id)
            .sort((a, b) => a.position - b.position),
        })),
      });
    }

    // ---- PUT /api/admin/course/settings — title/duration/inactivity -------
    if (path === '/api/admin/course/settings' && req.method === 'PUT') {
      const course = await getOrCreateCourse();
      const body = await readJson<Record<string, unknown>>(req);
      if (!body) return err('Invalid body');
      const patch: Record<string, unknown> = { updated_at: isoNow() };
      if (typeof body.title === 'string') patch.title = body.title.slice(0, 300);
      if (typeof body.description === 'string') patch.description = body.description.slice(0, 2000);
      const dur = Number(body.expected_duration_minutes);
      if (Number.isFinite(dur) && dur >= 5 && dur <= 600) patch.expected_duration_minutes = Math.round(dur);
      const warn = Number(body.inactivity_warning_seconds);
      if (Number.isFinite(warn) && warn >= 30 && warn <= 3600) patch.inactivity_warning_seconds = Math.round(warn);
      const stop = Number(body.inactivity_stop_seconds);
      if (Number.isFinite(stop) && stop >= 60 && stop <= 7200) patch.inactivity_stop_seconds = Math.round(stop);
      const { error } = await d.from('courses').update(patch).eq('id', course.id);
      if (error) return err(error.message, 500);
      await audit(admin.sub, 'course.settings', patch);
      return json({ ok: true });
    }

    // ---- POST /api/admin/course/slides — add a slide row -------------------
    if (path === '/api/admin/course/slides' && req.method === 'POST') {
      const course = await getOrCreateCourse();
      const { count } = await d.from('slides').select('id', { count: 'exact', head: true }).eq('course_id', course.id);
      if ((count ?? 0) >= MAX_SLIDES) return err(`Maximum of ${MAX_SLIDES} slides reached`, 400);
      const next = (count ?? 0) + 1;
      const { data: slide, error } = await d
        .from('slides')
        .insert({ course_id: course.id, slide_number: next, display_order: next, title: `Slide ${next}` })
        .select('*')
        .single();
      if (error) return err(error.message, 500);
      // Create the three empty question rows.
      const types: SlideQuestion['question_type'][] = ['recall', 'understanding', 'application'];
      await d.from('slide_questions').insert(
        types.map((t, i) => ({ slide_id: slide.id, position: i + 1, question_type: t })),
      );
      await audit(admin.sub, 'slide.create', { slide_id: slide.id, slide_number: next });
      return json({ slide: { ...slide, questions: [] } });
    }

    // ---- PUT/DELETE /api/admin/course/slide/:slideId ------------------------
    const slideMatch = path.match(/^\/api\/admin\/course\/slide\/([0-9a-f-]{36})$/);
    if (slideMatch) {
      const slideId = slideMatch[1];
      if (req.method === 'PUT') {
        const body = await readJson<Record<string, unknown>>(req);
        if (!body) return err('Invalid body');
        const patch: Record<string, unknown> = { updated_at: isoNow() };
        const strFields = ['title', 'learning_objective', 'key_message', 'teaching_points', 'restricted_statements'] as const;
        for (const f of strFields) if (typeof body[f] === 'string') patch[f] = (body[f] as string).slice(0, 8000);
        if (['ai', 'admin', 'mixed'].includes(body.assessment_mode as string)) patch.assessment_mode = body.assessment_mode;
        const ps = Number(body.passing_score);
        if (Number.isFinite(ps) && ps >= 0 && ps <= 100) patch.passing_score = Math.round(ps);
        const ma = Number(body.max_attempts);
        if (Number.isFinite(ma) && ma >= 1 && ma <= 5) patch.max_attempts = Math.round(ma);
        if (typeof body.active === 'boolean') patch.active = body.active;
        const ord = Number(body.display_order);
        if (Number.isFinite(ord) && ord >= 1 && ord <= MAX_SLIDES) patch.display_order = Math.round(ord);
        const sn = Number(body.slide_number);
        if (Number.isFinite(sn) && sn >= 1 && sn <= MAX_SLIDES) patch.slide_number = Math.round(sn);

        const { error } = await d.from('slides').update(patch).eq('id', slideId);
        if (error) return err(error.message, 500);

        // Questions (array of up to 3)
        if (Array.isArray(body.questions)) {
          for (const q of body.questions as Array<Record<string, unknown>>) {
            const pos = Number(q.position);
            if (![1, 2, 3].includes(pos)) continue;
            await d.from('slide_questions').upsert(
              {
                slide_id: slideId,
                position: pos,
                question_type: ['recall', 'understanding', 'application'].includes(q.question_type as string)
                  ? q.question_type : (['recall', 'understanding', 'application'][pos - 1]),
                question: String(q.question ?? '').slice(0, 2000),
                expected_answer: String(q.expected_answer ?? '').slice(0, 4000),
                keywords: Array.isArray(q.keywords)
                  ? (q.keywords as string[]).map((k) => String(k).slice(0, 80)).slice(0, 10)
                  : [],
              },
              { onConflict: 'slide_id,position' },
            );
          }
        }
        await audit(admin.sub, 'slide.update', { slide_id: slideId });
        return json({ ok: true });
      }
      if (req.method === 'DELETE') {
        const { error } = await d.from('slides').delete().eq('id', slideId);
        if (error) return err(error.message, 500);
        await audit(admin.sub, 'slide.delete', { slide_id: slideId });
        return json({ ok: true });
      }
    }

    // ---- POST /api/admin/course/publish -------------------------------------
    if (path === '/api/admin/course/publish' && req.method === 'POST') {
      const course = await getOrCreateCourse();
      const { data: slides } = await d
        .from('slides').select('*').eq('course_id', course.id).eq('active', true).order('display_order');
      if (!slides || slides.length === 0) return err('Cannot publish: no active slides', 400);

      const notReady = slides.filter(
        (s) => s.knowledge_key && !['ready', 'published', 'needs_review'].includes(s.knowledge_status),
      );
      if (notReady.length > 0) {
        return err(`Cannot publish: knowledge still processing or failed on slide(s) ${notReady.map((s) => s.slide_number).join(', ')}`, 400);
      }

      const { data: questions } = await d
        .from('slide_questions').select('*').in('slide_id', slides.map((s) => s.id));

      const version = (course.current_version ?? 0) + 1;
      const processedStore = store(STORE_KNOWLEDGE_PROCESSED);

      const publishedSlides: PublishedSlide[] = [];
      for (const s of slides) {
        // Freeze the knowledge package for this version so later edits never
        // affect learners already on this version.
        let frozenKey: string | null = null;
        if (s.knowledge_status !== 'not_uploaded' && s.knowledge_key) {
          const livePkg = (await processedStore.get(safeKey('slide', s.id), { type: 'json' })) as KnowledgePackage | null;
          if (livePkg) {
            frozenKey = safeKey('version', course.id, String(version), s.id);
            await processedStore.setJSON(frozenKey, livePkg);
          }
        }
        publishedSlides.push({
          slide_id: s.id,
          slide_number: s.slide_number,
          title: s.title,
          learning_objective: s.learning_objective,
          key_message: s.key_message,
          teaching_points: s.teaching_points,
          restricted_statements: s.restricted_statements,
          assessment_mode: s.assessment_mode,
          passing_score: s.passing_score,
          max_attempts: s.max_attempts,
          display_order: s.display_order,
          asset_key: s.asset_key,
          asset_mime: s.asset_mime,
          knowledge_processed_key: frozenKey,
          questions: (questions ?? [])
            .filter((q) => q.slide_id === s.id)
            .sort((a, b) => a.position - b.position)
            .map((q) => ({
              position: q.position,
              question_type: q.question_type,
              question: q.question,
              expected_answer: q.expected_answer,
              keywords: q.keywords ?? [],
            })),
        });
      }

      const snapshot: PublishedCourseSnapshot = {
        course_id: course.id,
        version,
        title: course.title,
        description: course.description,
        expected_duration_minutes: course.expected_duration_minutes,
        inactivity_warning_seconds: course.inactivity_warning_seconds,
        inactivity_stop_seconds: course.inactivity_stop_seconds,
        slides: publishedSlides,
        published_at: isoNow(),
      };

      const { error: verr } = await d.from('course_versions').insert({
        course_id: course.id, version, snapshot,
      });
      if (verr) return err(verr.message, 500);

      const { error: cerr } = await d.from('courses')
        .update({ status: 'published', current_version: version, updated_at: isoNow() })
        .eq('id', course.id);
      if (cerr) return err(cerr.message, 500);

      // Mark ready knowledge as published.
      await d.from('slides')
        .update({ knowledge_status: 'published' })
        .eq('course_id', course.id)
        .in('knowledge_status', ['ready', 'needs_review']);

      await audit(admin.sub, 'course.publish', { course_id: course.id, version, slides: publishedSlides.length });
      return json({ ok: true, version });
    }

    return err('Not found', 404);
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Server error', 500);
  }
}
