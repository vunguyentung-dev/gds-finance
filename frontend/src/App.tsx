import { useState } from 'react';
import { AppShell } from './components/AppShell';
import type { Screen } from './lib/nav';
import type { ThemeName } from './lib/theme';

export function App() {
  const [screen, setScreen] = useState<Screen>('overview');
  const [theme, setTheme] = useState<ThemeName>('light');

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return <AppShell screen={screen} theme={theme} onNavigate={setScreen} onToggleTheme={toggleTheme} />;
}
