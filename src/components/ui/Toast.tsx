import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';
import { create } from 'zustand';

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

interface ToastState {
  items: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push(t) {
    const id = ++counter;
    set({ items: [...get().items, { id, ...t }] });
    setTimeout(() => get().dismiss(id), 3200);
  },
  dismiss(id) {
    set({ items: get().items.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  success: (message: string) => useToastStore.getState().push({ message, kind: 'success' }),
  error: (message: string) => useToastStore.getState().push({ message, kind: 'error' }),
  info: (message: string) => useToastStore.getState().push({ message, kind: 'info' }),
};

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)]">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="glass rounded-lg shadow-pop px-3.5 py-2.5 flex items-center gap-2 text-sm"
          >
            {t.kind === 'error' ? (
              <XCircle size={16} className="text-red-500 flex-shrink-0" />
            ) : (
              <CheckCircle2
                size={16}
                className={
                  t.kind === 'success' ? 'text-emerald-500' : 'text-brand-500'
                }
              />
            )}
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
