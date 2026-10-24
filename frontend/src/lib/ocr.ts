/**
 * In-browser OCR. Images go straight to Tesseract; PDFs are rendered page by page with pdf.js, and a page that
 * already has a text layer is read directly instead of being OCR'd. Both libraries load on first use only, and
 * the file never leaves the device (Tesseract downloads its engine and language data once, then caches them).
 */

export type OcrLang = 'eng' | 'hin' | 'eng+hin';

export const OCR_LANGS: { value: OcrLang; label: string }[] = [
  { value: 'eng', label: 'English' },
  { value: 'hin', label: 'Hindi' },
  { value: 'eng+hin', label: 'English + Hindi' },
];

export const OCR_ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,application/pdf,.pdf';
export const OCR_MAX_PAGES = 20;
export const OCR_MAX_MB = 25;

export interface OcrProgress {
  label: string;
  /** 0–1 across the whole file */
  value: number;
}

export interface OcrResult {
  text: string;
  /** mean Tesseract confidence (0–100) over OCR'd pages; null when every page had a text layer */
  confidence: number | null;
  pages: number;
  ocrPages: number;
  truncated: boolean;
}

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Loading the OCR engine',
  'initializing tesseract': 'Starting the OCR engine',
  'loading language traineddata': 'Loading language data',
  'initializing api': 'Preparing',
  'recognizing text': 'Reading text',
};

export const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
export const isImage = (f: File) => f.type.startsWith('image/');

export class OcrCancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'AbortError'; }
}

export async function ocrFile(file: File, lang: OcrLang, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<OcrResult> {
  if (!isPdf(file) && !isImage(file)) throw new Error('Choose an image (PNG, JPG, WEBP) or a PDF.');
  if (file.size > OCR_MAX_MB * 1024 * 1024) throw new Error(`That file is larger than ${OCR_MAX_MB} MB.`);
  const check = () => { if (signal?.aborted) throw new OcrCancelled(); };

  // page bookkeeping so Tesseract's per-page progress maps onto the whole file
  let pageIndex = 0;
  let pageCount = 1;
  const report = (label: string, within: number) =>
    onProgress({ label: pageCount > 1 ? `${label} · page ${pageIndex + 1} of ${pageCount}` : label, value: (pageIndex + within) / pageCount });

  onProgress({ label: 'Loading the OCR engine', value: 0 });
  const { createWorker } = await import('tesseract.js');
  check();
  const worker = await createWorker(lang.split('+'), 1, {
    logger: (m: { status: string; progress: number }) => {
      const label = STATUS[m.status] ?? 'Working';
      report(label, m.status === 'recognizing text' ? m.progress : 0);
    },
  });
  const abort = () => { worker.terminate().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    if (isImage(file)) {
      const { data } = await worker.recognize(file);
      check();
      return { text: tidy(data.text), confidence: Math.round(data.confidence), pages: 1, ocrPages: 1, truncated: false };
    }

    const pdfjs = await import('pdfjs-dist');
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    check();
    pageCount = Math.min(pdf.numPages, OCR_MAX_PAGES);
    const texts: string[] = [];
    const confidences: number[] = [];
    for (pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      check();
      const page = await pdf.getPage(pageIndex + 1);
      // A page with real text needs no OCR: keep its text layer as is.
      const content = await page.getTextContent();
      const layer = content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim();
      if (layer.length > 80) {
        texts.push(layer);
        report('Reading the text layer', 1);
        continue;
      }
      report('Rendering the page', 0);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      check();
      const { data } = await worker.recognize(canvas);
      texts.push(tidy(data.text));
      confidences.push(data.confidence);
      canvas.width = 0; // release the bitmap
    }
    const confidence = confidences.length ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length) : null;
    return {
      text: texts.map((t, i) => (pageCount > 1 ? `--- Page ${i + 1} ---\n${t}` : t)).join('\n\n').trim(),
      confidence, pages: pdf.numPages, ocrPages: confidences.length, truncated: pdf.numPages > OCR_MAX_PAGES,
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await worker.terminate().catch(() => {});
  }
}

/** Joins hyphenated line breaks and collapses runs of blank lines; keeps paragraph breaks. */
function tidy(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A plain-text file named after the source, ready for the knowledge-base upload endpoint. */
export function textFileFor(source: string, text: string): File {
  const base = source.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'scan';
  return new File([text], `${base}-ocr.txt`, { type: 'text/plain' });
}
