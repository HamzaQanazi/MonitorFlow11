import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import NotificationBell from '../components/NotificationBell'
import { Wordmark } from '../components/Wordmark'
import './DashboardShell.css'

// Nav items carry a `group` for the sidebar's section headers — purely a
// presentation grouping, not a permission concept (Gate 1/2 are unchanged).
type NavGroup = 'overview' | 'people' | 'operations' | 'communication' | 'setup'

// Oversight nav, each item gated by the capability its page needs (Gate 1).
// A lead with every capability sees them all; a narrower level sees a subset.
// `labelKey` resolves through t() so the nav flips language with the console.
const oversightNav: { to: string; labelKey: string; end: boolean; need: string; group: NavGroup }[] = [
  { to: '/', labelKey: 'nav_dashboard', end: true, need: 'view_all', group: 'overview' },
  { to: '/requests', labelKey: 'nav_requests', end: false, need: 'view_all', group: 'overview' },
  { to: '/reports', labelKey: 'nav_reports', end: false, need: 'view_all', group: 'overview' },
  { to: '/employees', labelKey: 'nav_employees', end: false, need: 'manage_employees', group: 'people' },
  { to: '/timeclock', labelKey: 'nav_timeclock', end: false, need: 'view_all', group: 'operations' },
  { to: '/schedule', labelKey: 'nav_schedule', end: false, need: 'view_all', group: 'operations' },
  { to: '/checklists', labelKey: 'nav_checklists', end: false, need: 'view_all', group: 'operations' },
  { to: '/directory', labelKey: 'nav_directory', end: false, need: 'view_all', group: 'communication' },
  { to: '/knowledge-base', labelKey: 'nav_knowledge_base', end: false, need: 'view_all', group: 'communication' },
  { to: '/events', labelKey: 'nav_events', end: false, need: 'view_all', group: 'communication' },
  { to: '/training', labelKey: 'nav_training', end: false, need: 'view_all', group: 'communication' },
]
// Owner (admin role) surface. Dashboard + Employees admit the admin via the
// backend's requireCapabilityOrAdmin (I2: admins hold no capabilities, so this
// is a role-based allow, not a Gate-1 capability like oversightNav's items).
const adminNav: { to: string; labelKey: string; end: boolean; group: NavGroup }[] = [
  { to: '/', labelKey: 'nav_dashboard', end: true, group: 'overview' },
  { to: '/employees', labelKey: 'nav_employees', end: false, group: 'people' },
  { to: '/departments', labelKey: 'nav_departments', end: false, group: 'people' },
  { to: '/levels', labelKey: 'nav_levels', end: false, group: 'people' },
  { to: '/timeclock', labelKey: 'nav_timeclock', end: false, group: 'operations' },
  { to: '/schedule', labelKey: 'nav_schedule', end: false, group: 'operations' },
  { to: '/checklists', labelKey: 'nav_checklists', end: false, group: 'operations' },
  { to: '/directory', labelKey: 'nav_directory', end: false, group: 'communication' },
  { to: '/knowledge-base', labelKey: 'nav_knowledge_base', end: false, group: 'communication' },
  { to: '/events', labelKey: 'nav_events', end: false, group: 'communication' },
  { to: '/training', labelKey: 'nav_training', end: false, group: 'communication' },
  { to: '/services/new', labelKey: 'nav_add_service', end: false, group: 'setup' },
  { to: '/audit', labelKey: 'nav_audit', end: false, group: 'setup' },
]

const GROUP_ORDER: NavGroup[] = ['overview', 'people', 'operations', 'communication', 'setup']
const GROUP_LABEL_KEY: Record<NavGroup, string> = {
  overview: 'nav_group_overview',
  people: 'nav_group_people',
  operations: 'nav_group_operations',
  communication: 'nav_group_communication',
  setup: 'nav_group_setup',
}

export default function DashboardShell() {
  const { user, logout } = useAuth()
  const { t, lang, setLang } = useI18n()
  const isAdmin = user?.role === 'admin'
  const navItems = isAdmin
    ? adminNav
    : oversightNav.filter((item) => user?.capabilities.includes(item.need))

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-sidebar-top">
          <Wordmark
            variant="shell"
            companyName={user?.onboardingCompleted ? user.companyName : null}
            companyLogo={user?.onboardingCompleted ? user.companyLogo : null}
          />
        </div>
        <nav className="shell-nav" aria-label="Primary">
          {GROUP_ORDER.map((group) => {
            const items = navItems.filter((item) => item.group === group)
            if (!items.length) return null
            return (
              <div className="shell-nav-group" key={group}>
                <div className="shell-nav-group-label">{t(GROUP_LABEL_KEY[group])}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    {t(item.labelKey)}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="shell-session">
          {/* No notification triggers target the admin — an always-empty bell is noise. */}
          {!isAdmin && <NotificationBell />}
          <div className="shell-session-row">
            <button type="button" className="shell-signout" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
              {t('lang_toggle')}
            </button>
          </div>
          <span className="shell-user">{user?.name}</span>
          <button className="shell-signout" type="button" onClick={logout}>
            {t('sign_out')}
          </button>
        </div>
      </aside>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  )
}
