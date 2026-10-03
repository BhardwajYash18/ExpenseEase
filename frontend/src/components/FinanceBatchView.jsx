import React, { useState, useEffect } from 'react';

/**
 * FinanceBatchView
 *
 * Dedicated UI for FINANCE role to manage Finance Batches per AGENTS.md Section 14
 * and docs/PRD.md FR-09 & FR-12.
 */
function FinanceBatchView({ authToken, currentUser, onSelectBatch }) {
  const [batches, setBatches] = useState([]);
  const [eligibleExpenses, setEligibleExpenses] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'create', 'detail'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Batch creation form state
  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const [creating, setCreating] = useState(false);

  // Review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // Add item state
  const [selectedAddReceiptId, setSelectedAddReceiptId] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  // Journal Entry state
  const [batchJournalEntry, setBatchJournalEntry] = useState(null);
  const [generatingJournal, setGeneratingJournal] = useState(false);

  // Fetch batches list
  async function fetchBatches() {
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/finance-batches', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
      }
    } catch (err) {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }

  // Fetch eligible expenses
  async function fetchEligibleExpenses() {
    if (!authToken) return;
    try {
      const res = await fetch('/api/finance-batches/eligible-expenses', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEligibleExpenses(data.expenses || []);
      }
    } catch (err) {
      // quiet fail
    }
  }

  // Fetch single batch detail
  async function fetchBatchDetail(batchId) {
    if (!authToken || !batchId) return;
    setLoading(true);
    setBatchJournalEntry(null);
    try {
      const res = await fetch(`/api/finance-batches/${batchId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedBatch(data.batch);
        setActiveTab('detail');

        // Check if journal entry exists for this batch
        try {
          const jeRes = await fetch(`/api/finance-batches/${batchId}/journal-entry`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (jeRes.ok) {
            const jeData = await jeRes.json();
            setBatchJournalEntry(jeData.journalEntry);
          }
        } catch {
          // No journal entry yet
        }
      } else {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to fetch batch details');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    fetchBatches();
    fetchEligibleExpenses();
  }, [authToken]);

  // Handle batch creation
  async function handleCreateBatch(e) {
    e.preventDefault();
    if (selectedReceiptIds.size === 0) return;
    setCreating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/finance-batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ receiptIds: Array.from(selectedReceiptIds) }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create finance batch');
      }

      setSuccessMsg(`Finance Batch created successfully! (ID: ${data.batch.id.slice(0, 8)}...)`);
      setSelectedReceiptIds(new Set());
      await fetchBatches();
      await fetchEligibleExpenses();
      setSelectedBatch(data.batch);
      setActiveTab('detail');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // Handle item removal
  async function handleRemoveItem(receiptId) {
    if (!selectedBatch) return;
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/finance-batches/${selectedBatch.id}/items/${receiptId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to remove expense from batch');
      }

      setSuccessMsg('Expense removed from batch. It remains in APPROVED state.');
      setSelectedBatch(data.batch);
      await fetchBatches();
      await fetchEligibleExpenses();
    } catch (err) {
      setError(err.message);
    }
  }

  // Handle item addition
  async function handleAddItem(e) {
    e.preventDefault();
    if (!selectedBatch || !selectedAddReceiptId) return;
    setAddingItem(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/finance-batches/${selectedBatch.id}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ receiptId: selectedAddReceiptId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to add expense to batch');
      }

      setSuccessMsg('Expense added to batch successfully.');
      setSelectedAddReceiptId('');
      setSelectedBatch(data.batch);
      await fetchBatches();
      await fetchEligibleExpenses();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingItem(false);
    }
  }

  // Handle complete finance review
  async function handleReviewBatch() {
    if (!selectedBatch) return;
    setReviewing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/finance-batches/${selectedBatch.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to review finance batch');
      }

      setSuccessMsg('Finance review completed. Batch is now locked and marked as REVIEWED.');
      setShowReviewModal(false);
      setSelectedBatch(data.batch);
      await fetchBatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  }

  // Generate Journal Entry from reviewed batch
  async function handleGenerateJournalEntry() {
    if (!selectedBatch) return;
    setGeneratingJournal(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/finance-batches/${selectedBatch.id}/journal-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to generate journal entry');
      }

      setSuccessMsg(`Journal Entry generated successfully! (Status: ${data.journalEntry.status})`);
      setBatchJournalEntry(data.journalEntry);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingJournal(false);
    }
  }

  // Calculate live selected total for creation form
  const selectedTotal = eligibleExpenses
    .filter((e) => selectedReceiptIds.has(e.receiptId))
    .reduce((sum, e) => sum + (typeof e.amount === 'number' ? Math.round(e.amount * 100) : 0), 0) / 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Controls Header */}
      <div className="table-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Finance Batches &amp; Audit Grouping
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
            Aggregate approved expense vouchers into audit-ready reconciliation batches.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={() => {
              setActiveTab('list');
              fetchBatches();
            }}
          >
            Batches List ({batches.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'create' ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={() => {
              setActiveTab('create');
              fetchEligibleExpenses();
            }}
          >
            + Create Batch ({eligibleExpenses.length} ready)
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

      {/* TAB 1: BATCHES LIST */}
      {activeTab === 'list' && (
        <div className="table-card">
          <div className="table-header-bar">
            <span className="table-title">Reconciliation Batches ({batches.length})</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={fetchBatches} disabled={loading}>
              🔄 Refresh
            </button>
          </div>

          {batches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              No finance batches created yet. Click <strong>"+ Create Batch"</strong> to group approved expenses.
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch ID</th>
                    <th>Status</th>
                    <th>Expenses</th>
                    <th>Total Amount</th>
                    <th>Created By</th>
                    <th>Reviewer</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{b.id.slice(0, 13)}...</td>
                      <td>
                        <span className={`status-pill ${b.status === 'REVIEWED' ? 'approved' : 'pending'}`}>
                          <span className="status-dot"></span>
                          <span>{b.status}</span>
                        </span>
                      </td>
                      <td>{b.expenseCount} items</td>
                      <td className="table-amount">${b.totalAmount.toFixed(2)}</td>
                      <td>{b.createdBy.name}</td>
                      <td>{b.reviewedBy ? b.reviewedBy.name : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => fetchBatchDetail(b.id)}
                        >
                          View Batch &rarr;
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

      {/* TAB 2: CREATE BATCH */}
      {activeTab === 'create' && (
        <form onSubmit={handleCreateBatch} className="table-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 className="table-title">Select Approved Expenses to Batch</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Only Manager-approved expenses are eligible for Finance Batching.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedReceiptIds(new Set(eligibleExpenses.map((e) => e.receiptId)))}
              >
                Select All
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedReceiptIds(new Set())}
              >
                Deselect All
              </button>
            </div>
          </div>

          {eligibleExpenses.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)' }}>
              No approved expenses currently available for batching.
            </div>
          ) : (
            <div className="data-table-wrapper" style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}></th>
                    <th>Merchant</th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Submitter</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleExpenses.map((exp) => {
                    const isChecked = selectedReceiptIds.has(exp.receiptId);
                    return (
                      <tr
                        key={exp.receiptId}
                        className={isChecked ? 'selected' : ''}
                        onClick={() => {
                          const next = new Set(selectedReceiptIds);
                          if (isChecked) next.delete(exp.receiptId);
                          else next.add(exp.receiptId);
                          setSelectedReceiptIds(next);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                          />
                        </td>
                        <td style={{ fontWeight: 600 }}>{exp.merchant}</td>
                        <td>{exp.date || '—'}</td>
                        <td><span className="status-pill draft">{exp.category}</span></td>
                        <td>{exp.submitter.name}</td>
                        <td className="table-amount" style={{ textAlign: 'right' }}>
                          ${typeof exp.amount === 'number' ? exp.amount.toFixed(2) : '0.00'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Creation Summary Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              borderRadius: 'var(--radius-md)',
              background: '#f8fafc',
              border: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Selected Items: </span>
              <strong>{selectedReceiptIds.size}</strong> &bull;{' '}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Deterministic Batch Total: </span>
              <strong style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontFamily: 'var(--font-display)' }}>
                ${selectedTotal.toFixed(2)}
              </strong>
            </div>

            <button
              type="submit"
              className="btn btn-gold btn-lg"
              disabled={creating || selectedReceiptIds.size === 0}
            >
              {creating ? 'Creating Batch...' : `Create Finance Batch (${selectedReceiptIds.size})`}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: BATCH DETAIL */}
      {activeTab === 'detail' && selectedBatch && (
        <div className="table-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ marginBottom: '10px' }}
                onClick={() => {
                  setActiveTab('list');
                  fetchBatches();
                }}
              >
                &larr; Back to Batches
              </button>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                Batch ID: {selectedBatch.id}
              </h3>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Created by {selectedBatch.createdBy.name} on {new Date(selectedBatch.createdAt).toLocaleString()}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span className={`status-pill ${selectedBatch.status === 'REVIEWED' ? 'approved' : 'pending'}`}>
                <span className="status-dot"></span>
                <span>{selectedBatch.status}</span>
              </span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '6px', fontFamily: 'var(--font-display)' }}>
                ${selectedBatch.totalAmount.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {selectedBatch.expenseCount} approved expense(s)
              </div>
            </div>
          </div>

          {/* Action Bar for OPEN Batch */}
          {selectedBatch.status === 'OPEN' && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc',
                padding: '14px 18px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '20px',
                border: '1px solid var(--border-subtle)',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="form-select"
                  value={selectedAddReceiptId}
                  onChange={(e) => setSelectedAddReceiptId(e.target.value)}
                  style={{ width: 'auto', minWidth: '240px' }}
                >
                  <option value="">Select approved expense to add...</option>
                  {eligibleExpenses
                    .filter((e) => !selectedBatch.items.some((it) => it.receiptId === e.receiptId))
                    .map((e) => (
                      <option key={e.receiptId} value={e.receiptId}>
                        {e.merchant} &bull; ${typeof e.amount === 'number' ? e.amount.toFixed(2) : '0.00'} &bull; {e.submitter.name}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  className="btn btn-outline"
                  disabled={addingItem || !selectedAddReceiptId}
                >
                  {addingItem ? 'Adding...' : '+ Add Expense'}
                </button>
              </form>

              <button
                type="button"
                className="btn btn-gold"
                onClick={() => setShowReviewModal(true)}
              >
                Complete Finance Review &rarr;
              </button>
            </div>
          )}

          {/* Reviewed Status Banner */}
          {selectedBatch.status === 'REVIEWED' && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #86efac',
                padding: '16px 20px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#15803d', marginBottom: '2px' }}>
                  ✓ Finance Review Completed &amp; Batch Locked
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#166534' }}>
                  Reviewed by {selectedBatch.reviewedBy?.name} on {new Date(selectedBatch.reviewedAt).toLocaleString()}.
                  {batchJournalEntry && (
                    <span style={{ display: 'block', marginTop: '4px', fontWeight: 600 }}>
                      Journal Entry Generated: {batchJournalEntry.id.slice(0, 8)}... (Status: {batchJournalEntry.status}, Total: ${batchJournalEntry.totalDebit.toFixed(2)})
                    </span>
                  )}
                </div>
              </div>

              {!batchJournalEntry && (
                <button
                  type="button"
                  className="btn btn-gold"
                  onClick={handleGenerateJournalEntry}
                  disabled={generatingJournal}
                >
                  {generatingJournal ? 'Generating...' : '⚡ Generate Balanced Journal Entry'}
                </button>
              )}
            </div>
          )}

          {/* Included Expenses Table */}
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '10px' }}>
            Included Expenses ({selectedBatch.items.length})
          </h4>
          <div className="data-table-wrapper" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '20px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Submitter</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  {selectedBatch.status === 'OPEN' && (
                    <th style={{ textAlign: 'center', width: '80px' }}>Action</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {selectedBatch.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.merchant}</td>
                    <td>{item.date || '—'}</td>
                    <td><span className="status-pill draft">{item.category}</span></td>
                    <td>{item.submitter.name}</td>
                    <td className="table-amount" style={{ textAlign: 'right' }}>
                      ${item.amount.toFixed(2)}
                    </td>
                    {selectedBatch.status === 'OPEN' && (
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveItem(item.receiptId)}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Audit Trail Timeline */}
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '10px' }}>
            Audit Trail ({selectedBatch.auditHistory.length} events)
          </h4>
          <div className="timeline-list">
            {selectedBatch.auditHistory.map((a) => (
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

          {/* Complete Review Modal */}
          {showReviewModal && (
            <div className="modal-overlay">
              <div className="modal-dialog">
                <div className="modal-header">
                  <h4 className="modal-title">Complete Finance Review</h4>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowReviewModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Completing review will transition this batch from <strong>OPEN</strong> to <strong>REVIEWED</strong>. Once reviewed, the batch is permanently locked against adding or removing expenses.
                  </p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline" onClick={() => setShowReviewModal(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn btn-gold"
                    onClick={handleReviewBatch}
                    disabled={reviewing}
                  >
                    {reviewing ? 'Completing...' : 'Confirm Review'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FinanceBatchView;
