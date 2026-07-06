import { useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  ListTree,
  Search as SearchIcon,
  BarChart3,
  Clock,
  X,
  Files,
  FolderArchive,
} from 'lucide-react';
import { TableOfContents } from '@/components/Panels/TableOfContents';
import { SearchPanel } from '@/components/Panels/SearchPanel';
import { StatsPanel } from '@/components/Panels/StatsPanel';
import { RecentDocuments } from '@/components/Panels/RecentDocuments';
import { ActiveFiles } from '@/components/Panels/ActiveFiles';
import { ArchivePanel } from '@/components/Panels/ArchivePanel';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/store/useAppStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

type TabId = 'outline' | 'search' | 'files' | 'archives' | 'recent' | 'stats';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  render: (onClose: () => void) => React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: 'outline',
    label: 'Outline',
    icon: <ListTree size={16} />,
    render: (onClose) => <TableOfContents onNavigate={onClose} />,
  },
  {
    id: 'search',
    label: 'Search',
    icon: <SearchIcon size={16} />,
    render: () => <SearchPanel />,
  },
  {
    id: 'files',
    label: 'Open files',
    icon: <Files size={16} />,
    render: (onClose) => <ActiveFiles onSelect={onClose} />,
  },
  {
    id: 'archives',
    label: 'Archives',
    icon: <FolderArchive size={16} />,
    render: (onClose) => <ArchivePanel onSelect={onClose} />,
  },
  {
    id: 'recent',
    label: 'Recent',
    icon: <Clock size={16} />,
    render: (onClose) => <RecentDocuments onSelect={onClose} />,
  },
  {
    id: 'stats',
    label: 'Statistics',
    icon: <BarChart3 size={16} />,
    render: () => <StatsPanel />,
  },
];

/**
 * Tabbed sidebar. Previously we stacked every panel vertically which meant a
 * lot of scrolling on small screens; a tab strip along the top lets us fit
 * more panels (we now expose an "Open files" list) without vertical bloat.
 */
export function Sidebar({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('outline');
  const archiveCount = useAppStore((s) => s.workspace.archives.length);
  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={clsx(
          'md:hidden fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm transition-opacity',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />
      <motion.aside
        initial={false}
        animate={{ x: open ? 0 : '-100%' }}
        transition={{ type: 'tween', duration: 0.22 }}
        className={clsx(
          'md:relative md:translate-x-0 md:!transform-none',
          'fixed inset-y-0 left-0 z-40 w-72 flex-shrink-0',
          'bg-white dark:bg-night-soft border-r border-slate-200 dark:border-slate-800',
          'flex flex-col',
        )}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 md:hidden">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
              M
            </div>
            <span className="font-semibold text-sm">Doc Studio</span>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close menu" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Tab strip */}
        <div
          role="tablist"
          aria-label="Sidebar sections"
          className="flex items-stretch border-b border-slate-200 dark:border-slate-800 px-1"
        >
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            const showBadge = tab.id === 'archives' && archiveCount > 0;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-label={tab.label}
                title={tab.label}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'relative flex-1 h-10 flex items-center justify-center transition-colors',
                  isActive
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                )}
              >
                {tab.icon}
                {showBadge && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-brand-500 text-white text-[9px] font-bold leading-[14px] text-center"
                  >
                    {archiveCount}
                  </span>
                )}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-1 -bottom-px h-0.5 bg-brand-500"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="px-3 pt-3 pb-1">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {active.icon}
            {active.label}
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {active.render(onClose)}
        </div>
      </motion.aside>
    </>
  );
}
