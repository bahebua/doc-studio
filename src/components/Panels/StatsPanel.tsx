import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { computeStats } from '@/lib/stats';

export function StatsPanel() {
  const content = useAppStore((s) => s.document.content);
  const stats = useMemo(() => computeStats(content), [content]);

  const rows: Array<[string, string | number]> = [
    ['Characters', stats.characters.toLocaleString()],
    ['Characters (no spaces)', stats.charactersNoSpaces.toLocaleString()],
    ['Words', stats.words.toLocaleString()],
    ['Sentences', stats.sentences.toLocaleString()],
    ['Paragraphs', stats.paragraphs.toLocaleString()],
    ['Reading time', `${stats.readingTimeMinutes} min`],
  ];

  return (
    <dl className="grid grid-cols-2 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
