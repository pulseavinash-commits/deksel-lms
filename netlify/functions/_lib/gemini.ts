import { GoogleGenAI } from '@google/genai';
import type {
  AnswerScore,
  KnowledgePackage,
  PublishedSlide,
  SlideQuestion,
} from '../../../shared/types';

export function geminiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY not configured');
  return k;
}

export function serverAI(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: geminiKey() });
}

const STRICT_KNOWLEDGE_RULE = `You are teaching only the current slide. Use only the approved slide visual, extracted slide text, knowledge document, learning objective, mandatory teaching points and assessment information supplied in this session. Do not use unrestricted model knowledge to add unsupported product, medical, scientific, clinical or regulatory claims. If the answer is not contained in the current slide knowledge, clearly state that it is outside the approved information for this slide. When metadata identifies a later slide that contains the topic, tell the learner that it will be covered on that slide.`;

export interface SlideTopicMeta {
  slide_number: number;
  title: string;
}

/**
 * Build the full system instruction for one slide-level Live teaching session.
 * This is locked server-side into the ephemeral token constraints, so the
 * browser cannot alter it.
 */
export function buildTeachingInstruction(
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
  totalSlides: number,
  laterTopics: SlideTopicMeta[],
): string {
  const sections = knowledge?.sections
    ?.map((s, i) => `--- SECTION ${i + 1}: ${s.heading} ---\n${s.content}`)
    .join('\n\n') ?? '(No knowledge document was provided for this slide. Teach only from the slide fields below.)';

  const questions = slide.questions
    .map((q) => `Q${q.position} (${q.question_type}): ${q.question || '(to be generated from approved knowledge)'}`)
    .join('\n');

  const later = laterTopics.length
    ? laterTopics.map((t) => `Slide ${t.slide_number}: ${t.title}`).join('\n')
    : '(none listed)';

  return [
    `You are an expert, warm, interactive medical-education voice trainer delivering corporate training. You are currently teaching Slide ${slide.slide_number} of ${totalSlides}: "${slide.title}".`,
    ``,
    `STRICT KNOWLEDGE RULE:`,
    STRICT_KNOWLEDGE_RULE,
    ``,
    `LEARNING OBJECTIVE: ${slide.learning_objective || '(not specified)'}`,
    `KEY MESSAGE: ${slide.key_message || '(not specified)'}`,
    ``,
    `MANDATORY TEACHING POINTS (you must cover every one):`,
    slide.teaching_points || '(none specified)',
    ``,
    `RESTRICTED / PROHIBITED STATEMENTS (you must NEVER say, imply or agree with any of these):`,
    slide.restricted_statements || '(none specified)',
    ``,
    `APPROVED SLIDE KNOWLEDGE (your ONLY source of factual content):`,
    sections,
    ``,
    `ASSESSMENT QUESTIONS FOR THIS SLIDE (for your awareness while teaching; do not reveal answers):`,
    questions,
    ``,
    `TOPICS COVERED ON LATER SLIDES (if asked about these, say they will be covered on that slide):`,
    later,
    ``,
    `TEACHING STYLE — follow all of these rules:`,
    `1. Behave as an interactive trainer, not a text reader. Never simply read the slide aloud.`,
    `2. Explain basic concepts before advanced concepts.`,
    `3. Teach in small understandable bites of one to three short sentences, then pause naturally before the next bite.`,
    `4. Describe and explain the important visual elements of the slide.`,
    `5. Define every technical term at the point of use, in plain language.`,
    `6. Explain why each piece of information matters to the learner's daily work.`,
    `7. Do not browse the internet. Do not invent statistics, studies, claims or comparisons.`,
    `8. Do not mix in knowledge from other slides.`,
    `9. When the learner interrupts with a question, answer briefly using only the approved knowledge, then ask whether they would like you to continue the explanation. Resume from the nearest complete teaching point — do not restart from the beginning unless asked.`,
    `10. Speak in clear simple English. When you have covered all mandatory teaching points, say exactly: "That completes this slide. Let's check your understanding." and stop teaching.`,
  ].join('\n');
}

/** Create a short-lived ephemeral token locked to a specific Live config. */
export async function createEphemeralToken(
  model: string,
  systemInstruction: string,
  voice: string,
): Promise<{ token: string; expiresAt: string }> {
  const ai = new GoogleGenAI({ apiKey: geminiKey(), httpOptions: { apiVersion: 'v1alpha' } });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();       // 30 min session window
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // must connect within 2 min

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model,
        config: {
          // Locking the system instruction server-side means the browser
          // cannot widen the knowledge scope even if tampered with.
          systemInstruction,
          responseModalities: ['AUDIO' as never],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: {},
          realtimeInputConfig: {
            // Automatic VAD stays enabled (default); interruptions allowed.
          },
        },
      },
      httpOptions: { apiVersion: 'v1alpha' },
    },
  });
  return { token: token.name ?? '', expiresAt: expireTime };
}

// ---------------------------------------------------------------------------
// Pre-generated narration (deterministic, stored) — the reliable alternative
// to live streaming. A text model writes the spoken script from the SAME
// approved knowledge + strict rule, then a TTS model renders it to audio.
// ---------------------------------------------------------------------------

/** Bump this when the narration prompt/voice pipeline changes, to bust caches. */
export const NARRATION_PIPELINE_VERSION = 'v1';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * Write a finished, spoken narration script for one slide, obeying the same
 * strict-knowledge rule and teaching style as the live trainer. The output is
 * plain spoken prose (no headings/markup) and MUST end with the completion
 * phrase the learner UI listens for.
 */
export async function generateNarrationScript(
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
  totalSlides: number,
  laterTopics: SlideTopicMeta[],
): Promise<string> {
  const ai = serverAI();
  const sections = knowledge?.sections
    ?.map((s, i) => `--- SECTION ${i + 1}: ${s.heading} ---\n${s.content}`)
    .join('\n\n') ?? '(No knowledge document — teach only from the slide fields below.)';
  const later = laterTopics.length
    ? laterTopics.map((t) => `Slide ${t.slide_number}: ${t.title}`).join('\n')
    : '(none)';

  const prompt = [
    `You are an expert, warm, interactive medical-education trainer. Write the COMPLETE spoken narration for ONE training slide, to be read aloud by a text-to-speech voice. This is Slide ${slide.slide_number} of ${totalSlides}: "${slide.title}".`,
    ``,
    `STRICT KNOWLEDGE RULE:`,
    STRICT_KNOWLEDGE_RULE,
    ``,
    `LEARNING OBJECTIVE: ${slide.learning_objective || '(not specified)'}`,
    `KEY MESSAGE: ${slide.key_message || '(not specified)'}`,
    ``,
    `MANDATORY TEACHING POINTS (cover every one, in a sensible teaching order):`,
    slide.teaching_points || '(none specified)',
    ``,
    `RESTRICTED / PROHIBITED STATEMENTS (never say, imply or agree with any of these):`,
    slide.restricted_statements || '(none specified)',
    ``,
    `APPROVED SLIDE KNOWLEDGE (your ONLY source of factual content):`,
    sections,
    ``,
    `TOPICS COVERED ON LATER SLIDES (if naturally relevant, say they will be covered on that later slide; otherwise ignore):`,
    later,
    ``,
    `WRITING RULES:`,
    `1. Write ONLY the words to be spoken — natural, flowing spoken English. No headings, no bullet points, no markdown, no stage directions, no emojis.`,
    `2. Open by orienting the learner to the slide and its important visual elements, then teach the concepts from basic to advanced in small bites of one to three short sentences.`,
    `3. Define every technical term in plain language at the point of use, and explain why each point matters to the learner's daily work.`,
    `4. Do NOT invent statistics, studies, claims or comparisons. Do NOT use knowledge from other slides. Never read the raw slide text verbatim — teach it.`,
    `5. Keep it concise and focused: roughly 200 to 380 words.`,
    `6. End with EXACTLY this sentence as the final line, and nothing after it: "That completes this slide. Let's check your understanding."`,
  ].join('\n');

  const res = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { temperature: 0.5 },
  });
  let script = (res.text ?? '').trim();
  if (!script) {
    script = `Let's look at ${slide.title}. ${slide.key_message || ''} That completes this slide. Let's check your understanding.`;
  }
  // Guarantee the completion phrase the learner UI depends on.
  if (!/that completes this slide/i.test(script)) {
    script += `\n\nThat completes this slide. Let's check your understanding.`;
  }
  return script;
}

/** Wrap raw signed 16-bit little-endian mono PCM in a minimal WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);            // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Render text to speech with Gemini TTS and return a ready-to-play WAV.
 * The prebuilt voice is delivered with a warm Indian-English teaching style.
 */
export async function synthesizeSpeech(text: string, voice: string): Promise<Buffer> {
  const ai = serverAI();
  const styled =
    `Read the following training narration aloud in a warm, clear, natural Indian English accent, ` +
    `at an unhurried teaching pace. Speak only these words, exactly, adding nothing:\n\n${text}`;

  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text: styled }] }],
    config: {
      responseModalities: ['AUDIO' as never],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const chunks: Buffer[] = [];
  let sampleRate = 24000;
  for (const p of parts) {
    const data = p.inlineData?.data;
    if (!data) continue;
    const m = /rate=(\d+)/.exec(p.inlineData?.mimeType ?? '');
    if (m) sampleRate = Number(m[1]);
    chunks.push(Buffer.from(data, 'base64'));
  }
  if (!chunks.length) throw new Error('TTS returned no audio');
  return pcmToWav(Buffer.concat(chunks), sampleRate);
}

// ---------------------------------------------------------------------------
// Assessment: question generation + answer scoring (server-side, text model)
// ---------------------------------------------------------------------------

const TEXT_MODEL = 'gemini-2.5-flash';

export async function generateQuestions(
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
): Promise<SlideQuestion[]> {
  const ai = serverAI();
  const prompt = [
    `You are creating a compulsory 3-question spoken assessment for a training slide.`,
    `Use ONLY this approved knowledge. Do not use outside knowledge.`,
    ``,
    `SLIDE TITLE: ${slide.title}`,
    `LEARNING OBJECTIVE: ${slide.learning_objective}`,
    `KEY MESSAGE: ${slide.key_message}`,
    `MANDATORY TEACHING POINTS:\n${slide.teaching_points}`,
    `APPROVED KNOWLEDGE:\n${knowledge?.full_text?.slice(0, 12000) ?? '(slide fields only)'}`,
    ``,
    `Create exactly 3 questions:`,
    `1. recall — tests remembering a specific fact`,
    `2. understanding — tests explaining a concept in own words`,
    `3. application — tests applying the knowledge to a realistic work situation`,
    ``,
    `Return STRICT JSON array of 3 objects: {"question_type":"recall|understanding|application","question":"...","expected_answer":"...","keywords":["...","..."]} — keywords are 2-5 mandatory answer keywords.`,
  ].join('\n');

  const res = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.4 },
  });
  const parsed = JSON.parse(res.text ?? '[]') as Array<{
    question_type: string; question: string; expected_answer: string; keywords: string[];
  }>;
  const defaults: SlideQuestion['question_type'][] = ['recall', 'understanding', 'application'];
  // Positions are assigned deterministically by index (1,2,3), NOT from the
  // model's returned type string — this guarantees exactly one question per
  // position so the slide can always reach completion. We always return
  // three well-formed questions even if the model under-fills the array.
  return [0, 1, 2].map((i) => {
    const q = parsed[i] ?? {} as (typeof parsed)[number];
    const type = (['recall', 'understanding', 'application'].includes(q.question_type)
      ? q.question_type : defaults[i]) as SlideQuestion['question_type'];
    return {
      position: (i + 1) as 1 | 2 | 3,
      question_type: type,
      question: q.question?.trim() || `Explain a key point from the slide "${slide.title}".`,
      expected_answer: q.expected_answer ?? '',
      keywords: Array.isArray(q.keywords) ? q.keywords.slice(0, 8) : [],
    };
  });
}

export async function scoreAnswer(
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
  question: SlideQuestion,
  answerTranscript: string,
  passingScore: number,
  attemptsRemaining: boolean,
): Promise<AnswerScore> {
  const ai = serverAI();
  const prompt = [
    `You are grading a spoken training-assessment answer. Grade ONLY against the approved knowledge below. Be fair to spoken-language transcripts (ignore filler words, grammar, transcription noise).`,
    ``,
    `SLIDE: ${slide.title}`,
    `MANDATORY TEACHING POINTS:\n${slide.teaching_points}`,
    `APPROVED KNOWLEDGE (excerpt):\n${knowledge?.full_text?.slice(0, 10000) ?? '(slide fields only)'}`,
    ``,
    `QUESTION (${question.question_type}): ${question.question}`,
    `EXPECTED ANSWER: ${question.expected_answer}`,
    `MANDATORY ANSWER KEYWORDS: ${question.keywords.join(', ') || '(none)'}`,
    ``,
    `LEARNER'S TRANSCRIBED ANSWER: """${answerTranscript.slice(0, 4000)}"""`,
    ``,
    `Analyze and return STRICT JSON:`,
    `{`,
    ` "accuracy": 0-100,`,
    ` "core_understanding": 0-100,`,
    ` "key_points_inclusion": 0-100,`,
    ` "application": 0-100,`,
    ` "mandatory_points_included": ["..."],`,
    ` "important_points_missed": ["..."],`,
    ` "incorrect_statements": ["..."],`,
    ` "keyword_hits": ["..."],`,
    ` "keyword_misses": ["..."],`,
    ` "feedback": "2-3 sentence concise corrective feedback spoken directly to the learner",`,
    ` "corrective_question": "one focused question re-testing the weakest missed concept"`,
    `}`,
  ].join('\n');

  const res = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const g = JSON.parse(res.text ?? '{}') as Record<string, unknown>;
  const num = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]).slice(0, 10) : []);

  const core = num(g.core_understanding);
  const keyPoints = num(g.key_points_inclusion);
  const application = num(g.application);
  // Weighted slide score: core 50% + key points 30% + application 20%.
  const score = Math.round(core * 0.5 + keyPoints * 0.3 + application * 0.2);
  const passed = score >= passingScore;

  return {
    score,
    passed,
    analysis: {
      accuracy: num(g.accuracy),
      core_understanding: core,
      mandatory_points_included: arr(g.mandatory_points_included),
      important_points_missed: arr(g.important_points_missed),
      incorrect_statements: arr(g.incorrect_statements),
      application,
      keyword_hits: arr(g.keyword_hits),
      keyword_misses: arr(g.keyword_misses),
    },
    feedback: String(g.feedback ?? 'Thank you. Please review the slide points once more.'),
    corrective_question: !passed && attemptsRemaining ? String(g.corrective_question ?? question.question) : null,
  };
}
