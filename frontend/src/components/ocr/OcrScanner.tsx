import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Download, FileText, ImageUp, RotateCcw, ScanText, Upload, X } from 'lucide-react';
import { OCR_ACCEPT, OCR_LANGS, OCR_MAX_MB, OCR_MAX_PAGES, isImage, ocrFile, textFileFor, type OcrLang, type OcrResult } from '../../lib/ocr';
import { errorMessage } from '../../lib/http';
import { usePreference } from '../../lib/hooks';
import { Button } from '../ui/Button';
import { Select } from '../ui/Form';
import { Notice } from '../ui/Feedback';

interface Props {
  /** adds the extracted text as a .txt document; omitted when the caller only wants the text */
  onAdd?: (file: File) => Promise<void> | void;
  addLabel?: string;
  /** extra controls shown next to the language picker (e.g. which workspace to add to) */
  targetPicker?: React.ReactNode;
  compact?: boolean;
}

type Phase = { kind: 'idle' } | { kind: 'reading'; label: string; value: number } | { kind: 'done'; result: OcrResult } | { kind: 'error'; message: string };

/** Pick or photograph a page, read it in the browser, check and edit the text, then copy, download or add it. */
export default function OcrScanner({ onAdd, addLabel = 'Add to knowledge base', targetPicker, compact }: Props) {
  const [lang, setLang] = usePreference<OcrLang>('ocr-lang', 'eng');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => { abort.current?.abort(); }, []);
  useEffect(() => {
    if (!file || !isImage(file)) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const run = async (f: File, l: OcrLang = lang) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFile(f);
    setAdded(false);
    setText('');
    setPhase({ kind: 'reading', label: 'Starting', value: 0 });
    try {
      const result = await ocrFile(f, l, (p) => setPhase({ kind: 'reading', label: p.label, value: p.value }), ctrl.signal);
      if (ctrl.signal.aborted) return;
      setText(result.text);
      setPhase({ kind: 'done', result });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setPhase({ kind: 'error', message: errorMessage(e) });
    }
  };

  const pick = (list: FileList | null) => {
    const f = list?.[0];
    if (f) run(f);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
  };

  const reset = () => { abort.current?.abort(); setFile(null); setPhase({ kind: 'idle' }); setText(''); setAdded(false); };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const f = textFileFor(file?.name ?? 'scan', text);
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const add = async () => {
    if (!onAdd || !text.trim()) return;
    setAdding(true);
    try {
      await onAdd(textFileFor(file?.name ?? 'scan', text));
      setAdded(true);
    } catch {
      /* the caller has already told the user what went wrong */
    } finally {
      setAdding(false);
    }
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">Language in the document</span>
          <Select compact value={lang} className="w-48" onChange={(e) => { const l = e.target.value as OcrLang; setLang(l); if (file && phase.kind !== 'reading') run(file, l); }}>
            {OCR_LANGS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
        {targetPicker}
      </div>

      {phase.kind === 'idle' || phase.kind === 'error' ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            role="button" tabIndex={0}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors ${compact ? 'px-5 py-8' : 'px-6 py-14'} ${
              drag ? 'border-brand-600 bg-brand-50' : 'border-line-strong hover:border-brand-400 hover:bg-canvas/60'}`}>
            <ImageUp className="h-8 w-8 text-ink-faint transition-transform duration-300 group-hover:-translate-y-1 group-hover:text-brand-700" strokeWidth={1.5} />
            <p className="mt-3 text-[15px] font-medium text-ink">Drop a photo or a scanned PDF here, or click to choose</p>
            <p className="mt-1 text-[12.5px] text-ink-muted">PNG, JPG, WEBP or PDF · up to {OCR_MAX_MB} MB · first {OCR_MAX_PAGES} pages of a PDF</p>
            <input ref={input} type="file" accept={OCR_ACCEPT} className="hidden" onChange={(e) => pick(e.target.files)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => camera.current?.click()} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline sm:hidden">
              <Camera className="h-4 w-4" /> Take a photo
            </button>
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files)} />
            <p className="text-[12.5px] text-ink-muted">Runs in your browser. The file never leaves your device; only text you choose to add is uploaded.</p>
          </div>
          {phase.kind === 'error' && <Notice tone="danger" title="Couldn’t read that file">{phase.message}</Notice>}
        </>
      ) : (
        <div className={`grid gap-6 ${preview && !compact ? 'lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]' : ''}`}>
          {preview && !compact && (
            <figure className="relative self-start overflow-hidden rounded-xl bg-canvas">
              <img src={preview} alt={`Preview of ${file?.name ?? 'the image'}`} className="max-h-[520px] w-full object-contain" />
              {phase.kind === 'reading' && <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 animate-[scanline_2.2s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-brand-500/20 to-transparent" aria-hidden />}
            </figure>
          )}
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-ink">
                <FileText className="h-4 w-4 shrink-0 text-ink-faint" /><span className="truncate">{file?.name}</span>
              </p>
              <button onClick={reset} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
                {phase.kind === 'reading' ? <><X className="h-3.5 w-3.5" /> Cancel</> : <><RotateCcw className="h-3.5 w-3.5" /> Scan another</>}
              </button>
            </div>

            {phase.kind === 'reading' && (
              <div className="mt-6" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 text-ink"><ScanText className="h-4 w-4 animate-pulse text-brand-700" /> {phase.label}…</span>
                  <span className="num text-ink-muted">{Math.round(phase.value * 100)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-50">
                  <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.max(3, phase.value * 100)}%` }} />
                </div>
                <p className="mt-3 text-[12.5px] text-ink-muted">The first scan downloads the OCR engine and language data, so it takes a little longer.</p>
              </div>
            )}

            {phase.kind === 'done' && (
              <div className="mt-4 animate-slide-up">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
                  <span className="num">{words.toLocaleString()} words</span>
                  {phase.result.pages > 1 && <span className="num">{phase.result.pages} pages{phase.result.truncated ? ` (first ${OCR_MAX_PAGES} read)` : ''}</span>}
                  {phase.result.confidence !== null && (
                    <span className={phase.result.confidence < 70 ? 'text-warn-ink' : ''}>OCR confidence {phase.result.confidence}%</span>
                  )}
                  {phase.result.ocrPages === 0 && <span>Text layer used, no OCR needed</span>}
                </div>
                {!text.trim() ? (
                  <Notice tone="warn" className="mt-3" title="No text found">Try a sharper, well-lit photo, or pick the right language.</Notice>
                ) : (
                  <>
                    {phase.result.confidence !== null && phase.result.confidence < 70 && (
                      <Notice tone="warn" className="mt-3">Some words may be misread. Check the text and fix anything that looks wrong before adding it.</Notice>
                    )}
                    <label className="mt-3 block">
                      <span className="sr-only">Extracted text (editable)</span>
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 9 : 16} spellCheck
                        className="block w-full resize-y rounded-xl border border-line-strong bg-white px-4 py-3 text-[14px] leading-relaxed text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
                    </label>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {onAdd && (
                        <Button icon={added ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />} loading={adding} disabled={added || !text.trim()} onClick={add}>
                          {added ? 'Added' : addLabel}
                        </Button>
                      )}
                      <Button variant="secondary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={copy}>{copied ? 'Copied' : 'Copy text'}</Button>
                      <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={download}>Download .txt</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
