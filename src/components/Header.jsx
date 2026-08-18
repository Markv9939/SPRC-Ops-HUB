import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Building2,
  Bus,
  ClipboardCheck,
  FileClock,
  Home,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  Radio,
  ReceiptText,
  ShieldCheck,
  Shirt,
  Truck,
  UserRound,
  Users,
  X
} from 'lucide-react'

const MANAGEMENT_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'transports', label: 'Transports', icon: Bus },
  { id: 'debriefs', label: 'Debriefs', icon: ClipboardCheck },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'eoc', label: 'EOC', icon: Radio },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'properties', label: 'Properties', icon: Building2 },
  { id: 'fleet', label: 'Fleet', icon: Truck },
  { id: 'cintas', label: 'Cintas', icon: Shirt },
  { id: 'feedback', label: 'App Feedback', icon: MessageSquare, adminOnly: true },
  { id: 'audit', label: 'Audit', icon: ReceiptText, adminOnly: true }
]

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`shell-status-pill shell-status-${tone}`}>{children}</span>
}

function Header({
  userName,
  userSubtitle = '',
  isManagement = false,
  isAdmin = false,
  pageTitle = 'Home',
  activeSection = '',
  showBack = false,
  onBack,
  onNavigateHome,
  onNavigateSection,
  onLogout,
  onChangePin,
  canChangeOwnPin = false,
  alertCount = 0,
  isOffline = false,
  pendingSyncCount = 0,
  needsReviewCount = 0,
  onNotificationsOpen
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef(null)
  const firstName = String(userName || '').split(' ')[0]
  const navItems = isManagement
    ? MANAGEMENT_NAV.filter(item => !item.adminOnly || isAdmin)
    : [{ id: 'home', label: 'Home', icon: Home }]

  useEffect(() => {
    if (!drawerOpen) return undefined
    const handleEscape = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [drawerOpen])

  const handleNavigate = (item) => {
    setDrawerOpen(false)
    if (item.id === 'home') {
      onNavigateHome?.()
      return
    }
    onNavigateSection?.(item.id)
  }

  const accountActions = (
    <>
      {canChangeOwnPin && (
        <button className="shell-nav-item shell-account-action" onClick={() => { setDrawerOpen(false); onChangePin?.() }}>
          <KeyRound size={19} aria-hidden="true" />
          <span>Change PIN</span>
        </button>
      )}
      <button className="shell-nav-item shell-account-action shell-signout" onClick={() => { setDrawerOpen(false); onLogout?.() }}>
        <LogOut size={19} aria-hidden="true" />
        <span>Sign Out</span>
      </button>
    </>
  )

  return (
    <>
      {isManagement && (
        <aside className="desktop-sidebar" aria-label="Primary navigation">
          <button className="sidebar-brand" onClick={onNavigateHome} aria-label="Ops Hub dashboard">
            <img src="/branding/sprc-mark-white.png" alt="" />
            <span>Ops Hub</span>
          </button>
          <nav className="sidebar-nav">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  className={`shell-nav-item ${activeSection === item.id ? 'shell-nav-active' : ''}`}
                  onClick={() => handleNavigate(item)}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="sidebar-account">{accountActions}</div>
        </aside>
      )}

      <header className={`app-topbar ${isManagement ? 'management-topbar' : 'field-topbar'}`}>
        <div className="mobile-topbar-leading">
          {showBack ? (
            <button className="topbar-icon-btn" onClick={onBack} aria-label="Back">
              <ArrowLeft size={22} />
            </button>
          ) : (
            <button className="mobile-brand" onClick={onNavigateHome} aria-label="Ops Hub home">
              <img src="/branding/sprc-mark-white.png" alt="" />
              <span>Ops Hub</span>
            </button>
          )}
        </div>

        <div className="desktop-breadcrumb">
          <button onClick={onNavigateHome}>Home</button>
          <span>/</span>
          <strong>{pageTitle}</strong>
        </div>

        <div className="mobile-page-title">{pageTitle}</div>

        <div className="topbar-actions">
          <div className="topbar-statuses">
            {isOffline && <StatusPill tone="warning">Offline</StatusPill>}
            {pendingSyncCount > 0 && <StatusPill tone="success">Sync {pendingSyncCount}</StatusPill>}
            {needsReviewCount > 0 && <StatusPill tone="danger">Review {needsReviewCount}</StatusPill>}
          </div>
          <button
            className="topbar-icon-btn notification-button"
            onClick={() => onNotificationsOpen?.()}
            aria-label={`${alertCount} unread notifications`}
          >
            <Bell size={21} />
            {alertCount > 0 && <span className="notification-count">{alertCount > 99 ? '99+' : alertCount}</span>}
          </button>
          <div className="desktop-user">
            <UserRound size={23} aria-hidden="true" />
            <span>{firstName}</span>
          </div>
          <button
            className="topbar-icon-btn mobile-menu-button"
            onClick={() => setDrawerOpen(prev => !prev)}
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {drawerOpen && (
        <div className="mobile-drawer-layer">
          <button className="mobile-drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close menu" />
          <aside className="mobile-drawer" ref={drawerRef} aria-label="App menu">
            <div className="drawer-account">
              <UserRound size={24} aria-hidden="true" />
              <div>
                <strong>{userName}</strong>
                {userSubtitle && <span>{userSubtitle}</span>}
              </div>
            </div>
            <nav className="drawer-nav">
              {navItems.map(item => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    className={`shell-nav-item ${activeSection === item.id ? 'shell-nav-active' : ''}`}
                    onClick={() => handleNavigate(item)}
                    aria-current={activeSection === item.id ? 'page' : undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
            <div className="drawer-account-actions">
              {accountActions}
              <div className="drawer-version-row">
                <FileClock size={15} aria-hidden="true" />
                <span>Current session</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

export default Header
