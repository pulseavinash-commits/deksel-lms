import type { Config } from '@netlify/functions';
import { db, isoNow } from './_lib/db';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireLearnerSession } from './_lib/auth';
import { rateLimit } from './_lib/ratelimit';
import { store, STORE_KNOWLEDGE_PROCESSED } from './_lib/blobs';
import { generateQuestions, scoreAnswer } from './_lib/gemini';
import type {
  KnowledgePackage, PublishedCourseSnapshot, PublishedSlide, SlideQuestion,
} from '../../shared/types';

export const config: Config = {
  path: ['/api/learn/assessment/questions', '/api/learn/assessment/answer'],
};

async function loadSlideContext(sessionId: string, slideId: string) {
  const d = db();
  const { data: session } = await d.from('learner_sessions')
    .select('id, course_version_id, resume_state').eq('id', sessionId).single();
  if (!session) throw new Error('Session not found');
  const { data: ver } = await d.from('course_versions')
    .select('snapshot').eq('id', session.course_version_id).single();
  const snapshot = ver?.snapshot as PublishedCourseSnapshot;
  const slide = snapshot?.slides.find((s) => s.slide_id === slideId);
  if (!slide) throw new Error('Slide not in course version');
  let knowledge: KnowledgePackage | null = null;
  if (slide.knowledge_processed_key) {
    knowledge = (await store(STORE_KNOWLEDGE_PROCESSED)
      .get(slide.knowledge_processed_key, { type: 'json' })) as KnowledgePackage | null;
  }
  return { session, snapshot, slide, knowledge };
}

/** Resolve the effective 3 questions for a slide (admin / AI / mixed). */
async function resolveQuestions(
  sessionId: string,
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
  resumeState: Record<string, unknown>,
): Promise<SlideQuestion[]> {
  const d = db();
  const cacheKey = `generated_questions_${slide.slide_id}`;
  const cached = resumeState[cacheKey] as SlideQuestion[] | undefined;
  if (cached && cached.length === 3) return cached;

  const defaults: SlideQuestion['question_type'][] = ['recall', 'understanding', 'application'];
  const adminAt = (pos: number) => slide.questions.find((q) => q.position === pos && q.question.trim());
  const adminQs = slide.questions.filter((q) => q.question.trim());

  const normalize = (list: SlideQuestion[]): SlideQuestion[] =>
    [1, 2, 3].map((pos) => {
      const q = list.find((x) => x.position === pos);
      return {
        position: pos as 1 | 2 | 3,
        question_type: q?.question_type ?? defaults[pos - 1],
        question: q?.question?.trim() || `Explain a key point from the slide "${slide.title}".`,
        expected_answer: q?.expected_answer ?? '',
        keywords: q?.keywords ?? [],
      };
    });

  let final: SlideQuestion[];
  if (slide.assessment_mode === 'admin') {
    final = normalize(slide.questions);
  } else if (slide.assessment_mode === 'ai' || adminQs.length < 3) {
    // AI-generated, or fill gaps for mixed mode. generateQuestions always
    // returns one well-formed question per position (1..3).
    const generated = await generateQuestions(slide, knowledge);
    if (slide.assessment_mode === 'ai') {
      final = normalize(generated);
    } else {
      // Mixed: prefer admin-written per position, fall back to generated.
      final = normalize(
        [1, 2, 3].map((pos) => adminAt(pos) ?? generated.find((g) => g.position === pos)!),
      );
    }
    // Cache in resume_state so refreshes see identical questions.
    await d.from('learner_sessions').update({
      resume_state: { ...resumeState, [cacheKey]: final },
    }).eq('id', sessionId);
  } else {
    final = normalize(slide.questions);
  }
  return final;
}

export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const claims = await requireLearnerSession(req);
  if (!claims) return err('Session expired', 401, 'SESSION_EXPIRED');
  if (req.method !== 'POST') return err('Method not allowed', 405);
  const path = new URL(req.url).pathname;
  const d = db();

  try {
    // ---- POST /api/learn/assessment/questions { slide_id } ------------------
    if (path === '/api/learn/assessment/questions') {
      const body = await readJson<{ slide_id?: string }>(req);
      const slideId = body?.slide_id ?? '';
      if (!/^[0-9a-f-]{36}$/.test(slideId)) return err('Invalid slide id', 400);
      const { session, slide, knowledge } = await loadSlideContext(claims.session_id, slideId);

      // Assessment only after the explanation is completed.
      const { data: prog } = await d.from('slide_progress')
        .select('state').eq('session_id', session.id).eq('slide_id', slideId).maybeSingle();
      if (!prog || ['not_started', 'explanation_in_progress'].includes(prog.state)) {
        return err('Finish the slide explanation before the assessment', 409);
      }

      const questions = await resolveQuestions(
        session.id, slide, knowledge, session.resume_state as Record<string, unknown>,
      );
      // Send question text only — never expected answers or keywords.
      return json({
        questions: questions.map((q) => ({
          position: q.position, question_type: q.question_type, question: q.question,
        })),
        passing_score: slide.passing_score,
        max_attempts: slide.max_attempts,
      });
    }

    // ---- POST /api/learn/assessment/answer ----------------------------------
    if (path === '/api/learn/assessment/answer') {
      if (!(await rateLimit('assessment', claims.session_id, 40, 10 * 60))) {
        return err('Too many submissions. Please slow down.', 429);
      }
      const body = await readJson<{
        slide_id?: string; question_position?: number; answer_transcript?: string; is_corrective?: boolean;
      }>(req);
      const slideId = body?.slide_id ?? '';
      const pos = Number(body?.question_position);
      const answer = (body?.answer_transcript ?? '').trim();
      const isCorrective = !!body?.is_corrective;
      if (!/^[0-9a-f-]{36}$/.test(slideId) || ![1, 2, 3].includes(pos)) return err('Invalid request', 400);
      if (!answer || answer.length > 6000) return err('Answer transcript required', 400);

      const { session, slide, knowledge } = await loadSlideContext(claims.session_id, slideId);
      const questions = await resolveQuestions(
        session.id, slide, knowledge, session.resume_state as Record<string, unknown>,
      );
      const question = questions.find((q) => q.position === pos);
      if (!question) return err('Question not found', 404);

      // Enforce the max-attempt rule server-side.
      const { data: prior } = await d.from('assessment_attempts')
        .select('id, passed').eq('session_id', session.id).eq('slide_id', slideId).eq('question_position', pos);
      const attemptsUsed = prior?.length ?? 0;
      if (attemptsUsed >= slide.max_attempts) return err('Maximum attempts reached for this question', 409, 'MAX_ATTEMPTS');
      if (prior?.some((p) => p.passed)) return err('Question already passed', 409);

      const attemptsRemainAfterThis = attemptsUsed + 1 < slide.max_attempts;
      const result = await scoreAnswer(slide, knowledge, question, answer, slide.passing_score, attemptsRemainAfterThis);

      // Record the attempt (original or corrective).
      await d.from('assessment_attempts').insert({
        session_id: session.id,
        slide_id: slideId,
        question_position: pos,
        attempt_number: attemptsUsed + 1,
        is_corrective: isCorrective,
        question: question.question,
        answer_transcript: answer,
        analysis: result.analysis,
        score: result.score,
        passed: result.passed,
        feedback: result.feedback,
      });
      // Store the learner's answer in the hidden transcript.
      await d.from('transcripts').insert({
        session_id: session.id, slide_id: slideId, role: 'learner', kind: 'answer', text: answer.slice(0, 8000),
      });

      // ---- Determine slide-level resolution --------------------------------
      const { data: all } = await d.from('assessment_attempts')
        .select('question_position, passed, score').eq('session_id', session.id).eq('slide_id', slideId);
      const resolved = (p: number) => {
        const qa = (all ?? []).filter((a) => a.question_position === p);
        return qa.some((a) => a.passed) || qa.length >= slide.max_attempts;
      };
      const allResolved = [1, 2, 3].every(resolved);
      const bestPerQuestion = [1, 2, 3].map((p) => {
        const scores = (all ?? []).filter((a) => a.question_position === p).map((a) => Number(a.score) || 0);
        return scores.length ? Math.max(...scores) : 0;
      });
      const slideScore = Math.round(bestPerQuestion.reduce((a, b) => a + b, 0) / 3);

      let slideState: string;
      if (allResolved) {
        slideState = 'slide_completed';
      } else if (!result.passed && attemptsRemainAfterThis) {
        slideState = 'corrective_required';
      } else {
        slideState = 'assessment_in_progress';
      }

      await d.from('slide_progress').update({
        state: slideState,
        best_score: slideScore,
        completed_at: allResolved ? isoNow() : null,
        updated_at: isoNow(),
      }).eq('session_id', session.id).eq('slide_id', slideId);
      await d.from('learner_sessions').update({ last_activity_at: isoNow(), status: 'in_progress' }).eq('id', session.id);

      return json({
        score: result.score,
        passed: result.passed,
        feedback: result.feedback,
        analysis: {
          important_points_missed: result.analysis.important_points_missed,
          incorrect_statements: result.analysis.incorrect_statements,
        },
        corrective_question: result.corrective_question,
        attempts_used: attemptsUsed + 1,
        max_attempts: slide.max_attempts,
        slide_state: slideState,
        slide_score: slideScore,
      });
    }

    return err('Not found', 404);
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Assessment failed', 500);
  }
}
