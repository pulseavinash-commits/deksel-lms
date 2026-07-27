import { createHash } from 'node:crypto';
import { store, STORE_SLIDE_AUDIO } from './blobs';
import { STORE_KNOWLEDGE_PROCESSED } from './blobs';
import {
  NARRATION_PIPELINE_VERSION,
  generateNarrationScript,
  synthesizeSpeech,
} from './gemini';
import type {
  KnowledgePackage,
  PublishedCourseSnapshot,
  PublishedSlide,
} from '../../../shared/types';

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Copy a Node Buffer into a standalone ArrayBuffer (Netlify Blobs input). */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer;
}

/**
 * Deterministic cache key for a slide's narration. Changes only when the
 * teaching content, voice, or pipeline version changes — so identical content
 * is generated once and replayed forever.
 */
export function narrationHash(
  slide: PublishedSlide,
  knowledge: KnowledgePackage | null,
  voice: string,
): string {
  const material = JSON.stringify({
    v: NARRATION_PIPELINE_VERSION,
    voice,
    title: slide.title,
    lo: slide.learning_objective,
    km: slide.key_message,
    tp: slide.teaching_points,
    rs: slide.restricted_statements,
    kn: knowledge?.full_text ?? '',
  });
  return sha(material);
}

const audioKey = (slideId: string, hash: string) => `narration/${slideId}/${hash}`;
const scriptKey = (slideId: string, hash: string) => `narration/${slideId}/${hash}.script`;

/** Load this slide's frozen knowledge package (if any) from blob storage. */
export async function loadKnowledge(
  slide: PublishedSlide,
): Promise<KnowledgePackage | null> {
  if (!slide.knowledge_processed_key) return null;
  return (await store(STORE_KNOWLEDGE_PROCESSED)
    .get(slide.knowledge_processed_key, { type: 'json' })) as KnowledgePackage | null;
}

export interface NarrationResult {
  hash: string;
  script: string;
  generated: boolean;
}

/**
 * Ensure narration audio exists for a slide, generating (script → TTS) and
 * caching on first request. Returns the cache hash and the script text.
 * Script generation is cached independently of audio, so a TTS timeout retry
 * never re-runs the (already-successful) script step.
 */
export async function ensureNarration(
  slide: PublishedSlide,
  snapshot: PublishedCourseSnapshot,
  voice: string,
): Promise<NarrationResult> {
  const knowledge = await loadKnowledge(slide);
  const hash = narrationHash(slide, knowledge, voice);
  const s = store(STORE_SLIDE_AUDIO);

  const existingAudio = await s.getMetadata(audioKey(slide.slide_id, hash)).catch(() => null);
  if (existingAudio) {
    const script = ((await s.get(scriptKey(slide.slide_id, hash), { type: 'text' }).catch(() => null)) as string | null) ?? '';
    return { hash, script, generated: false };
  }

  // Reuse a previously-generated script if the TTS step failed last time.
  let script = (await s.get(scriptKey(slide.slide_id, hash), { type: 'text' }).catch(() => null)) as string | null;
  if (!script) {
    const laterTopics = snapshot.slides
      .filter((x) => x.display_order > slide.display_order)
      .map((x) => ({ slide_number: x.slide_number, title: x.title }));
    script = await generateNarrationScript(slide, knowledge, snapshot.slides.length, laterTopics);
    await s.set(scriptKey(slide.slide_id, hash), script);
  }

  const wav = await synthesizeSpeech(script, voice);
  await s.set(audioKey(slide.slide_id, hash), toArrayBuffer(wav), {
    metadata: { mime: 'audio/wav', kind: 'narration' },
  });
  return { hash, script, generated: true };
}

/** Fetch cached narration audio bytes for a slide (null if not generated). */
export async function getNarrationAudio(
  slideId: string,
  hash: string,
): Promise<ArrayBuffer | null> {
  const blob = await store(STORE_SLIDE_AUDIO)
    .get(audioKey(slideId, hash), { type: 'arrayBuffer' })
    .catch(() => null);
  return (blob as ArrayBuffer | null) ?? null;
}

// ---------------------------------------------------------------------------
// Short read-aloud clips (assessment questions, etc.), keyed by text + voice.
// ---------------------------------------------------------------------------

const ttsKey = (hash: string) => `tts/${hash}`;

export function ttsHash(text: string, voice: string): string {
  return sha(JSON.stringify({ v: NARRATION_PIPELINE_VERSION, voice, text }));
}

export async function ensureTts(text: string, voice: string): Promise<string> {
  const hash = ttsHash(text, voice);
  const s = store(STORE_SLIDE_AUDIO);
  const existing = await s.getMetadata(ttsKey(hash)).catch(() => null);
  if (!existing) {
    const wav = await synthesizeSpeech(text, voice);
    await s.set(ttsKey(hash), toArrayBuffer(wav), { metadata: { mime: 'audio/wav', kind: 'tts' } });
  }
  return hash;
}

export async function getTtsAudio(hash: string): Promise<ArrayBuffer | null> {
  const blob = await store(STORE_SLIDE_AUDIO)
    .get(ttsKey(hash), { type: 'arrayBuffer' })
    .catch(() => null);
  return (blob as ArrayBuffer | null) ?? null;
}
