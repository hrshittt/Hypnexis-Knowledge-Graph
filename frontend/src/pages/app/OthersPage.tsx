import { Link } from 'react-router-dom';
import { ArrowRight, AudioLines, PhoneCall, Plus, ScanText, Waypoints } from 'lucide-react';
import { useDocumentTitle } from '../../lib/hooks';
import { useCreateWorkspace } from '../../lib/useCreateWorkspace';
import { OTHER_INDUSTRIES, OTHERS_INFO } from '../../lib/workspaceTypes';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { openCallPaheli } from '../../components/CallPaheli';

/**
 * "Others": interface only. There is no server-side workspace of this type; the page explains what already works
 * for any documents (a general workspace, OCR, voice, phone calls) and which industries are planned.
 */
export default function OthersPage() {
  useDocumentTitle(OTHERS_INFO.label);
  const { create, creating } = useCreateWorkspace();

  const today = [
    { icon: Waypoints, title: 'A general document workspace', body: 'Upload any PDF or text file. Paheli builds the knowledge graph and answers with citations.' },
    { icon: ScanText, title: 'Scan paper documents', body: 'Photograph a circular, notice or form; OCR turns it into text you can add to a workspace.', to: '/app/ocr', cta: 'Open Scan & OCR' },
    { icon: AudioLines, title: 'Ask out loud', body: 'Use the voice button in any assistant to ask a question and hear the answer read back.' },
    { icon: PhoneCall, title: 'Have Paheli call you', body: 'Talk your use case through with Paheli’s voice assistant on the phone.', call: true },
  ];

  return (
    <Page>
      <PageHeader title={OTHERS_INFO.label}
        description="Paheli works with documents from any field. Dedicated workspaces for the industries below are on the way; this is what you can already do today." />

      <section className="mt-10">
        <h2 className="border-b border-line pb-2.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Works today, for any documents</h2>
        <div className="stagger mt-6 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {today.map((t) => (
            <div key={t.title}>
              <t.icon className="h-6 w-6 text-brand-700" strokeWidth={1.6} />
              <h3 className="mt-3 text-[15.5px] font-semibold text-ink">{t.title}</h3>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{t.body}</p>
              {t.to && (
                <Link to={t.to} className="group mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">
                  {t.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}
              {t.call && (
                <button onClick={openCallPaheli} className="group mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">
                  Call me <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button icon={<Plus className="h-4 w-4" />} loading={creating === 'research'}
            onClick={() => create('research', 'General documents', 'Documents from outside the dedicated workspaces.')}>
            Create a general document workspace
          </Button>
          <span className="text-[12.5px] text-ink-muted">It uses the Research workspace, which works with any kind of text.</span>
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Industries we’re building for</h2>
          <span className="text-[12.5px] text-ink-muted">Example questions are illustrations</span>
        </div>
        <ul className="stagger divide-y divide-line">
          {OTHER_INDUSTRIES.map((ind) => (
            <li key={ind.name} className="grid gap-x-6 gap-y-1 py-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] sm:items-center">
              <div className="flex items-center gap-3">
                <ind.icon className="h-5 w-5 shrink-0 text-ink-muted" strokeWidth={1.7} />
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-ink">{ind.name}</h3>
                  <p className="text-[12.5px] text-ink-muted">{ind.documents}</p>
                </div>
              </div>
              <p className="pl-8 text-[14px] italic text-ink-soft sm:pl-0">“{ind.question}”</p>
              <span className="ml-8 w-fit rounded-full bg-spark-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-warn-ink sm:ml-0">Coming soon</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 flex flex-col items-start justify-between gap-6 border-t border-line pt-10 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-[32px] leading-tight text-ink">Don’t see your field?</h2>
          <p className="mt-1 text-[14.5px] text-ink-muted">Paheli reads any text. Start with a general workspace, or talk it through with Paheli.</p>
        </div>
        <Button variant="secondary" size="lg" icon={<PhoneCall className="h-4 w-4" />} onClick={openCallPaheli}>Have Paheli call you</Button>
      </section>
    </Page>
  );
}
