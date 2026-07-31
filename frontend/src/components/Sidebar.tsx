import { nav, type Screen } from '../lib/nav';

interface SidebarProps {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}

export function Sidebar({ screen, onNavigate }: SidebarProps) {
  return (
    <aside className="gf-sidebar">
      <div className="gf-sidebar-brand">
        <div className="gf-sidebar-logo">V</div>
        <span className="gf-sidebar-name">VNInvest</span>
      </div>

      <nav className="gf-nav">
        {nav.map((item) => {
          const isActive = item.id === screen;
          return (
            <button
              key={item.id}
              type="button"
              className={`gf-nav-item${isActive ? ' is-active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="gf-nav-dot" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
