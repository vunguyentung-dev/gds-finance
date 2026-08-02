import type { ThemeName } from '../lib/theme';
import type { ScreenTitle } from '../lib/nav';
import { UserMenu } from './UserMenu';

interface TopbarProps {
  screenTitle: ScreenTitle;
  theme: ThemeName;
  onToggleTheme: () => void;
}

export function Topbar({ screenTitle, theme, onToggleTheme }: TopbarProps) {
  const isLight = theme === 'light';

  return (
    <div className="gf-topbar">
      <div>
        <div className="gf-topbar-crumb">{screenTitle.crumb}</div>
        <div className="gf-topbar-title">{screenTitle.title}</div>
      </div>

      <div className="gf-topbar-right">
        <div className="gf-chip gf-num">
          VN-Index <b style={{ color: 'var(--up)' }}>1.312,7 <span style={{ fontWeight: 500 }}>+0,84%</span></b>
        </div>
        <div className="gf-chip gf-num">
          HNX <b style={{ color: 'var(--down)' }}>237,4 <span style={{ fontWeight: 500 }}>−0,31%</span></b>
        </div>
        <button type="button" className="gf-theme-toggle" onClick={onToggleTheme}>
          {isLight ? '🌙' : '☀️'} Nền {isLight ? 'Tối' : 'Sáng'}
        </button>

        <UserMenu
          user={window.GDSFIN?.user}
          logoutUrl={window.GDSFIN?.logoutUrl}
          restUrl={window.GDSFIN?.restUrl}
        />
      </div>
    </div>
  );
}
