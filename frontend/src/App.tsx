import { useCallback, useState, useSyncExternalStore } from 'react';
import { AppShell } from './components/AppShell';
import { isScreen, type Screen } from './lib/nav';
import type { ThemeName } from './lib/theme';

const DEFAULT_SCREEN: Screen = 'overview';

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): string {
  return window.location.hash.replace(/^#/, '');
}

export function App() {
  // location.hash là nguồn sự thật duy nhất cho màn đang xem: giữ nguyên màn
  // khi F5, và Back/Forward của trình duyệt hoạt động sẵn không cần xử lý thêm.
  const hash = useSyncExternalStore(subscribeToHash, readHash);
  const screen = isScreen(hash) ? hash : DEFAULT_SCREEN;

  const [theme, setTheme] = useState<ThemeName>('light');

  const navigate = useCallback((next: Screen) => {
    window.location.hash = next;
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return <AppShell screen={screen} theme={theme} onNavigate={navigate} onToggleTheme={toggleTheme} />;
}
