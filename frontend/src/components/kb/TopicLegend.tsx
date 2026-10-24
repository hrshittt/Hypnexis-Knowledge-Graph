import { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import type { Topic } from '../../types/kb';
import { colorForIndex } from '../../lib/graphColors';

interface Props {
  topics: Topic[];
  activeIds: Set<string>;
  onSelect: (topicId: string) => void;
}

export default function TopicLegend({ topics, activeIds, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  if (!topics.length) return null;
  return (
    <div className="absolute bottom-3 left-3 z-10 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-line bg-white/95 shadow-pop backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Topics ({topics.length})</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <ul className="max-h-56 overflow-y-auto px-1.5 pb-1.5">
          {topics.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50 ${
                  activeIds.has(t.id) ? 'bg-slate-100' : ''
                }`}
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForIndex(t.color_index) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-800">{t.label}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {t.size} things{t.keywords.length ? ` · ${t.keywords.slice(0, 3).join(', ')}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> thing</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rotate-45 bg-slate-400" /> idea</span>
        <span className="flex items-center gap-1"><span className="w-4 border-t border-dashed border-slate-500" /> links topics</span>
        <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-slate-900" /> answer path</span>
      </div>
    </div>
  );
}
