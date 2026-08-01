import type { CSSProperties } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ScreenPlaceholder } from './ScreenPlaceholder';
import { FinanceScreen } from '../screens/finance/FinanceScreen';
import { TradeScreen } from '../screens/trade/TradeScreen';
import { JournalScreen } from '../screens/journal/JournalScreen';
import { ChecklistScreen } from '../screens/checklist/ChecklistScreen';
import { titles, type Screen } from '../lib/nav';
import { themeVars, type ThemeName } from '../lib/theme';

interface AppShellProps {
  screen: Screen;
  theme: ThemeName;
  onNavigate: (screen: Screen) => void;
  onToggleTheme: () => void;
}

export function AppShell({ screen, theme, onNavigate, onToggleTheme }: AppShellProps) {
  const style = themeVars(theme) as CSSProperties;
  const screenTitle = titles[screen];

  return (
    <div className="gf-app" style={style}>
      <Sidebar screen={screen} onNavigate={onNavigate} />
      <main className="gf-main">
        <Topbar screenTitle={screenTitle} theme={theme} onToggleTheme={onToggleTheme} />
        <div className="gf-content">
          {screen === 'finance' ? (
            <FinanceScreen />
          ) : screen === 'trade' ? (
            <TradeScreen />
          ) : screen === 'journal' ? (
            <JournalScreen />
          ) : screen === 'checklist' ? (
            <ChecklistScreen />
          ) : (
            <ScreenPlaceholder />
          )}
        </div>
      </main>
    </div>
  );
}
