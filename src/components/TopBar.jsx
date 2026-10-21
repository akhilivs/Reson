import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, SearchField } from './primitives.jsx';
import { useNavigation } from '../app/NavigationContext.jsx';
import { usePageTitleState } from '../app/PageTitleContext.jsx';

export function TopBar({ searchRef }) {
  const { route, navigate, goBack, goForward, canGoBack, canGoForward } = useNavigation();
  const [query, setQuery] = useState(route.name === 'search' ? route.params.q ?? '' : '');
  const lastRoute = useRef(route);
  const pageTitle = usePageTitleState();

  // Keep the field in sync when navigating away from / back to search.
  useEffect(() => {
    if (route.name === 'search') setQuery(route.params.q ?? '');
    else if (lastRoute.current.name === 'search') setQuery('');
    lastRoute.current = route;
  }, [route]);

  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => {
      if (q && (route.name !== 'search' || route.params.q !== q)) navigate('search', { q });
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <header className="top-bar">
      <div className="top-bar__nav">
        <IconButton label="Back (Alt+Left)" icon={ChevronLeft} disabled={!canGoBack} onClick={goBack} />
        <IconButton label="Forward (Alt+Right)" icon={ChevronRight} disabled={!canGoForward} onClick={goForward} />
      </div>
      <div className="top-bar__search">
        <SearchField
          inputRef={searchRef}
          value={query}
          onChange={(v) => {
            setQuery(v);
            if (!v.trim() && route.name === 'search') goBack();
          }}
          placeholder="Search songs, albums, artists"
          label="Search your library"
          shortcut="Ctrl F"
        />
      </div>
      <div className="top-bar__drag" aria-hidden>
        <span className={`top-bar__title${pageTitle.show && pageTitle.title ? ' is-shown' : ''}`}>{pageTitle.title}</span>
      </div>
    </header>
  );
}
