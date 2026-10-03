import React, { useState, useEffect } from 'react';

/**
 * JournalEntryView
 *
 * Dedicated UI for FINANCE role to manage Journal Entries, deterministic
 * double-entry accounting, CSV export, and QuickBooks/Xero integration points
 * per AGENTS.md Sections 13, 14, 15, 17, 18, 28 and docs/PRD.md FR-10, FR-11, FR-12.
 */
function JournalEntryView({ authToken, currentUser }) {
  const [entries, setEntries] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [providers, setProviders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'detail', 'mappings', 'integrations'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Finalize state
  const [finalizing, setFinalizing] = useState(false);

  // Mapping form state
  const [mappingCategory, setMappingCategory] = useState('');
  const [mappingDebitAccount, setMappingDebitAccount] = useState('');
  const [mappingCreditAccount, setMappingCreditAccount] = useState('2000 - Accounts Payable');
  const [savingMapping, setSavingMapping] = useState(false);

  // Integration modal state
  const [integrationModal, setIntegrationModal] = useState(null); // { provider: 'QuickBooks' | 'Xero', payload: ..., entryId: ... }
  const [executingIntegration, setExecutingIntegration] = useState(false);

  // Fetch journal entries
  async function fetchEntries() {
    if (!authToken) return;
    try {
      const res = await fetch('/api/journal-entries', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.journalEntries || []);
      }
    } catch (err) {
      // quiet fail
    }
  }

  // Fetch account mappings
  async function fetchMappings() {
    if (!authToken) return;
    try {
      const res = await fetch('/api/account-mappings', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMappings(data.mappings || []);
      }
    } catch (err) {
      // quiet fail
    }
  }

  // Fetch integration providers & audit logs
  async function fetchIntegrationsData() {
    if (!authToken) return;
    try {
      const [provRes, auditRes] = await Promise.all([
        fetch('/api/export/integrations', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch('/api/export/audit-logs', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      if (provRes.ok) {
        const pData = await provRes.json();
        setProviders(pData.providers || []);
      }
      if (auditRes.ok) {
        const aData = await auditRes.json();
        setAuditLogs(aData.auditLogs || []);
      }
    } catch (err) {
      // quiet fail
    }
  }

  // Fetch single journal entry detail
  async function fetchEntryDetail(entryId) {
    if (!authToken || !entryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/journal-entries/${entryId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedEntry(data.journalEntry);
        setActiveTab('detail');
      } else {
        const data = await res.json();
        setError(data.error?.message || 'Failed to load journal entry');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEntries();
    fetchMappings();
    fetchIntegrationsData();
  }, [authToken]);

  // Handle finalize journal entry
  async function handleFinalize(entryId) {
    if (!authToken || !entryId) return;
    setFinalizing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/journal-entries/${entryId}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to finalize journal entry');
      }

      setSuccessMsg('Journal entry successfully finalized. Double-entry balance validated.');
      setSelectedEntry(data.journalEntry);
      fetchEntries();
      fetchIntegrationsData();
    } catch (err) {
      setError(err.message);
    } finally {
      setFinalizing(false);
    }
  }

  // Handle CSV Download
  async function handleDownloadCsv(url, fallbackFilename) {
    if (!authToken) return;
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || `Export failed with HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = fallbackFilename;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccessMsg(`Successfully downloaded ${filename}`);
      fetchIntegrationsData();
    } catch (err) {
      setError(err.message);
    }
  }

  // Handle Accounting Integration Transformation
  async function handleExecuteIntegration(providerKey, entryId) {
    if (!authToken || !entryId) return;
    setExecutingIntegration(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/export/integrations/${providerKey}/${entryId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || `Failed to execute ${providerKey} integration`);
      }

      setIntegrationModal(data);
      fetchIntegrationsData();
    } catch (err) {
      setError(err.message);
    } finally {
      setExecutingIntegration(false);
    }
  }

  // Handle save account mapping
  async function handleSaveMapping(e) {
    e.preventDefault();
    if (!mappingCategory.trim() || !mappingDebitAccount.trim() || !mappingCreditAccount.trim()) {
      setError('All mapping fields are required.');
      return;
    }

    setSavingMapping(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/account-mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          category: mappingCategory.trim(),
          debitAccount: mappingDebitAccount.trim(),
          creditAccount: mappingCreditAccount.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save account mapping');
      }

      setSuccessMsg(`Account mapping saved for category '${data.mapping.category}'`);
      setMappingCategory('');
      setMappingDebitAccount('');
      fetchMappings();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMapping(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Tab Controls (Stitch Screen 4) */}
      <div className="table-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Finance Operations &bull; Double-Entry Ledger
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
            Deterministic GL accounts, balanced journal entries, and ERP integration points.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={() => {
              setActiveTab('list');
              fetchEntries();
            }}
          >
            Journal Entries ({entries.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'mappings' ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={() => {
              setActiveTab('mappings');
              fetchMappings();
            }}
          >
            GL Mappings ({mappings.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'integrations' ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={() => {
              setActiveTab('integrations');
              fetchIntegrationsData();
            }}
          >
            Export &amp; Integrations
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-danger">
          <strong>Error:</strong> {error}
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success">
          {successMsg}
        </div>
      )}

      {/* TAB 1: JOURNAL ENTRIES LIST */}
      {activeTab === 'list' && (
        <div className="table-card">
          <div className="table-header-bar">
            <div>
              <span className="table-title">General Ledger Journal Entries</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                Every entry is generated deterministically from a reviewed Finance Batch.
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => handleDownloadCsv('/api/export/csv', 'all-journal-entries.csv')}
              >
                &darr; Export All Finalized CSV
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={fetchEntries} disabled={loading}>
                🔄 Refresh
              </button>
            </div>
          </div>

          {entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              No journal entries created yet. Generate one from a <strong>REVIEWED</strong> Finance Batch.
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entry ID</th>
                    <th>Batch ID</th>
                    <th>Status</th>
                    <th>Total Debit</th>
                    <th>Total Credit</th>
                    <th>Balance Invariant</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{entry.id.slice(0, 13)}...</td>
                      <td style={{ fontFamily: 'monospace' }}>{entry.batchId.slice(0, 8)}...</td>
                      <td>
                        <span className={`status-pill ${entry.status === 'FINALIZED' ? 'approved' : 'pending'}`}>
                          <span className="status-dot"></span>
                          <span>{entry.status}</span>
                        </span>
                      </td>
                      <td className="table-amount">${entry.totalDebit.toFixed(2)}</td>
                      <td className="table-amount">${entry.totalCredit.toFixed(2)}</td>
                      <td>
                        {entry.isBalanced ? (
                          <span className="status-pill policy-pass">
                            <span className="status-dot"></span>
                            <span>Balanced (0.00)</span>
                          </span>
                        ) : (
                          <span className="status-pill policy-warn">
                            <span>Imbalanced</span>
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => fetchEntryDetail(entry.id)}
                          >
                            Inspect &rarr;
                          </button>
                          {entry.status === 'FINALIZED' && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleDownloadCsv(`/api/export/journal-entries/${entry.id}/csv`, `journal-${entry.id.slice(0, 8)}.csv`)}
                              title="Download CSV"
                            >
                              CSV
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: JOURNAL ENTRY DETAIL & ZERO-BALANCE LEDGER (Stitch Screen 4 Highlight) */}
      {activeTab === 'detail' && selectedEntry && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Top Actions Bar */}
          <div className="table-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setActiveTab('list')}
            >
              &larr; Back to Journal Entries
            </button>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedEntry.status === 'DRAFT' && (
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={() => handleFinalize(selectedEntry.id)}
                  disabled={finalizing || !selectedEntry.isBalanced}
                >
                  {finalizing ? 'Finalizing...' : '🔒 Finalize Journal Entry'}
                </button>
              )}

              {selectedEntry.status === 'FINALIZED' && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleDownloadCsv(`/api/export/journal-entries/${selectedEntry.id}/csv`, `journal-${selectedEntry.id.slice(0, 8)}.csv`)}
                  >
                    &darr; Export CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleExecuteIntegration('quickbooks', selectedEntry.id)}
                    disabled={executingIntegration}
                  >
                    QuickBooks Online
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleExecuteIntegration('xero', selectedEntry.id)}
                    disabled={executingIntegration}
                  >
                    Xero Journals
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Zero-Balance Ledger Validator Card (Signature Stitch Screen 4) */}
          <div className={`zero-balance-card ${selectedEntry.isBalanced ? '' : 'imbalanced'}`}>
            <div>
              <div className={`balance-status-text ${selectedEntry.isBalanced ? '' : 'imbalanced'}`}>
                {selectedEntry.isBalanced ? '✓ Tally Balanced (0.00 Difference)' : '⚠ Imbalance Detected'}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Double-Entry Invariant: $\sum \text{Debits} = \sum \text{Credits}$ enforced using exact integer-cent arithmetic.
              </p>
            </div>

            <div className="balance-totals-group">
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>TOTAL DEBIT</span>
                <span>${selectedEntry.totalDebit.toFixed(2)}</span>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>TOTAL CREDIT</span>
                <span>${selectedEntry.totalCredit.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Double-Entry Lines Table */}
          <div className="table-card">
            <div className="table-header-bar">
              <span className="table-title">Ordered Double-Entry Lines ({selectedEntry.lines.length})</span>
              <span className={`status-pill ${selectedEntry.status === 'FINALIZED' ? 'approved' : 'pending'}`}>
                <span className="status-dot"></span>
                <span>{selectedEntry.status}</span>
              </span>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '50px' }}>#</th>
                    <th>Account &amp; GL Code</th>
                    <th style={{ textAlign: 'right' }}>Debit ($)</th>
                    <th style={{ textAlign: 'right' }}>Credit ($)</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEntry.lines.map((line) => (
                    <tr key={line.id}>
                      <td style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{line.lineOrder}</td>
                      <td style={{ fontWeight: 600 }}>{line.account}</td>
                      <td className="table-amount" style={{ textAlign: 'right', color: line.debitAmount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {line.debitAmount > 0 ? `$${line.debitAmount.toFixed(2)}` : '—'}
                      </td>
                      <td className="table-amount" style={{ textAlign: 'right', color: line.creditAmount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {line.creditAmount > 0 ? `$${line.creditAmount.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{line.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit Trail Timeline */}
          <div className="table-card" style={{ padding: '20px' }}>
            <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9375rem', fontWeight: 700, marginBottom: '14px' }}>
              Journal Entry Audit Log
            </h4>
            <div className="timeline-list">
              {selectedEntry.auditHistory.map((a) => (
                <div key={a.id} className="timeline-item">
                  <div className="timeline-dot"></div>
                  <span className="timeline-time">
                    {new Date(a.createdAt).toLocaleString()} &bull; <strong>{a.actorName}</strong> ({a.actorRole})
                  </span>
                  <div className="timeline-text">
                    <strong>{a.action}</strong>: {a.details || 'Action recorded'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ACCOUNT MAPPINGS */}
      {activeTab === 'mappings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Add Mapping Form */}
          <form onSubmit={handleSaveMapping} className="table-card" style={{ padding: '20px' }}>
            <h3 className="table-title" style={{ marginBottom: '4px' }}>Configure GL Account Mapping</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Maps an expense category to its deterministic General Ledger debit and credit accounts.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label">Expense Category</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Meals, Travel, Software"
                  value={mappingCategory}
                  onChange={(e) => setMappingCategory(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Debit Account (Expense GL)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 6010 - Meals & Entertainment"
                  value={mappingDebitAccount}
                  onChange={(e) => setMappingDebitAccount(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Credit Account (Payable GL)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 2000 - Accounts Payable"
                  value={mappingCreditAccount}
                  onChange={(e) => setMappingCreditAccount(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-gold" disabled={savingMapping}>
                {savingMapping ? 'Saving...' : 'Save Account Mapping'}
              </button>
            </div>
          </form>

          {/* Current Mappings Table */}
          <div className="table-card">
            <div className="table-header-bar">
              <span className="table-title">Active Category Mappings ({mappings.length})</span>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Debit Account</th>
                    <th>Credit Account</th>
                    <th style={{ textAlign: 'right' }}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.category}</td>
                      <td><code>{m.debitAccount}</code></td>
                      <td><code>{m.creditAccount}</code></td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {new Date(m.updatedAt || m.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: EXPORT & INTEGRATIONS */}
      {activeTab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Provider Cards */}
          <div className="action-cards-grid">
            {providers.map((p) => (
              <div key={p.provider} className="action-card">
                <div className="action-card-icon">⚡</div>
                <div>
                  <h4 className="action-card-title">{p.displayName}</h4>
                  <p className="action-card-desc">{p.description}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 'auto' }}>
                  <span className="status-pill approved">
                    <span className="status-dot"></span>
                    <span>Integration Point Ready</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RFC 4180</span>
                </div>
              </div>
            ))}
          </div>

          {/* Export Audit Log Table */}
          <div className="table-card">
            <div className="table-header-bar">
              <span className="table-title">Export &amp; Integration Audit Trail</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={fetchIntegrationsData}>
                🔄 Refresh
              </button>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Export Type</th>
                    <th>Resource Type</th>
                    <th>Record Count</th>
                    <th>Actor</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <span className="status-pill draft">{log.exportType}</span>
                      </td>
                      <td>{log.resourceType}</td>
                      <td style={{ fontWeight: 600 }}>{log.recordCount}</td>
                      <td>{log.actorRole}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Integration Payload Modal */}
      {integrationModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4 className="modal-title">
                {integrationModal.provider} Provider Payload
              </h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setIntegrationModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-info" style={{ marginBottom: '14px' }}>
                Status: <strong>INTEGRATION_POINT_READY</strong>. Read-only provider schema transformation for future external sync.
              </div>
              <pre style={{ background: '#f8fafc', padding: '14px', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', whiteSpace: 'pre-wrap', maxHeight: '360px', overflowY: 'auto' }}>
                {JSON.stringify(integrationModal.payload, null, 2)}
              </pre>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(integrationModal.payload, null, 2));
                  setSuccessMsg('Copied payload to clipboard!');
                  setTimeout(() => setSuccessMsg(null), 3000);
                }}
              >
                📋 Copy Payload
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setIntegrationModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JournalEntryView;
