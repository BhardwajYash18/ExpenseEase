import React, { useState, useEffect } from 'react';

function App() {
  const [backendHealth, setBackendHealth] = useState('checking');
  const [readinessData, setReadinessData] = useState(null);

  useEffect(() => {
    // Check backend health endpoint
    fetch('/api/health')
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        throw new Error(`HTTP ${res.status}`);
      })
      .then((data) => {
        setBackendHealth(data.status === 'ok' ? 'online' : 'unexpected_response');
      })
      .catch(() => {
        setBackendHealth('offline');
      });

    // Check backend readiness endpoint
    fetch('/api/health/ready')
      .then((res) => res.json())
      .then((data) => {
        setReadinessData(data);
      })
      .catch(() => {
        setReadinessData(null);
      });
  }, []);

  return (
    <div className="container">
      <header className="header">
        <h1 className="header-title">ExpensEase</h1>
        <p className="header-subtitle">Smart Employee Expense Management Platform</p>
      </header>

      <main className="card">
        <div className="status-badge ok">
          <span className="status-indicator"></span>
          <span>Checkpoint 0 — Technical Foundation</span>
        </div>

        <h2 className="section-title">Foundation Service Status</h2>
        <ul className="info-list">
          <li className="info-item">
            <span className="info-label">PWA Frontend</span>
            <span className="info-value">Active (Responsive Shell)</span>
          </li>
          <li className="info-item">
            <span className="info-label">Backend API Liveness (/api/health)</span>
            <span className="info-value">{backendHealth}</span>
          </li>
          <li className="info-item">
            <span className="info-label">PostgreSQL Database</span>
            <span className="info-value">
              {readinessData?.dependencies?.database?.status || 'awaiting verification'}
            </span>
          </li>
          <li className="info-item">
            <span className="info-label">AI Service (/health)</span>
            <span className="info-value">
              {readinessData?.dependencies?.aiService?.status || 'awaiting verification'}
            </span>
          </li>
        </ul>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          This environment is running Checkpoint 0 foundational architecture.
          No business workflows, schemas, or models have been loaded yet.
        </p>
      </main>

      <footer className="footer">
        ExpensEase &bull; Responsive Progressive Web Application &bull; Checkpoint 0
      </footer>
    </div>
  );
}

export default App;
