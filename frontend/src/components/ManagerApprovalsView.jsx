import React, { useState, useEffect } from 'react';
import ReceiptView from './ReceiptView';

export default function ManagerApprovalsView({ authToken, currentUser, onSelectReceipt }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('PENDING'); // Default to PENDING claims for action

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function fetchPendingReceipts() {
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/receipts?limit=100', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.receipts || [];
        setReceipts(list);

        // Keep selected receipt in sync or pick the first pending/available receipt
        setSelectedReceipt((prev) => {
          if (prev) {
            const found = list.find((r) => r.id === prev.id);
            if (found) return found;
          }
          const firstPending = list.find(
            (r) => (r.workflow_state || r.workflowState) === 'PENDING_APPROVAL'
          );
          return firstPending || (list.length > 0 ? list[0] : null);
        });
      }
    } catch (err) {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPendingReceipts();
  }, [authToken]);

  // Derived metrics from all tenant receipts
  const totalClaims = receipts.length;
  const pendingClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'PENDING_APPROVAL'
  );
  const approvedClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'APPROVED'
  );
  const correctionClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'CORRECTION_REQUESTED'
  );
  const rejectedClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'REJECTED'
  );

  // Filtered dataset
  const filteredReceipts = receipts.filter((r) => {
    const st = r.workflow_state || r.workflowState || 'DRAFT';
    if (filterStatus === 'PENDING' && st !== 'PENDING_APPROVAL') return false;
    if (filterStatus === 'APPROVED' && st !== 'APPROVED') return false;
    if (filterStatus === 'CORRECTION' && st !== 'CORRECTION_REQUESTED') return false;
    if (filterStatus === 'REJECTED' && st !== 'REJECTED') return false;
    if (filterStatus === 'DRAFT' && st !== 'DRAFT') return false;

    if (filterText) {
      const search = filterText.toLowerCase();
      const filename = (r.original_filename || r.originalFilename || '').toLowerCase();
      const merchant = (r.merchantName || '').toLowerCase();
      const empName = (r.employeeName || '').toLowerCase();
      const empEmail = (r.employeeEmail || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      return (
        filename.includes(search) ||
        merchant.includes(search) ||
        empName.includes(search) ||
        empEmail.includes(search) ||
        id.includes(search)
      );
    }
    return true;
  });

  // Client-side pagination slice
  const totalFiltered = filteredReceipts.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedReceipts = filteredReceipts.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Manager Metrics Row (Stitch Screen 3) */}
      <div className="stats-grid">
        <div
          className={`stat-card ${filterStatus === 'PENDING' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('PENDING');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Pending Claims</span>
            <span className="stat-icon">⏳</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{pendingClaims.length}</div>
            <span className="stat-subtext status-pill pending">Action Required</span>
          </div>
        </div>

        <div
          className={`stat-card ${filterStatus === 'APPROVED' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('APPROVED');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Approved Claims</span>
            <span className="stat-icon">✅</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{approvedClaims.length}</div>
            <span className="stat-subtext status-pill approved">Within Policy</span>
          </div>
        </div>

        <div
          className={`stat-card ${filterStatus === 'CORRECTION' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('CORRECTION');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Needs Correction</span>
            <span className="stat-icon">↺</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{correctionClaims.length}</div>
            <span className="stat-subtext status-pill correction">Returned to Submitter</span>
          </div>
        </div>

        <div
          className={`stat-card ${filterStatus === 'REJECTED' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('REJECTED');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Rejected Claims</span>
            <span className="stat-icon">❌</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{rejectedClaims.length}</div>
            <span className="stat-subtext status-pill rejected">Non-compliant</span>
          </div>
        </div>
      </div>

      {/* Main Two-Panel Layout (Active Queue + Active Inspector) */}
      <div className="split-view-container">
        {/* Left Panel: Active Queue */}
        <div className="split-panel">
          <div className="split-panel-header">
            <div>
              <span className="split-panel-title">Manager Approvals Queue</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Showing {totalFiltered} {filterStatus === 'ALL' ? 'total' : filterStatus.toLowerCase()} expense claims
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={fetchPendingReceipts}
              disabled={loading}
              title="Refresh Queue"
            >
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          {/* Quick Filter Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', background: '#f8fafc', overflowX: 'auto' }}>
            <button
              type="button"
              style={{
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                borderBottom: filterStatus === 'PENDING' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                color: filterStatus === 'PENDING' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              }}
              onClick={() => { setFilterStatus('PENDING'); setCurrentPage(1); }}
            >
              ⏳ Pending ({pendingClaims.length})
            </button>
            <button
              type="button"
              style={{
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                borderBottom: filterStatus === 'APPROVED' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                color: filterStatus === 'APPROVED' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              }}
              onClick={() => { setFilterStatus('APPROVED'); setCurrentPage(1); }}
            >
              ✅ Approved ({approvedClaims.length})
            </button>
            <button
              type="button"
              style={{
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                borderBottom: filterStatus === 'CORRECTION' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                color: filterStatus === 'CORRECTION' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              }}
              onClick={() => { setFilterStatus('CORRECTION'); setCurrentPage(1); }}
            >
              ↺ Returned ({correctionClaims.length})
            </button>
            <button
              type="button"
              style={{
                padding: '10px 14px',
                border: 'none',
                background: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                borderBottom: filterStatus === 'ALL' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                color: filterStatus === 'ALL' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              }}
              onClick={() => { setFilterStatus('ALL'); setCurrentPage(1); }}
            >
              All ({totalClaims})
            </button>
          </div>

          {/* Search bar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1, padding: '6px 10px', fontSize: '0.8125rem' }}
              placeholder="Search employee, merchant, or ID..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>

          {/* Queue Items List */}
          <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
            {paginatedReceipts.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📂</div>
                No expense receipts found matching criteria.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {paginatedReceipts.map((r) => {
                  const isSelected = selectedReceipt?.id === r.id;
                  const st = r.workflow_state || r.workflowState || 'DRAFT';
                  const amount = r.requestedAmount || r.totalAmount;
                  const currency = r.currency || 'INR';

                  return (
                    <div
                      key={r.id}
                      onClick={() => {
                        setSelectedReceipt(r);
                        if (onSelectReceipt) onSelectReceipt(r);
                      }}
                      style={{
                        padding: '14px 18px',
                        borderBottom: '1px solid var(--border-subtle)',
                        backgroundColor: isSelected ? 'var(--gold-bg-subtle)' : '#ffffff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        borderLeft: isSelected ? '4px solid var(--gold-primary)' : '4px solid transparent',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                            {r.merchantName || r.original_filename || r.originalFilename || 'Voucher'}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          👤 <strong>{r.employeeName || 'Employee'}</strong> &bull; {r.employeeEmail}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', fontSize: '0.75rem' }}>
                          {amount !== null && amount !== undefined ? (
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              {currency} {Number(amount).toFixed(2)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Amount pending</span>
                          )}

                          <span style={{ color: 'var(--text-muted)' }}>
                            &bull; {new Date(r.created_at || r.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <span
                          className={`status-pill ${
                            st === 'APPROVED'
                              ? 'approved'
                              : st === 'PENDING_APPROVAL'
                              ? 'pending'
                              : st === 'CORRECTION_REQUESTED'
                              ? 'correction'
                              : st === 'REJECTED'
                              ? 'rejected'
                              : 'draft'
                          }`}
                        >
                          {st.replace('_', ' ')}
                        </span>

                        {r.validationStatus && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: r.validationStatus === 'PASSED' ? '#ecfdf5' : '#fffbeb',
                              color: r.validationStatus === 'PASSED' ? '#065f46' : '#92400e',
                              fontWeight: 600,
                            }}
                          >
                            {r.validationStatus === 'PASSED' ? 'Policy Pass' : 'Policy Flag'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination Footer */}
          {totalFiltered > 0 && (
            <div
              style={{
                padding: '10px 16px',
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
                Page {safePage} of {totalPages} ({totalFiltered} items)
              </span>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    background: '#ffffff',
                  }}
                >
                  <option value={5}>5 / page</option>
                  <option value={10}>10 / page</option>
                  <option value={20}>20 / page</option>
                </select>

                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  ◀ Prev
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next ▶
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Active Inspector */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedReceipt ? (
            <ReceiptView
              receipt={selectedReceipt}
              authToken={authToken}
              currentUser={currentUser}
              onWorkflowUpdated={fetchPendingReceipts}
            />
          ) : (
            <div className="table-card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🛡️</div>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '6px' }}>
                Manager Decision Workspace
              </h3>
              <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.875rem' }}>
                Select an expense claim from the queue to inspect physical scans, verify policy validation results, and sign off on approvals, corrections, or rejections.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
