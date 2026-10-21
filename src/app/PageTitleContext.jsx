import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Lets a page register its big header so the top bar can show a condensed title once the header
// scrolls out of view (the "large title collapses into the bar" pattern).
const PageTitleContext = createContext({ title: null, show: false, set: () => {} });

export function PageTitleProvider({ children }) {
  const [state, setState] = useState({ title: null, show: false });
  const value = useMemo(() => ({ ...state, set: setState }), [state]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

export function usePageTitleState() {
  return useContext(PageTitleContext);
}

/** Registers `title` and watches `ref` (the page's big header) to decide when to show it in the bar. */
export function usePageTitle(title, ref) {
  const { set } = useContext(PageTitleContext);
  useEffect(() => {
    const el = ref.current;
    if (!title || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => set({ title, show: !entry.isIntersecting }), {
      rootMargin: '-56px 0px 0px 0px',
      threshold: 0,
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      set((s) => (s.title === title ? { title: null, show: false } : s));
    };
  }, [title, ref, set]);
}
