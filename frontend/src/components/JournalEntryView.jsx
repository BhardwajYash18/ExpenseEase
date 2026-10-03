import React, { useState, useEffect } from 'react';

/**
 * JournalEntryView (Checkpoint 8)
 *
 * Dedicated UI for FINANCE role to manage Journal Entries and deterministic
 * double-entry accounting per AGENTS.md Sections 14, 15, 28 and docs/PRD.md FR-10.
 *
 * Requirements & Scope:
 * - Journal entries are generated from reviewed Finance Batches.
 * - Displays Journal Entry ID, Finance Batch ID, status ('DRAFT', 'FINALIZED').
 * - Displays journal lines with account, debit amount, credit amount.
 * - Displays debit total, credit total, and double-entry balance status.
 * - Finalize action for reviewable DRAFT entries (verifies TOTAL DEBITS = TOTAL CREDITS).
 * - Configuration interface for Category → GL Account mappings.
 */
function JournalEntryView({ authToken, currentUser }) {
  const [entries, setEntries] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'detail', 'mappings'
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
    } catch (err) {
      setError(err.message);
    } finally {
      setFinalizing(false);
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
            Journal Entries & Accounting
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Deterministic Double-Entry Bookkeeping &bull; Checkpoint 8
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              All journal entries generated from reviewed Finance Batches
            </span>
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={fetchEntries}
            >
              Refresh
            </button>
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
                    <th style={{ padding: '8px 6px', textAlign: 'right' }}>Action</th>
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
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          onClick={() => fetchEntryDetail(entry.id)}
                        >
                          View Details
                        </button>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <button
              type="button"
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
              onClick={() => setActiveTab('list')}
            >
              &larr; Back to Journal Entries
            </button>

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
                  placeholder="e.g. Meals, Travel, Supplies"
                  value={mappingCategory}
                  onChange={(e) => setMappingCategory(e.target.value)}
                  required
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Debit Account (Expense)</label>
                <input
                  type="text"
                  placeholder="e.g. 6100 - Meals & Entertainment"
                  value={mappingDebitAccount}
                  onChange={(e) => setMappingDebitAccount(e.target.value)}
                  required
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Credit Account (Liability/Payable)</label>
                <input
                  type="text"
                  placeholder="e.g. 2000 - Accounts Payable"
                  value={mappingCreditAccount}
                  onChange={(e) => setMappingCreditAccount(e.target.value)}
                  required
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: '#0f172a', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={savingMapping} style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
              {savingMapping ? 'Saving...' : 'Save Account Mapping'}
            </button>
          </form>

          {/* Mappings Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '8px 6px' }}>Category</th>
                  <th style={{ padding: '8px 6px' }}>Debit Account (Expense)</th>
                  <th style={{ padding: '8px 6px' }}>Credit Account (Payable)</th>
                  <th style={{ padding: '8px 6px' }}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>{m.category}</td>
                    <td style={{ padding: '8px 6px', color: '#38bdf8' }}>{m.debitAccount}</td>
                    <td style={{ padding: '8px 6px', color: '#a78bfa' }}>{m.creditAccount}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-muted)' }}>{new Date(m.updatedAt || m.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default JournalEntryView;
