import React, { useState, useEffect } from 'react';
import ReceiptCapture from './components/ReceiptCapture';
import ReceiptView from './components/ReceiptView';
import ManagerApprovalsView from './components/ManagerApprovalsView';
import FinanceBatchView from './components/FinanceBatchView';
import JournalEntryView from './components/JournalEntryView';
import { IS_DEMO_MODE, DEMO_ACCOUNTS } from './config/demoConfig';

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
  const [loadingReceipts, setLoadingReceipts] = useState(false);

  // Active navigation view: 'dashboard' | 'upload' | 'receipt-detail' | 'approvals' | 'finance' | 'mappings' | 'integrations'
  const [activeNav, setActiveNav] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Login form states (isolated to demo configuration in development mode)
  const [email, setEmail] = useState(IS_DEMO_MODE ? DEMO_ACCOUNTS.EMPLOYEE.email : '');
  const [password, setPassword] = useState(IS_DEMO_MODE ? DEMO_ACCOUNTS.EMPLOYEE.password : '');
  const [slug, setSlug] = useState(IS_DEMO_MODE ? DEMO_ACCOUNTS.EMPLOYEE.slug : '');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Fetch receipts for authenticated user / tenant
  async function fetchReceipts(token) {
    if (!token) return;
    setLoadingReceipts(true);
    try {
      const res = await fetch('/api/receipts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.receipts || [];
        setReceiptsList(list);
        if (list.length > 0 && !latestReceipt) {
          setLatestReceipt(list[0]);
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

    const creds = customCreds || { email, password, slug };

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

      // Default landing view based on role
      if (data.user.role === 'MANAGER') {
        setActiveNav('approvals');
      } else if (data.user.role === 'FINANCE') {
        setActiveNav('finance');
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

  // Helper quick login for reviewers / testers using isolated demo accounts
  const handleQuickLogin = (roleType) => {
    if (!IS_DEMO_MODE || !DEMO_ACCOUNTS[roleType]) return;
    const { email: emailToUse, password: pwdToUse, slug: slugToUse } = DEMO_ACCOUNTS[roleType];
    setEmail(emailToUse);
    setPassword(pwdToUse);
    setSlug(slugToUse);
    handleLogin(null, { email: emailToUse, password: pwdToUse, slug: slugToUse });
  };

  // Calculate real dashboard statistics from receiptsList
  const totalSubmittedCount = receiptsList.length;
  const pendingCount = receiptsList.filter((r) => (r.workflow_state || r.workflowState) === 'PENDING_APPROVAL').length;
  const approvedCount = receiptsList.filter((r) => (r.workflow_state || r.workflowState) === 'APPROVED').length;

  const filteredReceipts = receiptsList.filter((r) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const name = (r.original_filename || r.originalFilename || '').toLowerCase();
    const id = (r.id || '').toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  return (
    <div className="app-shell">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)}></div>
      )}

      {/* Dark Sidebar (Stitch Design Spec) */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-badge">E</div>
          <div className="brand-title">
            <span className="brand-name">ExpensEase</span>
            <span className="brand-tagline">SMB PLATFORM</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div>
            <div className="nav-section-title">Operations &amp; Finance</div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'dashboard' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveNav('dashboard');
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="nav-item-icon">📊</span>
                  <span>Dashboard</span>
                </button>
              </li>

              {currentUser && currentUser.role === 'EMPLOYEE' && (
                <li>
                  <button
                    type="button"
                    className={`nav-item-btn ${activeNav === 'upload' ? 'active' : ''}`}
                    onClick={() => {
                      setActiveNav('upload');
                      setMobileMenuOpen(false);
                    }}
                  >
                    <span className="nav-item-icon">📸</span>
                    <span>Submit Expense</span>
                  </button>
                </li>
              )}

              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${activeNav === 'receipt-detail' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveNav('receipt-detail');
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="nav-item-icon">🧾</span>
                  <span>Receipt OCR &amp; Inspect</span>
                </button>
              </li>

              {currentUser && (currentUser.role === 'MANAGER' || currentUser.role === 'FINANCE') && (
                <li>
                  <button
                    type="button"
                    className={`nav-item-btn ${activeNav === 'approvals' ? 'active' : ''}`}
                    onClick={() => {
                      setActiveNav('approvals');
                      setMobileMenuOpen(false);
                    }}
                  >
                    <span className="nav-item-icon">🛡️</span>
                    <span>Manager Approvals</span>
                    {pendingCount > 0 && <span className="nav-item-badge">{pendingCount}</span>}
                  </button>
                </li>
              )}

              {currentUser && currentUser.role === 'FINANCE' && (
                <>
                  <li>
                    <button
                      type="button"
                      className={`nav-item-btn ${activeNav === 'finance' ? 'active' : ''}`}
                      onClick={() => {
                        setActiveNav('finance');
                        setMobileMenuOpen(false);
                      }}
                    >
                      <span className="nav-item-icon">🏛️</span>
                      <span>Finance Operations</span>
                    </button>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div style={{ marginTop: 'auto' }}>
            <div className="nav-section-title">System &amp; Data Security</div>
            <div style={{ padding: '0 10px', fontSize: '0.75rem', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: backendHealth === 'online' ? '#10b981' : '#ef4444' }}></span>
                <span>API Status: <strong>{backendHealth}</strong></span>
              </div>
              <div>Tenant Isolation: <strong>PostgreSQL RLS</strong></div>
              <div>AI Layer: <strong>Assistive &amp; Validated</strong></div>
            </div>
          </div>
        </nav>

        {/* User Profile Card in Sidebar Footer */}
        <div className="sidebar-footer">
          {currentUser ? (
            <div className="user-profile-card">
              <div className="user-avatar">
                {((currentUser?.email || currentUser?.role || 'US').slice(0, 2)).toUpperCase()}
              </div>
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
                🚪
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
              Not Signed In
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
              ☰
            </button>
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="Search transactions, GL codes, receipts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="topbar-right">
            <div className="live-sync-pill">
              <span className="live-pulse"></span>
              <span>PostgreSQL RLS Active</span>
            </div>

            {currentUser && currentUser.role === 'EMPLOYEE' && (
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
                    Sign in to ExpensEase
                  </h2>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Smart Employee Expense Management Platform
                  </p>
                </div>

                {/* Quick Role Fill Presets for Review / Evaluation (Isolated to Development Mode) */}
                {IS_DEMO_MODE && (
                  <div style={{ marginBottom: '20px', padding: '12px', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      1-Click Demo Evaluation Presets (Dev Only):
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleQuickLogin('EMPLOYEE')}
                        disabled={loginLoading}
                      >
                        Employee
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleQuickLogin('MANAGER')}
                        disabled={loginLoading}
                      >
                        Manager
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleQuickLogin('FINANCE')}
                        disabled={loginLoading}
                      >
                        Finance
                      </button>
                    </div>
                  </div>
                )}

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
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
              </div>
            </div>
          ) : (
            <>
              {/* VIEW 1: DASHBOARD (Stitch Screen 1: Employee Receipt Submission) */}
              {activeNav === 'dashboard' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* Summary Metric Cards */}
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Total Submitted</span>
                        <span className="stat-icon">📄</span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{totalSubmittedCount} claims</div>
                        <span className="stat-subtext status-pill approved">In System</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Pending Approval</span>
                        <span className="stat-icon">⏳</span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{pendingCount} claims</div>
                        <span className="stat-subtext status-pill pending">Awaiting Review</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Approved &amp; Settled</span>
                        <span className="stat-icon">✅</span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value">{approvedCount} claims</div>
                        <span className="stat-subtext status-pill approved">Cleared</span>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-header">
                        <span className="stat-title">Tenant Organization</span>
                        <span className="stat-icon">🏢</span>
                      </div>
                      <div className="stat-body">
                        <div className="stat-value" style={{ fontSize: '1.25rem' }}>{slug}</div>
                        <span className="stat-subtext status-pill policy-pass">RLS Enforced</span>
                      </div>
                    </div>
                  </div>

                  {/* Ingestion Action Cards (Stitch Screen 1 Middle Row) */}
                  <div className="action-cards-grid">
                    <div className="action-card" onClick={() => setActiveNav('upload')}>
                      <div className="action-card-icon">📤</div>
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
                      <div className="action-card-icon">📷</div>
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
                      <div className="action-card-icon">🔍</div>
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
                  </div>

                  {/* Recent Submissions Ledger Table */}
                  <div className="table-card">
                    <div className="table-header-bar">
                      <span className="table-title">Recent Submissions Ledger</span>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => fetchReceipts(authToken)}
                        disabled={loadingReceipts}
                      >
                        {loadingReceipts ? 'Refreshing...' : '🔄 Refresh Ledger'}
                      </button>
                    </div>

                    {filteredReceipts.length === 0 ? (
                      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No expense receipts found. Click <strong>"Submit Expense"</strong> to upload your first receipt.
                      </div>
                    ) : (
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
                            {filteredReceipts.map((r) => {
                              const st = r.workflow_state || r.workflowState || 'DRAFT';
                              return (
                                <tr key={r.id}>
                                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {new Date(r.created_at || r.createdAt).toLocaleDateString()}
                                  </td>
                                  <td style={{ fontWeight: 600 }}>
                                    {r.original_filename || r.originalFilename || 'Receipt Image'}
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
                                    <span className={`status-pill ${st === 'APPROVED' ? 'approved' : st === 'PENDING_APPROVAL' ? 'pending' : st === 'REJECTED' ? 'rejected' : 'draft'}`}>
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
                                        setActiveNav('receipt-detail');
                                      }}
                                    >
                                      Inspect &rarr;
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* VIEW 2: UPLOAD RECEIPT */}
              {activeNav === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <ReceiptCapture
                    authToken={authToken}
                    onReceiptUploaded={(uploadedReceipt) => {
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
                  {receiptsList.length > 0 && (
                    <div className="table-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Select Active Voucher:
                      </span>
                      <select
                        className="form-select"
                        style={{ width: 'auto', minWidth: '280px' }}
                        value={latestReceipt?.id || ''}
                        onChange={(e) => {
                          const found = receiptsList.find((r) => r.id === e.target.value);
                          if (found) setLatestReceipt(found);
                        }}
                      >
                        {receiptsList.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.original_filename || r.originalFilename || 'Receipt'} &bull; ID: {(r.id || '').slice(0, 8)}... ({r.workflow_state || r.workflowState || 'DRAFT'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {latestReceipt ? (
                    <ReceiptView
                      receipt={latestReceipt}
                      authToken={authToken}
                      currentUser={currentUser}
                      onWorkflowUpdated={() => fetchReceipts(authToken)}
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
