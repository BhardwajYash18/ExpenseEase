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
  IconCoins,
} from './Icons';

export default function ManagerApprovalsView({ authToken, currentUser, onSelectReceipt }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [filterText, setFilterText] = useState('');

  // Primary workflow state filter: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'
  const [claimStatusTab, setClaimStatusTab] = useState('PENDING');

  // Policy validation sub-filter: 'ALL' | 'POLICY_PASS' | 'POLICY_FLAG'
  const [policySubFilter, setPolicySubFilter] = useState('ALL');

  // Sorting: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'employee_asc'
  const [sortBy, setSortBy] = useState('date_desc');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [focusMode, setFocusMode] = useState(false);

  async function fetchAllReceipts() {
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
    fetchAllReceipts();
  }, [authToken]);

  // Derived metrics from all tenant receipts
  const pendingClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'PENDING_APPROVAL'
  );
  const approvedClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'APPROVED'
  );
  const rejectedClaims = receipts.filter(
    (r) => (r.workflow_state || r.workflowState) === 'REJECTED'
  );

  const policyPassedClaims = receipts.filter(
    (r) => r.validationStatus === 'PASSED'
  );
  const policyFlaggedClaims = receipts.filter(
    (r) => r.validationStatus && r.validationStatus !== 'PASSED'
  );

  // Filtered dataset
  const filteredReceipts = receipts.filter((r) => {
    const st = r.workflow_state || r.workflowState || 'DRAFT';

    // 1. Workflow status tab filter
    if (claimStatusTab === 'PENDING' && st !== 'PENDING_APPROVAL') return false;
    if (claimStatusTab === 'APPROVED' && st !== 'APPROVED') return false;
    if (claimStatusTab === 'REJECTED' && st !== 'REJECTED') return false;

    // 2. Policy sub-filter
    if (policySubFilter === 'POLICY_PASS' && r.validationStatus !== 'PASSED') return false;
    if (policySubFilter === 'POLICY_FLAG' && (!r.validationStatus || r.validationStatus === 'PASSED')) return false;

    // 3. Search query
    if (filterText.trim()) {
      const search = filterText.toLowerCase().trim();
      const filename = (r.original_filename || r.originalFilename || '').toLowerCase();
      const merchant = (r.merchantName || '').toLowerCase();
      const empName = (r.employeeName || '').toLowerCase();
      const empEmail = (r.employeeEmail || '').toLowerCase();
      const category = (r.category || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      return (
        filename.includes(search) ||
        merchant.includes(search) ||
        empName.includes(search) ||
        empEmail.includes(search) ||
        category.includes(search) ||
        id.includes(search)
      );
    }
    return true;
  });

  // Sort filtered dataset
  const sortedReceipts = [...filteredReceipts].sort((a, b) => {
    const amtA = a.requestedAmount !== null && a.requestedAmount !== undefined
      ? a.requestedAmount
      : (a.totalAmount || 0);
    const amtB = b.requestedAmount !== null && b.requestedAmount !== undefined
      ? b.requestedAmount
      : (b.totalAmount || 0);

    if (sortBy === 'amount_desc') return amtB - amtA;
    if (sortBy === 'amount_asc') return amtA - amtB;
    if (sortBy === 'employee_asc') {
      return (a.employeeName || '').localeCompare(b.employeeName || '');
    }
    if (sortBy === 'date_asc') {
      return new Date(a.created_at || a.createdAt || 0) - new Date(b.created_at || b.createdAt || 0);
    }
    // Default: 'date_desc'
    return new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0);
  });

  // Active sum of currently displayed claims
  const currentTotalAmount = sortedReceipts.reduce((sum, r) => {
    const val = r.requestedAmount !== null && r.requestedAmount !== undefined
      ? r.requestedAmount
      : (r.totalAmount || 0);
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  // Client-side pagination slice
  const totalFiltered = sortedReceipts.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedReceipts = sortedReceipts.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Manager Metrics Row: Interactive KPI Cards */}
      <div className="stats-grid">
        {/* Metric 1: Pending Approvals */}
        <div
          className={`stat-card ${claimStatusTab === 'PENDING' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
          onClick={() => {
            setClaimStatusTab('PENDING');
            setPolicySubFilter('ALL');
            setCurrentPage(1);
          }}
          title="Click to view Pending Approvals"
        >
          <div className="stat-header">
            <span className="stat-title">Pending Approvals</span>
            <span className="stat-icon"><IconClock size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{pendingClaims.length}</div>
            <span className="stat-subtext status-pill pending">Awaiting Sign-off</span>
          </div>
        </div>

        {/* Metric 2: Approved History */}
        <div
          className={`stat-card ${claimStatusTab === 'APPROVED' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
          onClick={() => {
            setClaimStatusTab('APPROVED');
            setPolicySubFilter('ALL');
            setCurrentPage(1);
          }}
          title="Click to view Approved Claims History"
        >
          <div className="stat-header">
            <span className="stat-title">Approved History</span>
            <span className="stat-icon"><IconCheckCircle size={20} color="#10b981" /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{approvedClaims.length}</div>
            <span className="stat-subtext status-pill approved">Approved Claims</span>
          </div>
        </div>

        {/* Metric 3: Rejected History */}
        <div
          className={`stat-card ${claimStatusTab === 'REJECTED' ? 'active-metric-card' : ''}`}
          style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
          onClick={() => {
            setClaimStatusTab('REJECTED');
            setPolicySubFilter('ALL');
            setCurrentPage(1);
          }}
          title="Click to view Rejected Claims History"
        >
          <div className="stat-header">
            <span className="stat-title">Rejected History</span>
            <span className="stat-icon"><IconXCircle size={20} color="#ef4444" /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{rejectedClaims.length}</div>
            <span className="stat-subtext status-pill rejected">Declined Claims</span>
          </div>
        </div>

        {/* Metric 4: Sum of Selected Tab */}
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">
              {claimStatusTab === 'APPROVED'
                ? 'Approved Total'
                : claimStatusTab === 'REJECTED'
                ? 'Rejected Total'
                : claimStatusTab === 'PENDING'
                ? 'Pending Claim Sum'
                : 'Selected Total'}
            </span>
            <span className="stat-icon"><IconCoins size={20} /></span>
          </div>
          <div className="stat-body">
            <div className="stat-value" style={{ fontSize: '1.35rem' }}>
              INR {currentTotalAmount.toFixed(2)}
            </div>
            <span className="stat-subtext status-pill draft">
              {totalFiltered} claims shown
            </span>
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
        {/* Left Panel: Active Queue & History (collapsible via focusMode) */}
        {!focusMode && (
          <div
            className="split-panel manager-queue-sidebar"
            style={{
              width: '380px',
              minWidth: '330px',
              maxWidth: '400px',
              flexShrink: 0,
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-xs)',
              overflow: 'hidden',
            }}
          >
            {/* Header bar */}
            <div className="split-panel-header">
              <div>
                <span className="split-panel-title">
                  {claimStatusTab === 'PENDING'
                    ? 'Pending Approvals Queue'
                    : claimStatusTab === 'APPROVED'
                    ? 'Approved Claims History'
                    : claimStatusTab === 'REJECTED'
                    ? 'Rejected Claims History'
                    : 'All Claims History'}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Showing {totalFiltered} {claimStatusTab.toLowerCase()} claims
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={fetchAllReceipts}
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

            {/* Top Primary Tabs: Pending | Approved | Rejected | All */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--border-subtle)',
                background: '#f8fafc',
                overflowX: 'auto',
              }}
            >
              <button
                type="button"
                style={{
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: claimStatusTab === 'PENDING' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                  color: claimStatusTab === 'PENDING' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => {
                  setClaimStatusTab('PENDING');
                  setCurrentPage(1);
                }}
                id="tab-pending-claims"
              >
                <IconClock size={13} /> Pending ({pendingClaims.length})
              </button>

              <button
                type="button"
                style={{
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: claimStatusTab === 'APPROVED' ? '2px solid #10b981' : '2px solid transparent',
                  color: claimStatusTab === 'APPROVED' ? '#047857' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => {
                  setClaimStatusTab('APPROVED');
                  setCurrentPage(1);
                }}
                id="tab-approved-history"
              >
                <IconCheckCircle size={13} color={claimStatusTab === 'APPROVED' ? '#10b981' : 'currentColor'} /> Approved ({approvedClaims.length})
              </button>

              <button
                type="button"
                style={{
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: claimStatusTab === 'REJECTED' ? '2px solid #ef4444' : '2px solid transparent',
                  color: claimStatusTab === 'REJECTED' ? '#b91c1c' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => {
                  setClaimStatusTab('REJECTED');
                  setCurrentPage(1);
                }}
                id="tab-rejected-history"
              >
                <IconXCircle size={13} color={claimStatusTab === 'REJECTED' ? '#ef4444' : 'currentColor'} /> Rejected ({rejectedClaims.length})
              </button>

              <button
                type="button"
                style={{
                  padding: '10px 12px',
                  border: 'none',
                  background: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: claimStatusTab === 'ALL' ? '2px solid var(--gold-primary)' : '2px solid transparent',
                  color: claimStatusTab === 'ALL' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                onClick={() => {
                  setClaimStatusTab('ALL');
                  setCurrentPage(1);
                }}
                id="tab-all-claims-history"
              >
                <IconClipboard size={13} /> All ({receipts.length})
              </button>
            </div>

            {/* Secondary Controls: Search & Sort Bar */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: '#ffffff',
              }}
            >
              {/* Search input */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1, padding: '6px 10px', fontSize: '0.8125rem' }}
                  placeholder="Search claimant, vendor, or ID..."
                  value={filterText}
                  onChange={(e) => {
                    setFilterText(e.target.value);
                    setCurrentPage(1);
                  }}
                  id="search-approvals-input"
                />
              </div>

              {/* Policy Sub-filter & Sorting */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.725rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: policySubFilter === 'ALL' ? 'var(--gold-bg-subtle)' : '#ffffff',
                      color: policySubFilter === 'ALL' ? 'var(--gold-hover)' : 'var(--text-secondary)',
                      fontWeight: policySubFilter === 'ALL' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPolicySubFilter('ALL');
                      setCurrentPage(1);
                    }}
                  >
                    All Policy
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.725rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: policySubFilter === 'POLICY_PASS' ? '#ecfdf5' : '#ffffff',
                      color: policySubFilter === 'POLICY_PASS' ? '#047857' : 'var(--text-secondary)',
                      fontWeight: policySubFilter === 'POLICY_PASS' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPolicySubFilter('POLICY_PASS');
                      setCurrentPage(1);
                    }}
                  >
                    Passed
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.725rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-subtle)',
                      background: policySubFilter === 'POLICY_FLAG' ? '#fffbeb' : '#ffffff',
                      color: policySubFilter === 'POLICY_FLAG' ? '#b45309' : 'var(--text-secondary)',
                      fontWeight: policySubFilter === 'POLICY_FLAG' ? 700 : 500,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setPolicySubFilter('POLICY_FLAG');
                      setCurrentPage(1);
                    }}
                  >
                    Flagged
                  </button>
                </div>

                {/* Sort selector */}
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: '3px 6px',
                    fontSize: '0.725rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    background: '#ffffff',
                    color: 'var(--text-secondary)',
                  }}
                  id="sort-approvals-select"
                >
                  <option value="date_desc">Newest Date</option>
                  <option value="date_asc">Oldest Date</option>
                  <option value="amount_desc">Amount (High &rarr; Low)</option>
                  <option value="amount_asc">Amount (Low &rarr; High)</option>
                  <option value="employee_asc">Claimant (A &rarr; Z)</option>
                </select>
              </div>
            </div>

            {/* Queue Items List */}
            <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
              {paginatedReceipts.length === 0 ? (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  <div style={{ marginBottom: '8px' }}><IconFolder size={32} /></div>
                  No claims found in {claimStatusTab.toLowerCase()} view matching criteria.
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
                        className={`queue-item-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedReceipt(r);
                          if (onSelectReceipt) onSelectReceipt(r);
                        }}
                        style={{
                          borderLeft: isSelected
                            ? st === 'APPROVED'
                              ? '4px solid #10b981'
                              : st === 'REJECTED'
                              ? '4px solid #ef4444'
                              : '4px solid var(--gold-primary)'
                            : '4px solid transparent',
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
                            {st === 'APPROVED' ? (
                              <><IconCheckCircle size={11} style={{ marginRight: 3 }} /> Approved</>
                            ) : st === 'REJECTED' ? (
                              <><IconXCircle size={11} style={{ marginRight: 3 }} /> Rejected</>
                            ) : (
                              st.replace('_', ' ')
                            )}
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
                <IconClipboard size={14} /> Show Approvals &amp; History ({totalFiltered} claims)
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
                      <IconChevronLeft size={14} /> Show Approvals &amp; History
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
                onWorkflowUpdated={fetchAllReceipts}
              />
            </div>
          ) : (
            <div className="table-card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: '12px' }}><IconShield size={36} color="var(--gold-hover)" /></div>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '6px' }}>
                Manager Decision &amp; History Workspace
              </h3>
              <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.875rem' }}>
                Select an expense claim from the queue or history to inspect physical scans, verify policy validation results, and sign off on approvals, corrections, or rejections.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
