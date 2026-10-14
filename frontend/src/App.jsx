import React, { useState, useEffect } from 'react';
import ReceiptCapture from './components/ReceiptCapture';
import ReceiptView from './components/ReceiptView';
import ManagerApprovalsView from './components/ManagerApprovalsView';
import FinanceBatchView from './components/FinanceBatchView';
import JournalEntryView from './components/JournalEntryView';
import ErrorBoundary from './components/ErrorBoundary';
import { IS_DEMO_MODE, DEMO_ACCOUNTS } from './config/demoConfig';
import {
  IconDashboard,
  IconCamera,
  IconReceipt,
  IconShield,
  IconBuilding,
  IconKey,
  IconLogout,
  IconLock,
  IconMenu,
  IconSearch,
  IconInfo,
  IconFileText,
  IconClock,
  IconCheckCircle,
  IconUpload,
  IconClipboard,
  IconScale,
  IconRefresh,
  IconPlus,
  IconEye,
  IconChevronLeft,
  IconChevronRight,
} from './components/Icons';

function App() {
  const [backendHealth, setBackendHealth] = useState('checking');
  const [readinessData, setReadinessData] = useState(null);
  const [authToken, setAuthToken] = useState(localStorage.getItem('token') || '');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });
  const [latestReceipt, setLatestReceipt] = useState(null);
  const [receiptsList, setReceiptsList] = useState([]);
  const [personalReceiptsList, setPersonalReceiptsList] = useState([]);
  const [managerLedgerTab, setManagerLedgerTab] = useState('PENDING_APPROVALS'); // 'PENDING_APPROVALS' or 'PERSONAL'
  const [loadingReceipts, setLoadingReceipts] = useState(false);

  // Active navigation view: 'dashboard' | 'upload' | 'receipt-detail' | 'approvals' | 'finance' | 'mappings' | 'integrations'
  const [activeNav, setActiveNav] = useState('dashboard');
  const [autoStartCamera, setAutoStartCamera] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('expenseease_sidebar_collapsed') === 'true';
    } catch (_) {
      return false;
    }
  });

  // Keyboard shortcut (Ctrl+B) to toggle sidebar expansion
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setSidebarCollapsed((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('expenseease_sidebar_collapsed', String(next));
          } catch (_) {}
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);


  // Single unified login form states
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [slug, setSlug] = useState('demo');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Fetch receipts for authenticated user / tenant
  async function fetchReceipts(token) {
    if (!token) return;
    setLoadingReceipts(true);
    try {
      // 1. Fetch submitted tenant receipts (or own receipts if Employee)
      const res = await fetch('/api/receipts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.receipts || [];
        setReceiptsList(list);
      }

      // 2. Fetch personal upload history (drafts + own submissions for current unique ID)
      const personalRes = await fetch('/api/receipts?scope=personal', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (personalRes.ok) {
        const personalData = await personalRes.json();
        const personalList = personalData.receipts || [];
        setPersonalReceiptsList(personalList);
        if (personalList.length > 0 && !latestReceipt) {
          setLatestReceipt(personalList[0]);
        }
      }
    } catch (err) {
      // quiet fail
    } finally {
      setLoadingReceipts(false);
    }
  }

  // 1. Initial health and readiness check (runs once on mount)
  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
      .then((data) => setBackendHealth(data.status === 'ok' ? 'online' : 'degraded'))
      .catch(() => setBackendHealth('offline'));

    fetch('/api/health/ready')
      .then((res) => res.json())
      .then((data) => setReadinessData(data))
      .catch(() => setReadinessData(null));
  }, []);

  // 2. Session verification when authToken changes
  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      return;
    }

    let isMounted = true;
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject('Invalid token')))
      .then((data) => {
        if (isMounted) {
          setCurrentUser((prev) => ({ ...(prev || {}), ...data.user }));
          fetchReceipts(authToken);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthToken('');
          setCurrentUser(null);
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authToken]);

  const handleLogin = async (e, customCreds = null) => {
    if (e && e.preventDefault) e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    const identifier = (customCreds?.loginId || customCreds?.email || loginIdentifier || '').trim();
    const creds = customCreds || {
      email: identifier,
      loginId: identifier,
      password,
      slug: (slug || 'demo').trim(),
    };

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }
      setAuthToken(data.token);
      setCurrentUser(data.user);
      localStorage.setItem('token', data.token);
      if (data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
      }

      // Default landing view based on database-assigned role
      if (data.user.role === 'FINANCE') {
        setActiveNav('finance');
      } else if (data.user.role === 'MANAGER') {
        setActiveNav('dashboard');
      } else {
        setActiveNav('dashboard');
      }
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthToken('');
    setCurrentUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setLatestReceipt(null);
    setActiveNav('dashboard');
  };

  // Calculate real dashboard statistics from receiptsList
  const totalSubmittedCount = receiptsList.length;
  const pendingCount = receiptsList.filter((r) => (r.workflow_state || r.workflowState) === 'PENDING_APPROVAL').length;
  const approvedCount = receiptsList.filter((r) => (r.workflow_state || r.workflowState) === 'APPROVED').length;

  // Ledger table pagination state
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPageSize, setLedgerPageSize] = useState(10);

  // Enforce Role-Based Access Control on active view
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role === 'EMPLOYEE') {
      if (activeNav === 'approvals' || activeNav === 'finance') {
        setActiveNav('dashboard');
      }
    } else if (currentUser.role === 'MANAGER') {
      if (activeNav === 'finance') {
        setActiveNav('dashboard');
      }
    } else if (currentUser.role === 'FINANCE') {
      if (activeNav === 'upload' || activeNav === 'approvals') {
        setActiveNav('finance');
      }
    }
  }, [currentUser?.role, activeNav]);

  // Active ledger dataset based on role and tab:
  // Managers toggle between submitted tenant claims pool and their personal upload history.
  // Employees always view their personal upload history.
  const activeLedgerReceipts = (currentUser?.role === 'MANAGER' && managerLedgerTab === 'PERSONAL')
    ? personalReceiptsList
    : (currentUser?.role === 'EMPLOYEE' ? (personalReceiptsList.length > 0 ? personalReceiptsList : receiptsList) : receiptsList);

  const filteredReceipts = Array.isArray(activeLedgerReceipts) ? activeLedgerReceipts : [];
  const totalLedger = filteredReceipts.length;
  const totalLedgerPages = Math.ceil(totalLedger / ledgerPageSize) || 1;
  const safeLedgerPage = Math.min(Math.max(ledgerPage, 1), totalLedgerPages);
  const paginatedLedgerReceipts = filteredReceipts.slice(
    (safeLedgerPage - 1) * ledgerPageSize,
    safeLedgerPage * ledgerPageSize
  );

  // For inspection/editing personal drafts, use the user's personal upload history
  const userInspectList = personalReceiptsList.length > 0 ? personalReceiptsList : receiptsList;

  return (
    <div className="app-shell">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)}></div>
      )}

      {/* Dark Sidebar (Stitch Design Spec) */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', padding: sidebarCollapsed ? '0 10px' : '0 16px', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, overflow: 'hidden' }}>
            <div className="brand-badge" title="ExpenseEase">E</div>
            {!sidebarCollapsed && (
              <div className="brand-title">
                <span className="brand-name">ExpenseEase</span>
                <span className="brand-tagline">SMB PLATFORM</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={() => {
              const next = !sidebarCollapsed;
              setSidebarCollapsed(next);
              try {
                localStorage.setItem('expenseease_sidebar_collapsed', String(next));
              } catch (_) {}
            }}
            title={sidebarCollapsed ? "Expand Sidebar (Ctrl+B)" : "Collapse Sidebar (Ctrl+B)"}
            aria-label={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {sidebarCollapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <div>
            {!sidebarCollapsed && <div className="nav-section-title">Operations &amp; Finance</div>}
            <ul className="nav-list">
              {currentUser ? (
                <>
                  <li>
                    <button
                      type="button"
                      className={`nav-item-btn ${activeNav === 'dashboard' ? 'active' : ''}`}
                      title="Dashboard"
                      onClick={() => {
                        setActiveNav('dashboard');
                        setMobileMenuOpen(false);
                      }}
                    >
                      <span className="nav-item-icon"><IconDashboard size={18} /></span>
                      {!sidebarCollapsed && <span>Dashboard</span>}
                    </button>
                  </li>

                  {/* EMPLOYEE: Can only submit and inspect receipts */}
                  {currentUser.role === 'EMPLOYEE' && (
                    <>
                      <li>
                        <button
                          type="button"
                          className={`nav-item-btn ${activeNav === 'upload' ? 'active' : ''}`}
                          title="Submit Expense"
                          onClick={() => {
                            setActiveNav('upload');
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-icon"><IconCamera size={18} /></span>
                          {!sidebarCollapsed && <span>Submit Expense</span>}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className={`nav-item-btn ${activeNav === 'receipt-detail' ? 'active' : ''}`}
                          title="Receipt OCR & Inspect"
                          onClick={() => {
                            setActiveNav('receipt-detail');
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-icon"><IconReceipt size={18} /></span>
                          {!sidebarCollapsed && <span>Receipt OCR &amp; Inspect</span>}
                        </button>
                      </li>
                    </>
                  )}

                  {/* MANAGER: Can submit receipts AND manage/review approvals */}
                  {currentUser.role === 'MANAGER' && (
                    <>
                      <li>
                        <button
                          type="button"
                          className={`nav-item-btn ${activeNav === 'upload' ? 'active' : ''}`}
                          title="Submit Expense"
                          onClick={() => {
                            setActiveNav('upload');
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-icon"><IconCamera size={18} /></span>
                          {!sidebarCollapsed && <span>Submit Expense</span>}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className={`nav-item-btn ${activeNav === 'receipt-detail' ? 'active' : ''}`}
                          title="Receipt OCR & Inspect"
                          onClick={() => {
                            setActiveNav('receipt-detail');
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-icon"><IconReceipt size={18} /></span>
                          {!sidebarCollapsed && <span>Receipt OCR &amp; Inspect</span>}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className={`nav-item-btn ${activeNav === 'approvals' ? 'active' : ''}`}
                          title="Manager Approvals"
                          onClick={() => {
                            setActiveNav('approvals');
                            setMobileMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-icon"><IconShield size={18} /></span>
                          {!sidebarCollapsed && <span>Manager Approvals</span>}
                          {pendingCount > 0 && <span className="nav-item-badge">{pendingCount}</span>}
                        </button>
                      </li>
                    </>
                  )}

                  {/* FINANCE: Reviews approved batches and accounting entries */}
                  {currentUser.role === 'FINANCE' && (
                    <li>
                      <button
                        type="button"
                        className={`nav-item-btn ${activeNav === 'finance' ? 'active' : ''}`}
                        title="Finance Operations"
                        onClick={() => {
                          setActiveNav('finance');
                          setMobileMenuOpen(false);
                        }}
                      >
                        <span className="nav-item-icon"><IconBuilding size={18} /></span>
                        {!sidebarCollapsed && <span>Finance Operations</span>}
                      </button>
                    </li>
                  )}
                </>
              ) : (
                <li>
                  <div className="nav-item-btn active" style={{ cursor: 'default', opacity: 0.85 }} title="Authentication">
                    <span className="nav-item-icon"><IconKey size={18} /></span>
                    {!sidebarCollapsed && <span>Authentication</span>}
                  </div>
                </li>
              )}
            </ul>
          </div>

          <div style={{ marginTop: 'auto' }}>
            {!sidebarCollapsed ? (
              <>
                <div className="nav-section-title">System &amp; Data Security</div>
                <div style={{ padding: '0 10px', fontSize: '0.75rem', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: backendHealth === 'online' ? '#10b981' : '#ef4444' }}></span>
                    <span>API Status: <strong>{backendHealth}</strong></span>
                  </div>
                  <div>Tenant Isolation: <strong>PostgreSQL RLS</strong></div>
                  <div>AI Layer: <strong>Assistive &amp; Validated</strong></div>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }} title={`API Status: ${backendHealth} (PostgreSQL RLS)`}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: backendHealth === 'online' ? '#10b981' : '#ef4444' }}></span>
              </div>
            )}
          </div>
        </nav>

        {/* User Profile Card in Sidebar Footer */}
        <div className="sidebar-footer">
          {currentUser ? (
            <div className="user-profile-card">
              <div
                className="user-avatar"
                title={sidebarCollapsed ? `${currentUser?.email} (${currentUser?.role}) - Click to Sign Out` : ''}
                style={{ cursor: sidebarCollapsed ? 'pointer' : 'default' }}
                onClick={sidebarCollapsed ? handleLogout : undefined}
              >
                {((currentUser?.email || currentUser?.role || 'US').slice(0, 2)).toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <>
                  <div className="user-meta">
                    <div className="user-name">{currentUser?.email || `${currentUser?.role || 'User'} (${(currentUser?.id || '').slice(0, 8)})`}</div>
                    <div className="user-role-badge">{currentUser?.role || 'EMPLOYEE'}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-signout"
                    onClick={handleLogout}
                    title="Sign Out"
                  >
                    <IconLogout size={16} />
                  </button>
                </>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
              {!sidebarCollapsed ? 'Not Signed In' : <IconLock size={14} />}
            </div>
          )}
        </div>
      </aside>


      {/* Main Content Workspace */}
      <div className="main-workspace">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle Navigation"
            >
              <IconMenu size={20} />
            </button>
            <div className="search-box">
              <span className="search-icon"><IconSearch size={16} /></span>
              <input
                type="text"
                className="search-input"
                placeholder={currentUser ? "Search transactions, GL codes, receipts..." : "Sign in to search transactions..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={!currentUser}
              />
            </div>
          </div>

          <div className="topbar-right">
            <div className="live-sync-pill">
              <span className="live-pulse"></span>
              <span>PostgreSQL RLS Active</span>
            </div>

            {currentUser && (currentUser.role === 'EMPLOYEE' || currentUser.role === 'MANAGER') && (
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => setActiveNav('upload')}
              >
                + Submit Expense
              </button>
            )}

            {/* Role indicator or switcher for reviewers */}
            {currentUser && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="status-pill draft" style={{ fontSize: '0.75rem' }}>
                  {currentUser.role}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Workspace Body */}
        <main className="workspace-scroll">
          {/* Sign In Screen if unauthenticated */}
          {!currentUser ? (
            <div style={{ maxWidth: '480px', margin: '40px auto', width: '100%' }}>
              <div className="table-card" style={{ padding: '32px' }}>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <div className="brand-badge" style={{ margin: '0 auto 12px auto', width: '48px', height: '48px', fontSize: '1.5rem' }}>
                    E
                  </div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Sign in to ExpenseEase
                  </h2>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Smart Employee Expense Management Platform
                  </p>
                </div>

                {loginError && (
                  <div className="alert alert-danger" style={{ marginBottom: '16px' }}>
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group">
                    <label className="form-label">Tenant Slug</label>
                    <input
                      type="text"
                      className="form-input"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      placeholder="e.g. demo"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unique Login ID or Email</label>
                    <input
                      type="text"
                      className="form-input"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="Enter unique login ID or email"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-gold btn-lg"
                    disabled={loginLoading}
                    style={{ marginTop: '8px', width: '100%' }}
                  >
                    {loginLoading ? 'Signing In...' : 'Sign In to Workspace'}
                  </button>
                </form>

                {/* Subtle account hints for evaluation (No separate role login buttons) */}
                {IS_DEMO_MODE && (
                  <div style={{ marginTop: '20px', padding: '12px 14px', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
                      <IconInfo size={14} style={{ marginRight: 6, color: 'var(--gold-hover)' }} /> Available Accounts in Demo Tenant:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontFamily: 'monospace' }}>
                      <div>&bull; Employee: <strong>employee@expenseease.local</strong> (pwd: employee123)</div>
                      <div>&bull; Manager: <strong>manager@expenseease.local</strong> (pwd: manager123)</div>
                      <div>&bull; Finance: <strong>finance@expenseease.local</strong> (pwd: finance123)</div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                      Roles and permissions are bound to individual unique login IDs in the database.
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ErrorBoundary onReset={() => setActiveNav('dashboard')}>
              {/* VIEW 1: DASHBOARD (Stitch Screen 1: Employee Receipt Submission) */}
              {activeNav === 'dashboard' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* Summary Metric Cards */}
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Total Submitted</span>
                        <span className="stat-icon"><IconFileText size={20} /></span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{totalSubmittedCount} claims</div>
                        <span className="stat-subtext status-pill approved">In System</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Pending Approval</span>
                        <span className="stat-icon"><IconClock size={20} /></span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{pendingCount} claims</div>
                        <span className="stat-subtext status-pill pending">Awaiting Review</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Approved &amp; Settled</span>
                        <span className="stat-icon"><IconCheckCircle size={20} /></span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{approvedCount} claims</div>
                        <span className="stat-subtext status-pill approved">Cleared</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Tenant Organization</span>
                        <span className="stat-icon"><IconBuilding size={20} /></span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>{slug}</div>
                        <span className="stat-subtext status-pill policy-pass">RLS Enforced</span>
                      </div>
                    </div>
                  </div>

                  {/* Role-Specific Action Cards */}
                  <div className="action-cards-grid">
                    {currentUser.role === 'EMPLOYEE' && (
                      <>
                        <div className="action-card" onClick={() => setActiveNav('upload')}>
                          <div className="action-card-icon"><IconUpload size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Upload Receipt Image</h4>
                            <p className="action-card-desc">
                              Select JPEG, PNG, or WebP receipts. Automatic OCR and AI field extraction runs upon upload.
                            </p>
                          </div>
                          <button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 'auto' }}>
                            Browse &amp; Upload
                          </button>
                        </div>

                        <div className="action-card" onClick={() => setActiveNav('upload')}>
                          <div className="action-card-icon"><IconCamera size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Snap with Camera</h4>
                            <p className="action-card-desc">
                              Trigger mobile or web camera capture with auto-edge alignment and OCR text extraction.
                            </p>
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }}>
                            Open Camera
                          </button>
                        </div>

                        <div className="action-card" onClick={() => setActiveNav('receipt-detail')}>
                          <div className="action-card-icon"><IconSearch size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Check Submission Status</h4>
                            <p className="action-card-desc">
                              Inspect AI extraction confidence, deterministic policy validation results, and manager feedback.
                            </p>
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }}>
                            Track Claims
                          </button>
                        </div>
                      </>
                    )}

                    {currentUser.role === 'MANAGER' && (
                      <>
                        <div className="action-card" onClick={() => setActiveNav('upload')}>
                          <div className="action-card-icon"><IconUpload size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Submit Personal Expense</h4>
                            <p className="action-card-desc">
                              Upload receipt image or snap with camera to submit your own claims for peer approval.
                            </p>
                          </div>
                          <button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 'auto' }}>
                            Submit Expense &rarr;
                          </button>
                        </div>

                        <div className="action-card" onClick={() => setActiveNav('approvals')}>
                          <div className="action-card-icon"><IconShield size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Manager Approvals Queue</h4>
                            <p className="action-card-desc">
                              Review pending claims ({pendingCount} awaiting review), verify policy compliance, and sign off decisions.
                            </p>
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }}>
                            Open Approvals Queue &rarr;
                          </button>
                        </div>

                        <div className="action-card" onClick={() => setActiveNav('approvals')}>
                          <div className="action-card-icon"><IconClipboard size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Policy &amp; Audit Review</h4>
                            <p className="action-card-desc">
                              Inspect deterministic policy checks, duplicate similarity scores, and review workflow audit trails.
                            </p>
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }}>
                            Inspect Compliance
                          </button>
                        </div>
                      </>
                    )}

                    {currentUser.role === 'FINANCE' && (
                      <>
                        <div className="action-card" onClick={() => setActiveNav('finance')}>
                          <div className="action-card-icon"><IconBuilding size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Finance Batches</h4>
                            <p className="action-card-desc">
                              Group manager-approved expenses into auditable Finance Batches for accounting review.
                            </p>
                          </div>
                          <button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 'auto' }}>
                            Manage Batches &rarr;
                          </button>
                        </div>

                        <div className="action-card" onClick={() => setActiveNav('finance')}>
                          <div className="action-card-icon"><IconScale size={22} /></div>
                          <div>
                            <h4 className="action-card-title">Journal Entries &amp; Export</h4>
                            <p className="action-card-desc">
                              Generate balanced GL records, export accounting CSVs, and inspect QuickBooks/Xero payloads.
                            </p>
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'auto' }}>
                            Accounting Ledger
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Recent Submissions Ledger Table */}
                  <div className="table-card">
                    {/* For Managers: Tab Switcher between Pending Submitted Approvals and Personal Upload History */}
                    {currentUser.role === 'MANAGER' && (
                      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', padding: '0 16px', background: '#f8fafc' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            border: 'none',
                            borderRadius: 0,
                            padding: '10px 14px',
                            fontWeight: 600,
                            background: 'none',
                            borderBottom: managerLedgerTab === 'PENDING_APPROVALS' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                            color: managerLedgerTab === 'PENDING_APPROVALS' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          onClick={() => { setManagerLedgerTab('PENDING_APPROVALS'); setLedgerPage(1); }}
                        >
                          <IconClock size={15} /> Pending Approvals ({receiptsList.length})
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            border: 'none',
                            borderRadius: 0,
                            padding: '10px 14px',
                            fontWeight: 600,
                            background: 'none',
                            borderBottom: managerLedgerTab === 'PERSONAL' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                            color: managerLedgerTab === 'PERSONAL' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                          onClick={() => { setManagerLedgerTab('PERSONAL'); setLedgerPage(1); }}
                        >
                          <IconUpload size={15} /> My Upload History ({personalReceiptsList.length})
                        </button>
                      </div>
                    )}

                    <div className="table-header-bar">
                      <div>
                        <span className="table-title">
                          {currentUser.role === 'EMPLOYEE'
                            ? 'My Upload History'
                            : (managerLedgerTab === 'PERSONAL' ? 'My Upload History' : 'Pending Approvals Queue')}
                        </span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {currentUser.role === 'EMPLOYEE'
                            ? 'Your personal expense vouchers and drafts'
                            : (managerLedgerTab === 'PERSONAL'
                                ? 'Receipt vouchers & drafts uploaded by your unique login ID'
                                : 'Pending submitted expense claims awaiting manager sign-off')}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => fetchReceipts(authToken)}
                        disabled={loadingReceipts}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <IconRefresh size={14} className={loadingReceipts ? 'spin' : ''} />
                        {loadingReceipts ? 'Refreshing...' : 'Refresh Ledger'}
                      </button>
                    </div>

                    {filteredReceipts.length === 0 ? (
                      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {currentUser.role === 'EMPLOYEE'
                          ? 'No expense receipts found in your upload history. Click "Submit Expense" to upload your first receipt.'
                          : (managerLedgerTab === 'PERSONAL'
                              ? 'You have not uploaded any personal receipts or drafts yet.'
                              : 'No claims currently pending manager approval.')}
                      </div>
                    ) : (
                      <>
                        <div className="data-table-wrapper">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Receipt / Voucher</th>
                                <th>Format / Size</th>
                                <th>OCR Status</th>
                                <th>Workflow State</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedLedgerReceipts.map((r) => {
                                const st = r.workflow_state || r.workflowState || 'DRAFT';
                                return (
                                  <tr key={r.id}>
                                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                      {new Date(r.created_at || r.createdAt).toLocaleDateString()}
                                    </td>
                                    <td style={{ fontWeight: 600 }}>
                                      {r.merchantName || r.original_filename || r.originalFilename || 'Receipt Image'}
                                    </td>
                                    <td>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {r.mime_type || r.mimeType || 'image'} &bull; {((r.file_size_bytes || r.fileSizeBytes || 0) / 1024).toFixed(1)} KB
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`status-pill ${r.ocr_status === 'COMPLETED' ? 'policy-pass' : 'draft'}`}>
                                        <span className="status-dot"></span>
                                        <span>{r.ocr_status || r.ocrStatus}</span>
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`status-pill ${
                                        st === 'APPROVED'
                                          ? 'approved'
                                          : st === 'PENDING_APPROVAL'
                                          ? 'pending'
                                          : st === 'CORRECTION_REQUESTED'
                                          ? 'correction'
                                          : st === 'REJECTED'
                                          ? 'rejected'
                                          : 'draft'
                                      }`}>
                                        <span className="status-dot"></span>
                                        <span>{st.replace('_', ' ')}</span>
                                      </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        onClick={() => {
                                          setLatestReceipt(r);
                                          if (currentUser.role === 'MANAGER' && managerLedgerTab === 'PENDING_APPROVALS') {
                                            setActiveNav('approvals');
                                          } else if (currentUser.role === 'FINANCE') {
                                            setActiveNav('finance');
                                          } else {
                                            setActiveNav('receipt-detail');
                                          }
                                        }}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <IconEye size={13} />
                                        <span>Inspect &rarr;</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Ledger Pagination Bar */}
                        <div
                          style={{
                            padding: '12px 18px',
                            borderTop: '1px solid var(--border-subtle)',
                            background: '#f8fafc',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <span>
                            Showing {(safeLedgerPage - 1) * ledgerPageSize + 1} to {Math.min(safeLedgerPage * ledgerPageSize, totalLedger)} of {totalLedger} entries
                          </span>

                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select
                              value={ledgerPageSize}
                              onChange={(e) => {
                                setLedgerPageSize(Number(e.target.value));
                                setLedgerPage(1);
                              }}
                              style={{
                                padding: '3px 8px',
                                fontSize: '0.75rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-subtle)',
                                background: '#ffffff',
                              }}
                            >
                              <option value={5}>5 per page</option>
                              <option value={10}>10 per page</option>
                              <option value={25}>25 per page</option>
                            </select>

                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              disabled={safeLedgerPage <= 1}
                              onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                            >
                              <IconChevronLeft size={11} /> Prev
                            </button>
                            <span>
                              Page {safeLedgerPage} of {totalLedgerPages}
                            </span>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              disabled={safeLedgerPage >= totalLedgerPages}
                              onClick={() => setLedgerPage((p) => Math.min(totalLedgerPages, p + 1))}
                            >
                              Next <IconChevronRight size={11} />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW 2: UPLOAD RECEIPT */}
              {activeNav === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <ReceiptCapture
                    authToken={authToken}
                    autoStartCamera={autoStartCamera}
                    onReceiptUploaded={(uploadedReceipt) => {
                      setAutoStartCamera(false);
                      setLatestReceipt(uploadedReceipt);
                      fetchReceipts(authToken);
                      setActiveNav('receipt-detail');
                    }}
                  />
                </div>
              )}

              {/* VIEW 3: RECEIPT OCR & SPLIT INSPECTOR (Stitch Screen 2) */}
              {activeNav === 'receipt-detail' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {userInspectList.length > 0 && (
                    <div className="table-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          Select Active Voucher:
                        </span>
                        <select
                          className="form-select"
                          style={{ width: 'auto', minWidth: '280px' }}
                          value={latestReceipt?.id || ''}
                          onChange={(e) => {
                            const found = userInspectList.find((r) => r.id === e.target.value);
                            if (found) setLatestReceipt(found);
                          }}
                        >
                          {userInspectList.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.original_filename || r.originalFilename || 'Receipt'} &bull; ID: {(r.id || '').slice(0, 8)}... ({r.workflow_state || r.workflowState || 'DRAFT'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          id="btn-select-retake-camera"
                          onClick={() => {
                            setAutoStartCamera(true);
                            setActiveNav('upload');
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <IconCamera size={14} /> Retake Picture
                        </button>
                        <button
                          type="button"
                          className="btn btn-gold btn-sm"
                          id="btn-select-add-receipt"
                          onClick={() => {
                            setAutoStartCamera(false);
                            setActiveNav('upload');
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <IconPlus size={14} /> Add More Receipts
                        </button>
                      </div>
                    </div>
                  )}

                  {latestReceipt ? (
                    <ReceiptView
                      receipt={latestReceipt}
                      authToken={authToken}
                      currentUser={currentUser}
                      onWorkflowUpdated={() => fetchReceipts(authToken)}
                      onRetakePicture={() => {
                        setAutoStartCamera(true);
                        setActiveNav('upload');
                      }}
                      onAddMoreReceipts={() => {
                        setAutoStartCamera(false);
                        setActiveNav('upload');
                      }}
                      onReceiptDeleted={(deletedId) => {
                        const remaining = receiptsList.filter((r) => r.id !== deletedId);
                        setReceiptsList(remaining);
                        const personalRem = personalReceiptsList.filter((r) => r.id !== deletedId);
                        setPersonalReceiptsList(personalRem);
                        setLatestReceipt(personalRem.length > 0 ? personalRem[0] : (remaining.length > 0 ? remaining[0] : null));
                        fetchReceipts(authToken);
                      }}
                    />
                  ) : (
                    <div className="table-card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No receipt selected. Upload or choose a receipt from the ledger.
                    </div>
                  )}
                </div>
              )}

              {/* VIEW 4: MANAGER APPROVALS (Stitch Screen 3) */}
              {activeNav === 'approvals' && (
                <ManagerApprovalsView
                  authToken={authToken}
                  currentUser={currentUser}
                  onSelectReceipt={(r) => setLatestReceipt(r)}
                />
              )}

              {/* VIEW 5: FINANCE OPERATIONS (Stitch Screen 4) */}
              {activeNav === 'finance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <FinanceBatchView
                    authToken={authToken}
                    currentUser={currentUser}
                  />

                  <div style={{ marginTop: '12px' }}>
                    <JournalEntryView
                      authToken={authToken}
                      currentUser={currentUser}
                    />
                  </div>
                </div>
              )}
            </ErrorBoundary>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
