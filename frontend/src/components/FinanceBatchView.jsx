import React, { useState, useEffect } from 'react';

/**
 * FinanceBatchView (Checkpoint 7)
 *
 * Dedicated UI for FINANCE role to manage Finance Batches per AGENTS.md Section 14
 * and docs/PRD.md FR-09 & FR-12.
 *
 * Requirements & Scope:
 * - Batches are identified exclusively by their UUID (no invented batch_name or notes fields).
 * - Statuses 'OPEN' and 'REVIEWED' represent implementation states for review progression.
 * - Approved expenses can be grouped into batches.
 * - Duplicate inclusion of the same expense within a batch is prevented.
 * - Expenses removed from an open batch remain in 'APPROVED' workflow state.
 * - Completing finance review locks the batch from further item additions/removals.
 */
function FinanceBatchView({ authToken, currentUser }) {
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

  // Fetch batches list
  async function fetchBatches() {
    if (!authToken) return;
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
    try {
      const res = await fetch(`/api/finance-batches/${batchId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedBatch(data.batch);
        setActiveTab('detail');
      } else {
        const data = await res.json();
        setError(data.error?.message || 'Failed to load batch');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBatches();
    fetchEligibleExpenses();
  }, [authToken]);

  // Handle batch creation
  async function handleCreateBatch(e) {
    e.preventDefault();
    if (selectedReceiptIds.size === 0) {
      setError('Please select at least one approved expense to include in the batch.');
      return;
    }

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
        body: JSON.stringify({
          receiptIds: Array.from(selectedReceiptIds),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create finance batch');
      }

      setSuccessMsg(`Batch created successfully! (ID: ${data.batch.id.slice(0, 8)}...)`);
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

      setSuccessMsg('Finance review completed. Batch is now marked as REVIEWED.');
      setShowReviewModal(false);
      setSelectedBatch(data.batch);
      await fetchBatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  }

  // Calculate live selected total for creation form
  const selectedTotal = eligibleExpenses
    .filter((e) => selectedReceiptIds.has(e.receiptId))
    .reduce((sum, e) => sum + (typeof e.amount === 'number' ? Math.round(e.amount * 100) : 0), 0) / 100;

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
            Finance Operations &bull; Batches
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Checkpoint 7 &mdash; Group approved expenses for finance review and audit.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'list' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => {
              setActiveTab('list');
              fetchBatches();
            }}
          >
            Batches List ({batches.length})
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-outline'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => {
              setActiveTab('create');
              fetchEligibleExpenses();
            }}
          >
            + Create Batch ({eligibleExpenses.length} eligible)
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '14px' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '14px' }}>
          {successMsg}
        </div>
      )}

      {/* TAB 1: BATCHES LIST */}
      {activeTab === 'list' && (
        <div>
          {batches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
              No finance batches created yet. Click <strong>"+ Create Batch"</strong> above to group approved expenses.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {batches.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: '#0f172a',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Batch {b.id.slice(0, 8)}...</span>
                      <span
                        className={`status-badge ${b.status === 'REVIEWED' ? 'ok' : 'pending'}`}
                        style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                      >
                        {b.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {b.expenseCount} expenses &bull; Total: <strong>${b.totalAmount.toFixed(2)}</strong> &bull; Created by {b.createdBy.name} on {new Date(b.createdAt).toLocaleDateString()}
                      {b.reviewedBy && (
                        <span> &bull; Reviewed by {b.reviewedBy.name}</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => fetchBatchDetail(b.id)}
                  >
                    View Details &rarr;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CREATE BATCH */}
      {activeTab === 'create' && (
        <form onSubmit={handleCreateBatch}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Select Eligible Approved Expenses ({eligibleExpenses.length} available)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={() => {
                    const allIds = new Set(eligibleExpenses.map((e) => e.receiptId));
                    setSelectedReceiptIds(allIds);
                  }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={() => setSelectedReceiptIds(new Set())}
                >
                  Deselect All
                </button>
              </div>
            </div>

            {eligibleExpenses.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', background: '#0f172a', borderRadius: '6px', color: 'var(--text-muted)' }}>
                No approved expenses currently available for batching. Expenses must be approved by a Manager first.
              </div>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#1e293b', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px', width: '40px' }}></th>
                      <th style={{ padding: '8px 12px' }}>Merchant</th>
                      <th style={{ padding: '8px 12px' }}>Date</th>
                      <th style={{ padding: '8px 12px' }}>Category</th>
                      <th style={{ padding: '8px 12px' }}>Submitter</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleExpenses.map((exp) => {
                      const isChecked = selectedReceiptIds.has(exp.receiptId);
                      return (
                        <tr
                          key={exp.receiptId}
                          onClick={() => {
                            const next = new Set(selectedReceiptIds);
                            if (isChecked) next.delete(exp.receiptId);
                            else next.add(exp.receiptId);
                            setSelectedReceiptIds(next);
                          }}
                          style={{
                            background: isChecked ? '#1e293b' : 'transparent',
                            borderBottom: '1px solid #334155',
                            cursor: 'pointer',
                          }}
                        >
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                            />
                          </td>
                          <td style={{ padding: '8px 12px' }}>{exp.merchant}</td>
                          <td style={{ padding: '8px 12px' }}>{exp.date || 'N/A'}</td>
                          <td style={{ padding: '8px 12px' }}>{exp.category}</td>
                          <td style={{ padding: '8px 12px' }}>{exp.submitter.name}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                            ${typeof exp.amount === 'number' ? exp.amount.toFixed(2) : '0.00'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Creation Summary Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderRadius: '6px',
              background: '#0f172a',
              border: '1px solid var(--border-color)',
              marginBottom: '16px',
            }}
          >
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Selected Expenses: </span>
              <strong>{selectedReceiptIds.size}</strong> &bull;{' '}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Deterministic Total: </span>
              <strong style={{ color: 'var(--color-primary, #38bdf8)', fontSize: '1.1rem' }}>
                ${selectedTotal.toFixed(2)}
              </strong>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || selectedReceiptIds.size === 0}
              style={{ padding: '8px 20px', fontWeight: 600 }}
            >
              {creating ? 'Creating Batch...' : `Create Batch (${selectedReceiptIds.size})`}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: BATCH DETAIL */}
      {activeTab === 'detail' && selectedBatch && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '4px 8px', marginBottom: '8px' }}
                onClick={() => {
                  setActiveTab('list');
                  fetchBatches();
                }}
              >
                &larr; Back to Batches
              </button>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Batch ID: {selectedBatch.id}
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Created by {selectedBatch.createdBy.name} on {new Date(selectedBatch.createdAt).toLocaleString()}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span
                className={`status-badge ${selectedBatch.status === 'REVIEWED' ? 'ok' : 'pending'}`}
                style={{ fontSize: '0.85rem', padding: '4px 12px' }}
              >
                {selectedBatch.status}
              </span>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '6px', color: 'var(--color-primary, #38bdf8)' }}>
                ${selectedBatch.totalAmount.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {selectedBatch.expenseCount} expense(s)
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
                background: '#1e293b',
                padding: '12px 16px',
                borderRadius: '6px',
                marginBottom: '16px',
              }}
            >
              <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={selectedAddReceiptId}
                  onChange={(e) => setSelectedAddReceiptId(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '4px',
                    background: '#0f172a',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.8rem',
                  }}
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
                  style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                >
                  {addingItem ? 'Adding...' : '+ Add Expense'}
                </button>
              </form>

              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '0.85rem', padding: '8px 16px' }}
                onClick={() => setShowReviewModal(true)}
              >
                Complete Finance Review &rarr;
              </button>
            </div>
          )}

          {selectedBatch.status === 'REVIEWED' && (
            <div className="alert alert-info" style={{ marginBottom: '16px' }}>
              &bull; <strong>Finance Review Completed:</strong> Reviewed by {selectedBatch.reviewedBy?.name} on {new Date(selectedBatch.reviewedAt).toLocaleString()}. Batch is locked from further item additions/removals and ready for Checkpoint 8 Journal Entry generation.
            </div>
          )}

          {/* Included Expenses Table */}
          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '8px' }}>
            Included Expenses ({selectedBatch.items.length})
          </h4>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#1e293b', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>Merchant</th>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Category</th>
                  <th style={{ padding: '8px 12px' }}>Submitter</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                  {selectedBatch.status === 'OPEN' && (
                    <th style={{ padding: '8px 12px', textAlign: 'center', width: '80px' }}>Action</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {selectedBatch.items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{item.merchant}</td>
                    <td style={{ padding: '8px 12px' }}>{item.date || 'N/A'}</td>
                    <td style={{ padding: '8px 12px' }}>{item.category}</td>
                    <td style={{ padding: '8px 12px' }}>{item.submitter.name}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                      ${item.amount.toFixed(2)}
                    </td>
                    {selectedBatch.status === 'OPEN' && (
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: '0.7rem', padding: '2px 8px', color: '#f87171', borderColor: '#f87171' }}
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
          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '8px' }}>
            Audit Trail ({selectedBatch.auditHistory.length} events)
          </h4>
          <div style={{ background: '#0f172a', padding: '12px 16px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            {selectedBatch.auditHistory.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '140px' }}>
                  {new Date(a.createdAt).toLocaleString()}
                </span>
                <span style={{ fontWeight: 600, color: '#38bdf8', minWidth: '90px' }}>
                  [{a.action}]
                </span>
                <span>
                  <strong>{a.actorName}</strong> ({a.actorRole}): {a.details || 'Action recorded'}
                </span>
              </div>
            ))}
          </div>

          {/* Review Modal */}
          {showReviewModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '24px',
                  borderRadius: '8px',
                  width: '90%',
                  maxWidth: '440px',
                  border: '1px solid var(--border-color)',
                }}
              >
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>Complete Finance Review</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Completing review will transition this batch from <strong>OPEN</strong> to <strong>REVIEWED</strong>. Once reviewed, no further expenses can be added or removed.
                </p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setShowReviewModal(false)}
                    disabled={reviewing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
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
