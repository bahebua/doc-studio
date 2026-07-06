import { create } from 'zustand';

interface SearchState {
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  setQuery: (q: string) => void;
  setCaseSensitive: (v: boolean) => void;
  setUseRegex: (v: boolean) => void;
}

/**
 * Search state shared between the sidebar SearchPanel and the live preview
 * highlighter (and any future consumer). Kept small and separate from the
 * main app store because it's pure UI state that doesn't need persistence.
 */
export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  caseSensitive: false,
  useRegex: false,
  setQuery: (query) => set({ query }),
  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),
  setUseRegex: (useRegex) => set({ useRegex }),
}));
