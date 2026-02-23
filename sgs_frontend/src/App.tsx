import { useEffect, useRef, useState } from 'react';
import { config } from './config';
import { Layout } from './components/Layout';
import { GamesCatalog } from './components/GamesCatalog';
import { DocsPage } from './pages/DocsPage';
import { HomePage } from './pages/HomePage';
import type { Page } from './types/navigation';

const baseUrl = import.meta.env.BASE_URL || '/';
const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
const rootPath = normalizedBase === '' ? '/' : `${normalizedBase}/`;

const parseHashRoute = (): { page: Page; search: string } | null => {
  if (typeof window === 'undefined') return null;

  const raw = window.location.hash.replace('#', '');
  if (!raw) return null;

  const [pathPart, queryPart = ''] = raw.split('?');
  const segment = pathPart.replace(/^\/+/, '').split('/')[0];

  if (segment !== 'docs' && segment !== 'games') return null;

  return {
    page: segment as Page,
    search: queryPart ? `?${queryPart}` : '',
  };
};

const resolvePageFromLocation = (): Page => {
  if (typeof window === 'undefined') return 'home';

  const hashRoute = parseHashRoute();
  if (hashRoute) return hashRoute.page;

  const path = window.location.pathname;
  const relative = normalizedBase && path.startsWith(normalizedBase)
    ? path.slice(normalizedBase.length)
    : path;
  const segment = relative.replace(/^\/+/, '').split('/')[0];

  if (segment === 'docs') return 'docs';
  if (segment === 'games') return 'games';
  return 'home';
};

const buildPath = (page: Page) => {
  if (page === 'home') return rootPath;
  return `${normalizedBase}/${page}`;
};

function App() {
  const [page, setPage] = useState<Page>(() => resolvePageFromLocation());
  const [visiblePage, setVisiblePage] = useState<Page>(() => resolvePageFromLocation());
  const [transitionStage, setTransitionStage] = useState<'idle' | 'exiting' | 'entering'>('idle');
  const exitTimerRef = useRef<number | null>(null);
  const enterTimerRef = useRef<number | null>(null);
  const transitionDurationMs = 220;
  const hasAnyContracts = Object.keys(config.contractIds).length > 0;

  const navigate = (next: Page) => {
    const target = buildPath(next);
    if (typeof window !== 'undefined' && window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    setPage(next);
  };

  useEffect(() => {
    const hashRoute = parseHashRoute();
    if (hashRoute) {
      const target = `${buildPath(hashRoute.page)}${hashRoute.search}`;
      if (`${window.location.pathname}${window.location.search}` !== target) {
        window.history.replaceState(null, '', target);
      }
    }

    const handleRouteChange = () => {
      setPage(resolvePageFromLocation());
    };

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  useEffect(() => {
    if (page === visiblePage) return;

    if (exitTimerRef.current) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (enterTimerRef.current) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }

    setTransitionStage('exiting');

    exitTimerRef.current = window.setTimeout(() => {
      setVisiblePage(page);
      setTransitionStage('entering');

      enterTimerRef.current = window.setTimeout(() => {
        setTransitionStage('idle');
        enterTimerRef.current = null;
      }, transitionDurationMs);

      exitTimerRef.current = null;
    }, transitionDurationMs);
  }, [page, visiblePage]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      if (enterTimerRef.current) window.clearTimeout(enterTimerRef.current);
    };
  }, []);

  return (
    <Layout currentPage={page} onNavigate={navigate}>
      {!hasAnyContracts && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3>Setup Required</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Contract IDs not configured. Please run <code>bun run setup</code> from the repo root
            to deploy contracts and configure the studio frontend.
          </p>
        </div>
      )}

      <div className={`page-transition page-transition-${transitionStage}`}>
        {visiblePage === 'docs' && <DocsPage />}
        {visiblePage === 'games' && <GamesCatalog onBack={() => navigate('home')} />}
        {visiblePage === 'home' && <HomePage onNavigate={navigate} />}
      </div>
    </Layout>
  );
}

export default App;
