import { Clock, FileText, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui/Button';

function relative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  onSelect?: () => void;
}

export function RecentDocuments({ onSelect }: Props) {
  const recents = useAppStore((s) => s.recents);
  const currentId = useAppStore((s) => s.document.id);
  const openDoc = useAppStore((s) => s.openDoc);
  const removeRecentDoc = useAppStore((s) => s.removeRecentDoc);

  if (recents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-4">
        <Clock size={16} />
        <span>No recent documents yet.</span>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {recents.map((r) => (
        <li key={r.id} className="group flex items-center gap-1">
          <button
            className={
              'flex-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm truncate ' +
              (r.id === currentId
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200')
            }
            onClick={() => {
              openDoc(r);
              onSelect?.();
            }}
            title={r.title}
          >
            <FileText size={14} className="flex-shrink-0 opacity-70" />
            <span className="truncate flex-1">{r.title || 'Untitled'}</span>
            <span className="text-[10px] text-slate-400 flex-shrink-0">
              {relative(r.updatedAt)}
            </span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${r.title}`}
            className="opacity-0 group-hover:opacity-100 !h-7 !w-7"
            onClick={() => removeRecentDoc(r.id)}
          >
            <Trash2 size={12} />
          </Button>
        </li>
      ))}
    </ul>
  );
}
