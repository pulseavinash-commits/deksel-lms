import type { KnowledgePackage, KnowledgeSection } from '../../../shared/types';

/** Extract readable text from PDF / DOCX / TXT bytes. */
export async function extractText(bytes: Uint8Array, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(bytes);
    const { text } = await pdfExtract(doc, { mergePages: true });
    return typeof text === 'string' ? text : (text as string[]).join('\n');
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mod = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }
  if (mime === 'text/plain') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  throw new Error(`Unsupported document type: ${mime}`);
}

/** Clean repeated/irrelevant content: page numbers, repeated headers/footers, noise. */
export function cleanText(raw: string): string {
  let lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());

  // Count line frequency to detect repeated headers/footers.
  const freq = new Map<string, number>();
  for (const l of lines) {
    if (l.length > 0 && l.length < 80) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  const repeated = new Set(
    [...freq.entries()].filter(([l, n]) => n >= 4 && l.length < 60).map(([l]) => l),
  );

  lines = lines.filter((l) => {
    if (!l) return true;                        // keep blank lines for structure
    if (repeated.has(l)) return false;          // repeated header/footer
    if (/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(l)) return false;
    if (/^\d{1,3}$/.test(l)) return false;      // bare page numbers
    if (/^[\s._\-–—=*]{4,}$/.test(l)) return false; // decorative rules
    return true;
  });

  // Collapse 3+ blank lines to one.
  const out: string[] = [];
  let blanks = 0;
  for (const l of lines) {
    if (!l) {
      blanks++;
      if (blanks <= 1) out.push('');
    } else {
      blanks = 0;
      out.push(l);
    }
  }
  return out.join('\n').trim();
}

const HEADING_RE =
  /^(?:\d+(?:\.\d+)*[.)]?\s+\S|[A-Z][A-Z0-9 &/,'()-]{3,70}$|(?:introduction|overview|summary|background|mechanism|dosage|indication|contraindication|safety|efficacy|conclusion|references)\b)/i;

/** Divide cleaned text into logical sections using heading heuristics. */
export function sectionize(text: string): KnowledgeSection[] {
  const lines = text.split('\n');
  const sections: KnowledgeSection[] = [];
  let heading = 'Overview';
  let buf: string[] = [];

  const flush = () => {
    const content = buf.join('\n').trim();
    if (content) sections.push({ heading, content });
    buf = [];
  };

  for (const line of lines) {
    const isHeading =
      line.length > 0 &&
      line.length < 90 &&
      !/[.,;]$/.test(line) &&
      HEADING_RE.test(line) &&
      line.split(' ').length <= 12;
    if (isHeading && buf.join('').trim().length > 0) {
      flush();
      heading = line.replace(/\s+/g, ' ').trim();
    } else if (isHeading && sections.length === 0 && buf.join('').trim().length === 0) {
      heading = line.replace(/\s+/g, ' ').trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  // If heading detection produced nothing useful for a long document,
  // fall back to fixed-size chunks (~1500 chars at paragraph boundaries)
  // so the admin still gets editable, logical sections.
  const needsChunking =
    (sections.length === 0 && text.trim().length > 0) ||
    (sections.length === 1 && sections[0].content.length > 2500);
  if (needsChunking) {
    const source = sections.length === 1 ? sections[0].content : text;
    const chunked: KnowledgeSection[] = [];
    // Paragraph units; any oversized paragraph (e.g. PDFs extracted as one
    // long line) is further split at sentence boundaries.
    const paras = source.split(/\n+/).flatMap((p) =>
      p.length <= 1500 ? [p] : (p.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [p]),
    );
    let chunk = '';
    let i = 1;
    for (const p of paras) {
      if ((chunk + p).length > 1500 && chunk) {
        chunked.push({ heading: `Section ${i++}`, content: chunk.trim() });
        chunk = '';
      }
      chunk += p + '\n';
    }
    if (chunk.trim()) chunked.push({ heading: `Section ${i}`, content: chunk.trim() });
    return chunked.length > 0 ? chunked : sections;
  }
  return sections;
}

export function buildPackage(
  slideId: string,
  filename: string,
  cleaned: string,
  sections: KnowledgeSection[],
): KnowledgePackage {
  return {
    slide_id: slideId,
    source_filename: filename,
    extracted_at: new Date().toISOString(),
    sections,
    full_text: cleaned,
    edited_by_admin: false,
  };
}
