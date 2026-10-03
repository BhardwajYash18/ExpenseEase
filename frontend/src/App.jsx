import React, { useState, useEffect } from 'react';
import ReceiptCapture from './components/ReceiptCapture';
import ReceiptView from './components/ReceiptView';
import FinanceBatchView from './components/FinanceBatchView';
import JournalEntryView from './components/JournalEntryView';

function App() {
  const [backendHealth, setBackendHealth] = useState('checking');
  const [readinessData, setReadinessData] = useState(null);
  const [authToken, setAuthToken] = useState(localStorage.getItem('token') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [latestReceipt, setLatestReceipt] = useState(null);
  const [receiptsList, setReceiptsList] = useState([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [financeView, setFinanceView] = useState('batches'); // 'batches' or 'accounting'


  // Form states for login testing
  const [email, setEmail] = useState('employee@acme.test');
  const [password, setPassword] = useState('password123');
  const [slug, setSlug] = useState('acme-corp');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

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

  useEffect(() => {
    // Check backend health endpoint
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
      .then((data) => setBackendHealth(data.status === 'ok' ? 'online' : 'unexpected_response'))
      .catch(() => setBackendHealth('offline'));

    // Check backend readiness endpoint
    fetch('/api/health/ready')
      .then((res) => res.json())
      .then((data) => setReadinessData(data))
      .catch(() => setReadinessData(null));

    // If token exists, fetch /api/auth/me
    if (authToken) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => (res.ok ? res.json() : Promise.reject('Invalid token')))
        .then((data) => {
          setCurrentUser(data.user);
          fetchReceipts(authToken);
        })
        .catch(() => {
          setAuthToken('');
          setCurrentUser(null);
          localStorage.removeItem('token');
        });
    }
  }, [authToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }
      setAuthToken(data.token);
      setCurrentUser(data.user);
      localStorage.setItem('token', data.token);
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
    setLatestReceipt(null);
  };

  return (
    <div className="container">
      <header className="header">
        <h1 className="header-title">ExpensEase</h1>
        <p className="header-subtitle">Smart Employee Expense Management Platform</p>
      </header>

      {/* Checkpoint Status Banner */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="status-badge ok">
          <span className="status-indicator"></span>
          <span>Checkpoint 9 — CSV Export + QuickBooks/Xero Integration Points</span>
        </div>

        <ul className="info-list">
          <li className="info-item">
            <span className="info-label">Backend API Status</span>
            <span className="info-value">{backendHealth}</span>
          </li>
          <li className="info-item">
            <span className="info-label">AI & OCR Service</span>
            <span className="info-value">{readinessData?.dependencies?.aiService?.status || 'Active (FastAPI + AI)'}</span>
          </li>
          <li className="info-item">
            <span className="info-label">Active User Context</span>
            <span className="info-value">
              {currentUser ? `${currentUser.email} (${currentUser.role})` : 'Unauthenticated'}
            </span>
          </li>
        </ul>
      </div>

      {/* Authentication / Role Login Card */}
      {!currentUser ? (
        <div className="card" style={{ marginBottom: '20px' }}>
          <h3 className="section-title">Sign In to ExpensEase</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Sign in as <strong>EMPLOYEE</strong>, <strong>MANAGER</strong>, or <strong>FINANCE</strong>.
          </p>

          {loginError && <div className="alert alert-danger" style={{ marginBottom: '14px' }}>{loginError}</div>}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Tenant Slug</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: '#fff' }}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loginLoading} style={{ marginTop: '8px' }}>
              {loginLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Signed in as:</strong> {currentUser.firstName} {currentUser.lastName} ({currentUser.email})
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Role: {currentUser.role}</div>
          </div>
          <button type="button" className="btn btn-outline" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      )}

      {/* Finance Operations Workspace (FINANCE role per AGENTS.md Section 13/14/15) */}
      {currentUser && currentUser.role === 'FINANCE' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              className={`btn ${financeView === 'batches' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFinanceView('batches')}
              style={{ flex: 1, padding: '10px 16px', fontSize: '0.9rem' }}
            >
              Finance Batches (Checkpoint 7)
            </button>
            <button
              type="button"
              className={`btn ${financeView === 'accounting' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFinanceView('accounting')}
              style={{ flex: 1, padding: '10px 16px', fontSize: '0.9rem' }}
            >
              Journal Entries &amp; Integrations (CP8 &amp; CP9)
            </button>
          </div>

          {financeView === 'batches' ? (
            <FinanceBatchView authToken={authToken} currentUser={currentUser} />
          ) : (
            <JournalEntryView authToken={authToken} currentUser={currentUser} />
          )}
        </div>
      )}

      {/* Receipt Capture Component (EMPLOYEE only per AGENTS.md RBAC) */}
      {currentUser && currentUser.role === 'EMPLOYEE' && (
        <ReceiptCapture
          authToken={authToken}
          onReceiptUploaded={(receipt) => {
            setLatestReceipt(receipt);
            fetchReceipts(authToken);
          }}
        />
      )}

      {currentUser && currentUser.role !== 'EMPLOYEE' && (
        <div className="alert alert-info" style={{ marginBottom: '20px' }}>
          Role Notice: Signed in as <strong>{currentUser.role}</strong>. Per ExpensEase RBAC (AGENTS.md Section 13), receipt uploading is restricted to <strong>EMPLOYEE</strong> accounts. Managers and Finance reviewers can inspect existing receipts and perform approval/batching actions below.
        </div>
      )}

      {/* Receipts Selector / Browser */}
      {currentUser && receiptsList.length > 0 && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              Select Expense Receipt to Review ({receiptsList.length} available):
            </label>
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={() => fetchReceipts(authToken)}
              disabled={loadingReceipts}
            >
              {loadingReceipts ? 'Refreshing...' : 'Refresh List'}
            </button>
          </div>
          <select
            value={latestReceipt?.id || ''}
            onChange={(e) => {
              const selected = receiptsList.find((r) => r.id === e.target.value);
              if (selected) setLatestReceipt(selected);
            }}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              background: '#0f172a',
              color: '#fff',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
            }}
          >
            {receiptsList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.original_filename || r.originalFilename || 'Receipt'} &bull; Uploaded: {new Date(r.created_at || r.createdAt).toLocaleDateString()} &bull; ID: {r.id.slice(0, 8)}...
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Receipt View Component */}
      {latestReceipt && (
        <ReceiptView receipt={latestReceipt} authToken={authToken} currentUser={currentUser} />
      )}

      <footer className="footer">
        ExpensEase &bull; Responsive Progressive Web Application &bull; Checkpoint 8 (Journal Entries / Deterministic Accounting)
      </footer>
    </div>
  );
}

export default App;
