import React, { useState, useEffect } from 'react';

/**
 * JournalEntryView (Checkpoint 8 & 9)
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
    <div className="card" style={{ marginBottom: '24px' }}>
      {/* Header & Sub-Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
            Journal Entries &amp; Accounting Integrations
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Deterministic Double-Entry Bookkeeping &bull; CSV Export &bull; QuickBooks &amp; Xero &bull; Checkpoint 9
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' || activeTab === 'detail' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => setActiveTab('list')}
          >
            Journal Entries ({entries.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'mappings' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => setActiveTab('mappings')}
          >
            Account Mappings ({mappings.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'integrations' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => {
              setActiveTab('integrations');
              fetchIntegrationsData();
            }}
          >
            Integrations &amp; Audit ({auditLogs.length})
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
          {successMsg}
        </div>
      )}

      {/* TAB 1: JOURNAL ENTRIES LIST */}
      {activeTab === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              All journal entries generated from reviewed Finance Batches
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '5px 10px', color: '#38bdf8', borderColor: '#38bdf8' }}
                onClick={() => handleDownloadCsv('/api/export/csv', 'all-finalized-journals.csv')}
                title="Download all finalized journal entries for tenant as CSV"
              >
                &darr; Export All Finalized CSV
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                onClick={fetchEntries}
              >
                Refresh
              </button>
            </div>
          </div>

          {entries.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
              No journal entries found. Generate journal entries from completed Finance Batches.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '8px 6px' }}>Journal Entry ID</th>
                    <th style={{ padding: '8px 6px' }}>Finance Batch</th>
                    <th style={{ padding: '8px 6px' }}>Status</th>
                    <th style={{ padding: '8px 6px' }}>Total Debit</th>
                    <th style={{ padding: '8px 6px' }}>Total Credit</th>
                    <th style={{ padding: '8px 6px' }}>Balance</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace' }} title={entry.id}>
                        {entry.id.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace' }} title={entry.batchId}>
                        {entry.batchId.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: entry.status === 'FINALIZED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: entry.status === 'FINALIZED' ? '#10b981' : '#f59e0b',
                        }}>
                          {entry.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: '#38bdf8' }}>
                        ${entry.totalDebit.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 6px', fontWeight: 600, color: '#38bdf8' }}>
                        ${entry.totalCredit.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        {entry.isBalanced ? (
                          <span style={{ color: '#10b981', fontWeight: 600, fontSize: '0.75rem' }}>&check; Balanced</span>
                        ) : (
                          <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.75rem' }}>&cross; Imbalanced</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                            onClick={() => fetchEntryDetail(entry.id)}
                          >
                            View
                          </button>
                          {entry.status === 'FINALIZED' && (
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ fontSize: '0.75rem', padding: '4px 8px', color: '#10b981', borderColor: '#10b981' }}
                              onClick={() => handleDownloadCsv(`/api/export/journal-entries/${entry.id}/csv`, `journal-${entry.id.slice(0, 8)}.csv`)}
                              title="Export CSV"
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

      {/* TAB 2: JOURNAL ENTRY DETAIL & LINES INSPECTOR */}
      {activeTab === 'detail' && selectedEntry && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
              onClick={() => setActiveTab('list')}
            >
              &larr; Back to Journal Entries
            </button>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedEntry.status === 'DRAFT' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                  onClick={() => handleFinalize(selectedEntry.id)}
                  disabled={finalizing || !selectedEntry.isBalanced}
                >
                  {finalizing ? 'Finalizing...' : 'Finalize Journal Entry'}
                </button>
              )}

              {selectedEntry.status === 'FINALIZED' && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '0.8rem', padding: '6px 12px', color: '#10b981', borderColor: '#10b981' }}
                    onClick={() => handleDownloadCsv(`/api/export/journal-entries/${selectedEntry.id}/csv`, `journal-${selectedEntry.id.slice(0, 8)}.csv`)}
                  >
                    &darr; Export CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '0.8rem', padding: '6px 12px', color: '#38bdf8', borderColor: '#38bdf8' }}
                    onClick={() => handleExecuteIntegration('quickbooks', selectedEntry.id)}
                    disabled={executingIntegration}
                  >
                    QuickBooks
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '0.8rem', padding: '6px 12px', color: '#a78bfa', borderColor: '#a78bfa' }}
                    onClick={() => handleExecuteIntegration('xero', selectedEntry.id)}
                    disabled={executingIntegration}
                  >
                    Xero
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Metadata Card */}
          <div style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Journal Entry ID:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedEntry.id}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Finance Batch ID:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{selectedEntry.batchId}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Status:</span>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: selectedEntry.status === 'FINALIZED' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                  color: selectedEntry.status === 'FINALIZED' ? '#10b981' : '#f59e0b',
                }}>
                  {selectedEntry.status}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Double-Entry Integrity:</span>
                {selectedEntry.isBalanced ? (
                  <span style={{ color: '#10b981', fontWeight: 600 }}>TOTAL DEBITS = TOTAL CREDITS (${selectedEntry.totalDebit.toFixed(2)})</span>
                ) : (
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>Imbalanced (Debits: ${selectedEntry.totalDebit.toFixed(2)}, Credits: ${selectedEntry.totalCredit.toFixed(2)})</span>
                )}
              </div>
              {selectedEntry.finalizedAt && (
                <div>
                  <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Finalized:</span>
                  <span>{new Date(selectedEntry.finalizedAt).toLocaleString()} by {selectedEntry.finalizedBy?.name || 'Finance'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Journal Entry Lines Table */}
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '8px' }}>
            Journal Entry Lines ({selectedEntry.lines.length})
          </h3>

          <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '8px 6px', width: '40px' }}>#</th>
                  <th style={{ padding: '8px 6px' }}>Account (GL)</th>
                  <th style={{ padding: '8px 6px' }}>Description</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Debit ($)</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Credit ($)</th>
                </tr>
              </thead>
              <tbody>
                {selectedEntry.lines.map((line) => (
                  <tr key={line.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '8px 6px', color: 'var(--text-muted)' }}>{line.lineOrder}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>{line.account}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{line.description || '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: line.debitAmount > 0 ? '#38bdf8' : 'var(--text-muted)' }}>
                      {line.debitAmount > 0 ? `$${line.debitAmount.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: line.creditAmount > 0 ? '#a78bfa' : 'var(--text-muted)' }}>
                      {line.creditAmount > 0 ? `$${line.creditAmount.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}>
                  <td colSpan="3" style={{ padding: '10px 6px', textAlign: 'right' }}>Total:</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', color: '#38bdf8' }}>${selectedEntry.totalDebit.toFixed(2)}</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', color: '#a78bfa' }}>${selectedEntry.totalCredit.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Audit Trail */}
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '8px' }}>
            Accounting Audit Trail ({selectedEntry.auditHistory.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedEntry.auditHistory.map((a) => (
              <div key={a.id} style={{ fontSize: '0.8rem', padding: '8px 12px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px', borderLeft: '3px solid var(--accent-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <strong>{a.action} by {a.actorName || a.actorRole}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{a.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: ACCOUNT MAPPINGS CONFIGURATION */}
      {activeTab === 'mappings' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Deterministic mappings: Expense Category &rarr; Debit (Expense) Account &amp; Credit (Payable) Account
              </span>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={fetchMappings}
            >
              Refresh
            </button>
          </div>

          {/* Add / Update Mapping Form */}
          <form onSubmit={handleSaveMapping} style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '10px' }}>Add or Update Category Mapping</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Expense Category</label>
                <input
                  type="text"
                  placeholder="e.g. Meals, Travel, Software"
                  value={mappingCategory}
                  onChange={(e) => setMappingCategory(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', background: '#0f172a', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Debit Account (Expense GL)</label>
                <input
                  type="text"
                  placeholder="e.g. 6000 - Meals & Entertainment"
                  value={mappingDebitAccount}
                  onChange={(e) => setMappingDebitAccount(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', background: '#0f172a', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Credit Account (Liability / Payable)</label>
                <input
                  type="text"
                  placeholder="e.g. 2000 - Accounts Payable"
                  value={mappingCreditAccount}
                  onChange={(e) => setMappingCreditAccount(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', background: '#0f172a', border: '1px solid var(--border-color)', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingMapping}
              style={{ fontSize: '0.8rem', padding: '6px 14px' }}
            >
              {savingMapping ? 'Saving...' : 'Save Account Mapping'}
            </button>
          </form>

          {/* Mappings Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '8px 6px' }}>Expense Category</th>
                <th style={{ padding: '8px 6px' }}>Debit Account (Expense GL)</th>
                <th style={{ padding: '8px 6px' }}>Credit Account (Payable GL)</th>
                <th style={{ padding: '8px 6px' }}>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 600 }}>{m.category}</td>
                  <td style={{ padding: '8px 6px', color: '#38bdf8' }}>{m.debitAccount}</td>
                  <td style={{ padding: '8px 6px', color: '#a78bfa' }}>{m.creditAccount}</td>
                  <td style={{ padding: '8px 6px', color: 'var(--text-muted)' }}>{new Date(m.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: INTEGRATIONS & EXPORT AUDIT TRAIL */}
      {activeTab === 'integrations' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '8px' }}>
              Accounting Integration Points (QuickBooks / Xero)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              ExpensEase provides clean provider adapter boundaries that transform finalized CP8 Journal Entries into provider-ready schemas.
              Live synchronization connects seamlessly when external OAuth / sandbox credentials are configured.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '24px' }}>
              {providers.map((prov) => (
                <div key={prov.id} style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '0.95rem' }}>{prov.name}</strong>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: '#38bdf8',
                    }}>
                      {prov.status}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                    {prov.description}
                  </p>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Boundary: Finalized Journal Entry &rarr; {prov.name} API Payload
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Audit Logs Table */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
                Export &amp; Integration Audit Trail ({auditLogs.length})
              </h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                onClick={fetchIntegrationsData}
              >
                Refresh
              </button>
            </div>

            {auditLogs.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px' }}>
                No export or integration actions recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px 6px' }}>Timestamp</th>
                      <th style={{ padding: '8px 6px' }}>Type</th>
                      <th style={{ padding: '8px 6px' }}>Resource</th>
                      <th style={{ padding: '8px 6px' }}>Actor</th>
                      <th style={{ padding: '8px 6px' }}>Lines</th>
                      <th style={{ padding: '8px 6px' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '8px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '10px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            background: log.exportType === 'CSV' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                            color: log.exportType === 'CSV' ? '#10b981' : '#38bdf8',
                          }}>
                            {log.exportType}
                          </span>
                        </td>
                        <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                          {log.resourceType}
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          {log.actorName || log.actorRole}
                        </td>
                        <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                          {log.recordCount}
                        </td>
                        <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Integration Payload Modal */}
      {integrationModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: '#1e293b',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            maxWidth: '750px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                {integrationModal.provider} Integration Payload
              </h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                onClick={() => setIntegrationModal(null)}
              >
                &times; Close
              </button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto' }}>
              <div className="alert alert-info" style={{ marginBottom: '14px', fontSize: '0.8rem' }}>
                <strong>Integration Point Ready:</strong> {integrationModal.message}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px', fontSize: '0.8rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Provider:</span>
                  <div><strong>{integrationModal.provider}</strong></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                  <div><strong style={{ color: '#38bdf8' }}>{integrationModal.status}</strong></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Lines Transformed:</span>
                  <div><strong>{integrationModal.lineCount}</strong></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Total Amount:</span>
                  <div><strong>${Number(integrationModal.totalAmount).toFixed(2)}</strong></div>
                </div>
              </div>

              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
                Provider Payload Schema (JSON):
              </label>
              <pre style={{
                background: '#0f172a',
                padding: '14px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                fontSize: '0.78rem',
                overflowX: 'auto',
                color: '#e2e8f0',
                margin: 0,
              }}>
                {JSON.stringify(integrationModal.payload, null, 2)}
              </pre>
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(integrationModal.payload, null, 2));
                  setSuccessMsg(`Copied ${integrationModal.provider} payload to clipboard`);
                }}
              >
                Copy JSON Payload
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                onClick={() => setIntegrationModal(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JournalEntryView;
