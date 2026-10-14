import React, { useState, useEffect } from 'react';
import ReceiptView from './ReceiptView';
import {
  IconClock,
  IconCheckCircle,
  IconUndo,
  IconXCircle,
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconUser,
  IconLock,
  IconClipboard,
  IconSearch,
  IconSplit,
  IconMaximize,
  IconShield,
} from './Icons';

export default function ManagerApprovalsView({ authToken, currentUser, onSelectReceipt }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('PENDING'); // Default to PENDING claims for action

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [focusMode, setFocusMode] = useState(false);
  const showQueueSidebar = !focusMode;
  const setShowQueueSidebar = (show) => setFocusMode(!show);

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
  // Metrics derived from pending submitted approvals queue
  const totalClaims = receipts.length;
  const policyPassedClaims = receipts.filter(
    (r) => r.validationStatus === 'PASSED'
  );
  const policyFlaggedClaims = receipts.filter(
    (r) => r.validationStatus && r.validationStatus !== 'PASSED'
  );
  const queueTotalAmount = receipts.reduce((sum, r) => {
    const val = r.requestedAmount !== null && r.requestedAmount !== undefined
      ? r.requestedAmount
      : (r.totalAmount || 0);
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  // Filtered dataset
  const filteredReceipts = receipts.filter((r) => {
    if (filterStatus === 'POLICY_PASS' && r.validationStatus !== 'PASSED') return false;
    if (filterStatus === 'POLICY_FLAG' && (!r.validationStatus || r.validationStatus === 'PASSED')) return false;

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
      {/* Top Manager Metrics Row: Pending Submitted Approvals Queue */}
      <div className="stats-grid">
        <div
          className={`stat-card ${filterStatus === 'ALL' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('ALL');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Pending Approvals</span>
            <span className="stat-icon"><IconClock size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{totalClaims}</div>
            <span className="stat-subtext status-pill pending">Awaiting Sign-off</span>
          </div>
        </div>

        <div
          className={`stat-card ${filterStatus === 'POLICY_PASS' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('POLICY_PASS');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Policy Compliant</span>
            <span className="stat-icon"><IconCheckCircle size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{policyPassedClaims.length}</div>
            <span className="stat-subtext status-pill approved">Within Guidelines</span>
          </div>
        </div>

        <div
          className={`stat-card ${filterStatus === 'POLICY_FLAG' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setFilterStatus('POLICY_FLAG');
            setCurrentPage(1);
          }}
        >
          <div className="stat-header">
            <span className="stat-title">Review Flags</span>
            <span className="stat-icon"><IconShield size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{policyFlaggedClaims.length}</div>
            <span className="stat-subtext status-pill correction">Requires Verification</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Queue Claim Total</span>
            <span className="stat-icon"><IconClipboard size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value" style={{ fontSize: '1.35rem' }}>
              INR {queueTotalAmount.toFixed(2)}
            </div>
            <span className="stat-subtext status-pill draft">Active Pending Sum</span>
          </div>
        </div>
      </div>

      {/* Main Two-Panel Layout (Active Queue + Active Inspector) */}
      <div
        className="manager-approvals-workspace"
        style={{
          display: 'flex',
          gap: '20px',
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        {/* Left Panel: Active Queue (collapsible via focusMode / showQueueSidebar) */}
        {!focusMode && (
          <div
            className="split-panel manager-queue-sidebar"
            style={{
              width: '360px',
              minWidth: '320px',
              maxWidth: '380px',
              flexShrink: 0,
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-xs)',
              overflow: 'hidden',
            }}
          >
            <div className="split-panel-header">
              <div>
                <span className="split-panel-title">Manager Approvals Queue</span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Showing {totalFiltered} {filterStatus === 'ALL' ? 'total' : filterStatus.toLowerCase()} expense claims
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={fetchPendingReceipts}
                  disabled={loading}
                  title="Refresh Queue"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <IconRefresh size={13} className={loading ? 'spin' : ''} />
                  <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setFocusMode(true)}
                  title="Collapse Queue for Wide Inspector"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <IconChevronLeft size={13} />
                  <span>Hide</span>
                </button>
              </div>
            </div>

            {/* Quick Filter Tabs for Pending Submitted Approvals Queue */}
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
                  borderBottom: filterStatus === 'ALL' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                  color: filterStatus === 'ALL' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => { setFilterStatus('ALL'); setCurrentPage(1); }}
              >
                <IconClock size={13} /> All Pending ({totalClaims})
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
                  borderBottom: filterStatus === 'POLICY_PASS' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                  color: filterStatus === 'POLICY_PASS' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => { setFilterStatus('POLICY_PASS'); setCurrentPage(1); }}
              >
                <IconCheckCircle size={13} /> Policy Passed ({policyPassedClaims.length})
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
                  borderBottom: filterStatus === 'POLICY_FLAG' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                  color: filterStatus === 'POLICY_FLAG' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => { setFilterStatus('POLICY_FLAG'); setCurrentPage(1); }}
              >
                <IconShield size={13} /> Flagged ({policyFlaggedClaims.length})
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
            <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
              {paginatedReceipts.length === 0 ? (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  <div style={{ marginBottom: '8px' }}><IconFolder size={32} /></div>
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

                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <IconUser size={12} />
                              <strong>{r.employeeName || 'Employee'}</strong> &bull; {r.employeeEmail}
                            </span>
                            {currentUser?.id && (r.uploaded_by === currentUser.id || r.uploadedBy === currentUser.id) && (
                              <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <IconLock size={10} /> Your Claim (No Self-Review)
                              </span>
                            )}
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
                    style={{ padding: '2px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <IconChevronLeft size={11} /> Prev
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '2px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <IconChevronRight size={11} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right Panel: Active Inspector (Takes all remaining space or full width) */}
        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
          {focusMode && (
            <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                id="btn-show-manager-queue"
                onClick={() => setFocusMode(false)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <IconClipboard size={14} /> Show Approvals Queue ({totalFiltered} claims)
              </button>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <IconSearch size={14} /> Wide Inspector Mode Active
              </span>
            </div>
          )}
          {selectedReceipt ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Header Navigation with Focus Mode Toggle */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#ffffff',
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {focusMode ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setFocusMode(false)}
                      style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <IconChevronLeft size={14} /> Show Approvals Queue
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      Manager Review Studio &bull; Inspecting claim by <strong>{selectedReceipt.employeeName || 'Employee'}</strong>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setFocusMode(!focusMode)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                  title={focusMode ? "Restore Side-by-Side Queue List" : "Expand to Fullscreen View"}
                >
                  {focusMode ? (
                    <><IconSplit size={14} /> Show Queue (Split)</>
                  ) : (
                    <><IconMaximize size={14} /> Full Focus Mode</>
                  )}
                </button>
              </div>

              <ReceiptView
                receipt={selectedReceipt}
                authToken={authToken}
                currentUser={currentUser}
                onWorkflowUpdated={fetchPendingReceipts}
              />
            </div>
          ) : (
            <div className="table-card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: '12px' }}><IconShield size={36} color="var(--gold-hover)" /></div>
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
