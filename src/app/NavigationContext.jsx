import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { withViewTransition } from './motion.js';

// Minimal in-memory router with back/forward history. A routing library would add little here:
// there are no URLs to sync with in a desktop window.
const NavigationContext = createContext(null);

const sameRoute = (a, b) => a.name === b.name && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});

export function NavigationProvider({ initial = { name: 'home' }, children }) {
  const [state, setState] = useState({ back: [], current: initial, forward: [] });
  const stateRef = useRef(state);
  stateRef.current = state;

  // Every route change runs inside a View Transition (page slide; shared art morphs).
  const navigate = useCallback((name, params = {}) => {
    const next = { name, params };
    if (sameRoute(stateRef.current.current, next)) return;
    withViewTransition(
      () => setState((s) => (sameRoute(s.current, next) ? s : { back: [...s.back.slice(-50), s.current], current: next, forward: [] })),
      { direction: 'forward' },
    );
  }, []);

  const goBack = useCallback(() => {
    if (!stateRef.current.back.length) return;
    withViewTransition(
      () => setState((s) => (s.back.length ? { back: s.back.slice(0, -1), current: s.back.at(-1), forward: [s.current, ...s.forward] } : s)),
      { direction: 'back' },
    );
  }, []);

  const goForward = useCallback(() => {
    if (!stateRef.current.forward.length) return;
    withViewTransition(
      () => setState((s) => (s.forward.length ? { back: [...s.back, s.current], current: s.forward[0], forward: s.forward.slice(1) } : s)),
      { direction: 'forward' },
    );
  }, []);

  const value = useMemo(
    () => ({
      route: state.current,
      navigate,
      goBack,
      goForward,
      canGoBack: state.back.length > 0,
      canGoForward: state.forward.length > 0,
    }),
    [state, navigate, goBack, goForward],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  return useContext(NavigationContext);
}
