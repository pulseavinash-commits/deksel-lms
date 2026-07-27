import { getStore } from '@netlify/blobs';

export const STORE_SLIDE_ASSETS = 'slide-assets';
export const STORE_KNOWLEDGE_DOCS = 'knowledge-docs';
export const STORE_KNOWLEDGE_PROCESSED = 'knowledge-processed';
// Pre-generated narration + read-aloud audio (TTS), served like slide assets.
export const STORE_SLIDE_AUDIO = 'slide-audio';

export function store(name: string) {
  return getStore({ name, consistency: 'strong' });
}

/**
 * Build a safe blob key. Only server-generated UUID segments are used —
 * user-supplied filenames NEVER become part of a storage key, which
 * prevents any path manipulation.
 */
export function safeKey(...segments: string[]): string {
  const cleaned = segments.map((s) => {
    const c = s.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!c) throw new Error('invalid key segment');
    return c;
  });
  return cleaned.join('/');
}

const MAGIC: Array<{ mime: string; check: (b: Uint8Array) => boolean }> = [
  { mime: 'image/png', check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { mime: 'application/pdf', check: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  // DOCX = ZIP container
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: (b) => b[0] === 0x50 && b[1] === 0x4b },
];

/** Server-side content sniffing: verify the bytes match the claimed MIME type. */
export function sniffMime(bytes: Uint8Array, claimed: string): boolean {
  if (claimed === 'text/plain') {
    // Reject NUL bytes in the first 4KB — binary masquerading as text.
    const head = bytes.subarray(0, 4096);
    return !head.includes(0);
  }
  const rule = MAGIC.find((m) => m.mime === claimed);
  return rule ? bytes.length > 12 && rule.check(bytes) : false;
}
