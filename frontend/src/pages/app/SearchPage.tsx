import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, FileText, MessageSquareText, Search, Send, Tag, UserRound } from 'lucide-react';
import { kbApi, workspaceKbApi } from '../../api/kb';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { TYPE_INFO, qaLink } from '../../lib/workspaceTypes';
import { useKBChat } from '../../hooks/useKBChat';
import type { Selection, Source } from '../../types/kb';
import type { SearchResult } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Overlay';
import HighlightedText from '../../components/kb/HighlightedText';
import AnswerCard from '../../components/kb/AnswerCard';
import { SourceLine } from '../../components/evidence/Evidence';

export default function SearchPage() {
  useDocumentTitle('Search');
  const [params, setParams] = useSearchParams();
  const { workspaces } = useAuth();
  const q = params.get('q') ?? '';
  const scope = params.get('scope') ?? 'all';
  const [input, setInput] = useState(q);
  const res = useAsync(() => platformApi.search(q, scope, 5), [q, scope], q.trim().length >= 2);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim().length < 2) return;
    setParams((p) => { const n = new URLSearchParams(p); n.set('q', input.trim()); return n; });
  };

  const d = res.data;
  return (
    <Page>
      <PageHeader icon={<Search />} title="Search and ask"
        description="Search passages, entities and placement records across the workspaces you belong to, or ask a grounded question of one knowledge base." />
      <form onSubmit={submit} className="mt-5 flex flex-wrap gap-2">
        <label htmlFor="global-q" className="sr-only">Search</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input id="global-q" value={input} onChange={(e) => setInput(e.target.value)} autoFocus placeholder="Search for a company, concept, regulation, finding…"
            className="h-11 w-full rounded-xl border border-line-strong bg-white pl-9 pr-3 text-[15px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
        </div>
        <Select value={scope} onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); n.set('scope', e.target.value); return n; })} aria-label="Search scope" className="!h-11 w-60">
          <option value="all">All my workspaces + shared</option>
          <option value="shared">Shared demo corpus</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Button type="submit" size="lg">Search</Button>
      </form>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {!q && <Card><EmptyState icon={<Search />} title="Search everything you have access to">Results come only from workspaces you’re a member of, plus the shared demo corpus.</EmptyState></Card>}
          {q && res.error && <Card><ErrorState message={res.error} onRetry={res.reload} /></Card>}
          {q && res.initialLoading && <Card padded><div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div></Card>}
          {d && <Results data={d} />}
        </div>
        <AskPanel initial={q} />
      </div>
    </Page>
  );
}

function Results({ data }: { data: SearchResult }) {
  const [open, setOpen] = useState<SearchResult['passages'][number] | null>(null);
  const passages = data.passages.filter((p) => !p.error);
  const failures = data.passages.filter((p) => p.error);
  return (
    <>
      <p className="text-[13px] text-ink-muted">Searched {data.searched} knowledge base{data.searched === 1 ? '' : 's'} for “{data.query}”.</p>
      {failures.map((f, i) => <Notice key={i} tone="warn">{f.workspace_name}: {f.error}</Notice>)}
      {data.entities.length > 0 && (
        <Card>
          <CardHeader title="Entities" icon={<Tag className="h-4 w-4" />} />
          <div className="flex flex-wrap gap-1.5 p-4">
            {data.entities.map((e) => (
              <Link key={`${e.workspace_id}-${e.id}`} to={e.workspace_id ? `/app/graph?scope=${e.workspace_id}` : '/app/graph'}
                className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink hover:border-brand-200 hover:bg-brand-50">
                {e.name} <span className="text-ink-muted">· {e.type} · {e.workspace_name}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      {data.placement.length > 0 && (
        <Card>
          <CardHeader title="Placement records" icon={<Building2 className="h-4 w-4" />} />
          <ul className="divide-y divide-line">
            {data.placement.map((p, i) => (
              <li key={i}>
                <Link to={`/app/w/${p.workspace_id}?tab=${p.kind === 'company' ? 'companies' : 'students'}`} className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-canvas">
                  {p.kind === 'company' ? <Building2 className="h-4 w-4 text-ink-muted" /> : <UserRound className="h-4 w-4 text-ink-muted" />}
                  <span className="text-[13.5px] font-medium text-ink">{p.label}</span>
                  <span className="text-[12px] text-ink-muted">{p.kind === 'company' ? 'Company' : 'Student'} · {p.workspace_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title={`Passages (${passages.length})`} icon={<FileText className="h-4 w-4" />} description="Ranked by hybrid keyword and semantic relevance." />
        {!passages.length ? <EmptyState compact title="No matching passages">Try different words, or widen the scope.</EmptyState> : (
          <ul className="divide-y divide-line">
            {passages.map((p, i) => (
              <li key={`${p.chunk_id}-${i}`} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <Badge tone={p.workspace_type === 'shared' ? 'outline' : 'brand'}>{p.workspace_type === 'shared' ? 'Shared' : TYPE_INFO[p.workspace_type].short}</Badge>
                    <span className="text-ink-muted">{p.workspace_name}</span>
                  </span>
                  <button onClick={() => setOpen(p)} className="text-[12.5px] font-medium text-brand-700 hover:underline">Read passage</button>
                </div>
                <div className="mt-1.5"><SourceLine c={{ filename: p.filename ?? '', page: p.page ?? 1 }} /></div>
                <div className="mt-1.5 line-clamp-4"><HighlightedText text={p.text ?? ''} ranges={p.highlights ?? []} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Passage" description={open && <SourceLine c={{ filename: open.filename ?? '', page: open.page ?? 1 }} />} size="lg"
        footer={open && <Link to={open.workspace_id ? `/app/graph?scope=${open.workspace_id}` : '/app/graph'} className="text-[13px] font-medium text-brand-700 hover:underline">Explore this knowledge graph</Link>}>
        {open && <HighlightedText text={open.text ?? ''} ranges={open.highlights ?? []} className="text-[13.5px]" />}
      </Modal>
    </>
  );
}

/** A grounded question to one knowledge base the user can access, answered inline with citations. */
function AskPanel({ initial }: { initial: string }) {
  const { workspaces } = useAuth();
  const nav = useNavigate();
  const kbTargets = workspaces.filter((w) => w.type !== 'placement');
  const [target, setTarget] = useState('shared');
  const [question, setQuestion] = useState(initial);
  const [passage, setPassage] = useState<Source | null>(null);
  const ws = workspaces.find((w) => w.id === target) ?? null;
  const api = useMemo(() => (target === 'shared' || !ws || ws.type === 'placement' ? kbApi : workspaceKbApi(target)), [target, ws]);
  const onAnswer = useCallback(() => {}, []);
  const chat = useKBChat(onAnswer, api);

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    if (ws?.type === 'placement') { nav(qaLink(ws, question.trim())); return; }
    chat.ask(question.trim());
  };
  const select = (s: Selection) => {
    if (s?.kind === 'source') setPassage(s.source);
    else nav(ws ? `/app/graph?scope=${ws.id}` : '/app/graph');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Ask the assistant" icon={<MessageSquareText className="h-4 w-4" />}
          description="Answers use only the knowledge base you choose and cite their sources. Nothing crosses between workspaces." />
        <form onSubmit={ask} className="space-y-3 p-4">
          <Select value={target} onChange={(e) => { setTarget(e.target.value); chat.clear(); }} aria-label="Knowledge base to ask">
            <option value="shared">Shared demo corpus</option>
            {kbTargets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            {workspaces.filter((w) => w.type === 'placement').map((w) => <option key={w.id} value={w.id}>{w.name} (placement assistant)</option>)}
          </Select>
          <div className="flex gap-2">
            <label htmlFor="ask-q" className="sr-only">Question</label>
            <input id="ask-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Explain the key risks in this annual report"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong px-3 text-[14px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
            <Button type="submit" icon={<Send className="h-4 w-4" />} disabled={!question.trim() || chat.pending}>Ask</Button>
          </div>
          {ws?.type === 'placement' && <p className="text-[12px] text-ink-muted">Placement questions open the placement assistant, which calculates answers from imported records.</p>}
        </form>
      </Card>
      {chat.turns.map((t) => (
        <AnswerCard key={t.id} turn={t} active={false} onSelect={select} onAsk={(q) => chat.ask(q)}
          onActivate={() => nav(qaLink(ws, t.question))} />
      ))}
      {chat.turns.length > 0 && (
        <div className="flex flex-wrap gap-3 text-[13px]">
          <Link to={qaLink(ws, chat.turns[chat.turns.length - 1].question)} className="font-medium text-brand-700 hover:underline">Open with the knowledge graph</Link>
          <button className="text-ink-muted hover:text-ink" onClick={chat.clear}>Clear answers</button>
        </div>
      )}
      <Modal open={!!passage} onClose={() => setPassage(null)} title={passage ? `Source ${passage.id}` : ''} size="lg"
        description={passage && <SourceLine c={{ filename: passage.filename, page: passage.page }} />}>
        {passage && <HighlightedText text={passage.text} ranges={passage.highlights} className="text-[13.5px]" />}
      </Modal>
    </div>
  );
}
