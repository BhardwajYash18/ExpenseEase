import React, { useState, useEffect } from 'react';
import ReceiptView from './ReceiptView';

export default function ManagerApprovalsView({ authToken, currentUser, onSelectReceipt }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  async function fetchPendingReceipts() {
    if (!authToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/receipts', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.receipts || [];
        setReceipts(list);
        if (list.length > 0 && !selectedReceipt) {
          setSelectedReceipt(list[0]);
        }
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

  // Derived metrics from real receipts
  const totalClaims = receipts.length;
  const pendingClaims = receipts.filter((r) => r.workflow_state === 'PENDING_APPROVAL' || r.workflowState === 'PENDING_APPROVAL');
  const approvedClaims = receipts.filter((r) => r.workflow_state === 'APPROVED' || r.workflowState === 'APPROVED');
  const rejectedClaims = receipts.filter((r) => r.workflow_state === 'REJECTED' || r.workflowState === 'REJECTED');

  const filteredReceipts = receipts.filter((r) => {
    const st = r.workflow_state || r.workflowState || 'DRAFT';
    if (filterStatus === 'PENDING' && st !== 'PENDING_APPROVAL') return false;
    if (filterStatus === 'APPROVED' && st !== 'APPROVED') return false;
    if (filterStatus === 'REJECTED' && st !== 'REJECTED') return false;
    if (filterText) {
      const search = filterText.toLowerCase();
      const name = (r.original_filename || r.originalFilename || '').toLowerCase();
      const id = (r.id || '').toLowerCase();
      return name.includes(search) || id.includes(search);
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Manager Metrics Row (Stitch Screen 3) */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Pending Claims</span>
            <span className="stat-icon">⏳</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{pendingClaims.length}</div>
            <span className="stat-subtext status-pill pending">Action Req</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Approved Claims</span>
            <span className="stat-icon">✅</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{approvedClaims.length}</div>
            <span className="stat-subtext status-pill approved">Within Policy</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Rejected Claims</span>
            <span className="stat-icon">❌</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{rejectedClaims.length}</div>
            <span className="stat-subtext status-pill rejected">Non-compliant</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-title">Total Tenant Outlay</span>
            <span className="stat-icon">📊</span>
          </div>
          <div className="stat-body">
            <div className="stat-value">{totalClaims} total</div>
            <span className="stat-subtext status-pill draft">Active Pool</span>
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
                {filteredReceipts.length} expense claims available
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={fetchPendingReceipts}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1, minWidth: '140px', padding: '6px 10px', fontSize: '0.8125rem' }}
              placeholder="Search filename or ID..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <select
              className="form-select"
              style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8125rem' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending Only</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {filteredReceipts.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No expense receipts found matching criteria.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredReceipts.map((r) => {
                  const isSelected = selectedReceipt?.id === r.id;
                  const st = r.workflow_state || r.workflowState || 'DRAFT';
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
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderLeft: isSelected ? '4px solid var(--gold-primary)' : '4px solid transparent',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '10px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.original_filename || r.originalFilename || 'Receipt Voucher'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          ID: {r.id.slice(0, 8)}... &bull; {new Date(r.created_at || r.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={`status-pill ${st === 'APPROVED' ? 'approved' : st === 'PENDING_APPROVAL' ? 'pending' : st === 'REJECTED' ? 'rejected' : 'draft'}`}>
                        {st.replace('_', ' ')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
              Select an expense claim from the queue to inspect details and record decisions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
