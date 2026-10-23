import React, { useState, useEffect } from 'react';
import {
  IconRefresh,
  IconCheckCircle,
  IconXCircle,
  IconEye,
  IconMail,
  IconBuilding,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
} from './Icons';

export default function FinanceReimbursementView({ authToken, currentUser }) {
  const [activeTab, setActiveTab] = useState('reimbursements'); // 'reimbursements' | 'email-logs' | 'org-ledger'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // --- 1. Reimbursements Summary State ---
  const [reimbursementData, setReimbursementData] = useState({ summaries: [], organizationName: 'ExpenseEase' });
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null);

  // --- Email Preview & Send Modal State ---
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailType, setEmailType] = useState('REIMBURSEMENT_NOTIFICATION'); // 'REIMBURSEMENT_APPROVED' | 'REIMBURSEMENT_PAID' | 'REIMBURSEMENT_NOTIFICATION'
  const [customNotes, setCustomNotes] = useState('');
  const [emailPreview, setEmailPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);

  // --- 2. Email Logs State ---
  const [emailLogs, setEmailLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [inspectLog, setInspectLog] = useState(null);

  // --- 3. Organization Expenses Ledger State ---
  const [orgExpenses, setOrgExpenses] = useState([]);
  const [orgTotal, setOrgTotal] = useState(0);
  const [orgPage, setOrgPage] = useState(1);
  const [orgPageSize, setOrgPageSize] = useState(10);
  const [orgStatusFilter, setOrgStatusFilter] = useState('ALL');
  const [orgClaimTypeFilter, setOrgClaimTypeFilter] = useState('ALL'); // 'ALL' | 'REIMBURSEMENT' | 'NON_REIMBURSABLE'
  const [orgSearch, setOrgSearch] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(false);

  // --- Record Payment Modal State ---
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentClaim, setPaymentClaim] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('DIRECT_DEPOSIT');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Fetch summaries
  async function fetchReimbursements() {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/finance/reimbursements/summary${q}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch reimbursement summary');
      const data = await res.json();
      setReimbursementData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Fetch email logs
  async function fetchEmailLogs() {
    if (!authToken) return;
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/finance/reimbursements/email-logs', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEmailLogs(data.emailLogs || []);
      }
    } catch {
      // quiet fail
    } finally {
      setLoadingLogs(false);
    }
  }

  // Fetch organization expenses
  async function fetchOrgExpenses() {
    if (!authToken) return;
    setLoadingOrg(true);
    try {
      const params = new URLSearchParams({
        page: orgPage,
        pageSize: orgPageSize,
        status: orgStatusFilter,
      });
      if (orgClaimTypeFilter !== 'ALL') {
        params.append('claimType', orgClaimTypeFilter);
      }
      const res = await fetch(`/api/finance/expenses?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrgExpenses(data.receipts || []);
        setOrgTotal(data.total || 0);
      }
    } catch {
      // quiet fail
    } finally {
      setLoadingOrg(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'reimbursements') {
      fetchReimbursements();
    } else if (activeTab === 'email-logs') {
      fetchEmailLogs();
    } else if (activeTab === 'org-ledger') {
      fetchOrgExpenses();
    }
  }, [authToken, activeTab, statusFilter, orgPage, orgPageSize, orgStatusFilter, orgClaimTypeFilter]);

  // Handle preview generation
  async function handleOpenEmailModal() {
    if (selectedEmployees.size === 0) return;
    setShowEmailModal(true);
    setLoadingPreview(true);
    setEmailPreview(null);
    try {
      // Use the first selected employee for preview rendering
      const firstEmpId = Array.from(selectedEmployees)[0];
      const empData = reimbursementData.summaries.find((s) => s.employeeId === firstEmpId);
      const claimIds = (empData?.claims || []).map((c) => c.receiptId);

      const res = await fetch('/api/finance/reimbursements/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employeeId: firstEmpId,
          claimIds,
          emailType,
          customNotes,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to generate email preview');
      }
      const data = await res.json();
      setEmailPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  }

  // Re-fetch preview when emailType or notes change inside modal
  useEffect(() => {
    if (showEmailModal && selectedEmployees.size > 0) {
      const timer = setTimeout(() => {
        handleOpenEmailModal();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [emailType, customNotes]);

  // Handle sending emails
  async function handleSendEmails() {
    if (selectedEmployees.size === 0) return;
    setSendingEmails(true);
    setError(null);
    try {
      const employeeIds = Array.from(selectedEmployees);
      const claimIdsByEmployee = {};
      for (const empId of employeeIds) {
        const emp = reimbursementData.summaries.find((s) => s.employeeId === empId);
        claimIdsByEmployee[empId] = (emp?.claims || []).map((c) => c.receiptId);
      }

      const idempotencyKey = `reimb-email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      const res = await fetch('/api/finance/reimbursements/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employeeIds,
          claimIdsByEmployee,
          emailType,
          customNotes,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to send reimbursement emails');

      const isSim = data.results?.[0]?.deliveryMode === 'SIMULATED';
      setSuccessMsg(
        isSim
          ? `Successfully simulated ${data.sentCount} individual employee email notification(s). Logged safely to audit history.`
          : `Successfully transmitted ${data.sentCount} individual employee email notification(s).`
      );
      setShowEmailModal(false);
      setSelectedEmployees(new Set());
      fetchReimbursements();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingEmails(false);
    }
  }

  // Open Record Payment modal
  function handleOpenPaymentModal(claim) {
    setPaymentClaim(claim);
    setPaymentAmount(claim.outstandingAmount || claim.totalAmount || '0.00');
    setPaymentMethod('DIRECT_DEPOSIT');
    setPaymentReference('');
    setPaymentNotes('');
    setShowPaymentModal(true);
  }

  // Submit payment record
  async function handleRecordPaymentSubmit(e) {
    e.preventDefault();
    if (!paymentClaim) return;
    setRecordingPayment(true);
    setError(null);
    try {
      const res = await fetch('/api/finance/reimbursements/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receiptId: paymentClaim.receiptId || paymentClaim.id,
          amount: parseFloat(paymentAmount),
          paymentMethod,
          paymentReference: paymentReference.trim() || null,
          notes: paymentNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to record payment');

      setSuccessMsg(
        `Payment of ${paymentAmount} recorded. Reimbursement status updated to ${data.newReimbursementStatus}.`
      );
      setShowPaymentModal(false);
      setPaymentClaim(null);
      if (activeTab === 'reimbursements') fetchReimbursements();
      if (activeTab === 'org-ledger') fetchOrgExpenses();
    } catch (err) {
      setError(err.message);
    } finally {
      setRecordingPayment(false);
    }
  }

  // Select/Deselect All
  const allEmployeeIds = reimbursementData.summaries.map((s) => s.employeeId);
  const isAllSelected = allEmployeeIds.length > 0 && allEmployeeIds.every((id) => selectedEmployees.has(id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(allEmployeeIds));
    }
  };

  const toggleSelectEmp = (id) => {
    setSelectedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Tab Navigation */}
      <div
        className="table-card"
        style={{
          display: 'flex',
          gap: '8px',
          padding: '8px 12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'reimbursements' ? 'btn-gold' : 'btn-outline'}`}
            onClick={() => setActiveTab('reimbursements')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconMail size={14} /> Reimbursement Email Center
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'email-logs' ? 'btn-gold' : 'btn-outline'}`}
            onClick={() => setActiveTab('email-logs')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconBuilding size={14} /> Email Audit History ({emailLogs.length})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'org-ledger' ? 'btn-gold' : 'btn-outline'}`}
            onClick={() => setActiveTab('org-ledger')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconBuilding size={14} /> Organization Expense Ledger
          </button>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            if (activeTab === 'reimbursements') fetchReimbursements();
            else if (activeTab === 'email-logs') fetchEmailLogs();
            else fetchOrgExpenses();
          }}
          disabled={loading || loadingLogs || loadingOrg}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <IconRefresh size={13} className={loading || loadingLogs || loadingOrg ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="alert alert-danger" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>
      )}

      {/* =========================================================================
          TAB 1: REIMBURSEMENT EMAIL CENTER (Feature A)
          ========================================================================= */}
      {activeTab === 'reimbursements' && (
        <div className="table-card">
          <div className="table-header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <span className="table-title">Employee Reimbursements &amp; Notification Center</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Aggregate approved expense claims, review outstanding balances, and send personalized notification emails.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="form-select"
                style={{ width: 'auto', fontSize: '0.8125rem', padding: '6px 10px' }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Reimbursement Statuses</option>
                <option value="UNPAID">Unpaid Only</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PAID">Fully Paid</option>
              </select>

              <button
                type="button"
                className="btn btn-gold btn-sm"
                onClick={handleOpenEmailModal}
                disabled={selectedEmployees.size === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <IconMail size={14} />
                Preview &amp; Send Emails ({selectedEmployees.size} Selected)
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading reimbursement balances...
            </div>
          ) : reimbursementData.summaries.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No approved expense claims matching the selected filter. Only management-approved claims are reimbursable.
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        title="Select All Employees"
                      />
                    </th>
                    <th>Employee</th>
                    <th style={{ textAlign: 'center' }}>Claims</th>
                    <th style={{ textAlign: 'right' }}>Total Approved</th>
                    <th style={{ textAlign: 'right' }}>Reimbursed</th>
                    <th style={{ textAlign: 'right' }}>Outstanding Balance</th>
                    <th style={{ textAlign: 'center' }}>Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {reimbursementData.summaries.map((emp) => {
                    const isSelected = selectedEmployees.has(emp.employeeId);
                    const isExpanded = expandedEmployeeId === emp.employeeId;

                    return (
                      <React.Fragment key={emp.employeeId}>
                        <tr style={{ background: isSelected ? '#fefce8' : 'inherit' }}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectEmp(emp.employeeId)}
                            />
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{emp.employeeName}</div>
                            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{emp.employeeEmail}</div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="status-pill pending" style={{ fontSize: '0.75rem' }}>
                              {emp.claimCount} claim{emp.claimCount !== 1 ? 's' : ''}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {emp.currency} {Number(emp.totalApprovedAmount).toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right', color: '#16a34a' }}>
                            {emp.currency} {Number(emp.totalReimbursedAmount).toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: Number(emp.totalOutstandingAmount) > 0 ? '#b45309' : 'var(--text-muted)' }}>
                            {emp.currency} {Number(emp.totalOutstandingAmount).toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                              onClick={() => setExpandedEmployeeId(isExpanded ? null : emp.employeeId)}
                            >
                              {isExpanded ? 'Hide Claims ▲' : 'View Claims ▼'}
                            </button>
                          </td>
                        </tr>

                        {/* Claims Accordion */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} style={{ background: '#f8fafc', padding: '12px 18px' }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                                Approved Vouchers for {emp.employeeName}:
                              </div>
                              <table style={{ width: '100%', fontSize: '0.775rem', borderCollapse: 'collapse', background: '#ffffff', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                                <thead>
                                  <tr style={{ background: '#f1f5f9', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Merchant / Voucher</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Category</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Approved Date</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Approved Amount</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Reimbursed</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'center' }}>Status</th>
                                    <th style={{ padding: '6px 10px', textAlign: 'center' }}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {emp.claims.map((c) => (
                                    <tr key={c.receiptId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{c.merchant}</td>
                                      <td style={{ padding: '6px 10px' }}>{c.category}</td>
                                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                                        {c.approvedAt ? new Date(c.approvedAt).toLocaleDateString() : '—'}
                                      </td>
                                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>
                                        {c.currency} {Number(c.approvedAmount).toFixed(2)}
                                      </td>
                                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#16a34a' }}>
                                        {c.currency} {Number(c.reimbursedAmount).toFixed(2)}
                                      </td>
                                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                        <span className={`status-pill ${c.reimbursementStatus === 'PAID' ? 'approved' : c.reimbursementStatus === 'PARTIALLY_PAID' ? 'correction' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                                          {c.reimbursementStatus}
                                        </span>
                                      </td>
                                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                        {c.reimbursementStatus !== 'PAID' && (
                                          <button
                                            type="button"
                                            className="btn btn-outline btn-sm"
                                            style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                            onClick={() => handleOpenPaymentModal(c)}
                                          >
                                            Record Payment
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: EMAIL AUDIT LOGS (Feature A Auditability)
          ========================================================================= */}
      {activeTab === 'email-logs' && (
        <div className="table-card">
          <div className="table-header-bar">
            <div>
              <span className="table-title">Reimbursement Email Delivery Logs</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Complete audit history of all reimbursement notifications, simulated mock events, and delivery attempts.
              </div>
            </div>
          </div>

          {loadingLogs ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading email logs...</div>
          ) : emailLogs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              No reimbursement emails logged yet. Select employees from the Reimbursement Center to dispatch notifications.
            </div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Recipient</th>
                    <th>Type</th>
                    <th>Delivery Mode</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Sent By</th>
                    <th style={{ textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{log.employeeName}</div>
                        <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{log.recipientEmail}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {log.emailType.replace('REIMBURSEMENT_', '')}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${log.deliveryMode === 'REAL' ? 'approved' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                          {log.deliveryMode}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${log.status === 'SENT' ? 'approved' : log.status === 'MOCK_SENT' ? 'pending' : 'rejected'}`} style={{ fontSize: '0.7rem' }}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {log.currency} {Number(log.totalAmount).toFixed(2)}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{log.senderName}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                          onClick={() => setInspectLog(log)}
                        >
                          View Email
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

      {/* =========================================================================
          TAB 3: ORGANIZATION EXPENSE LEDGER (Feature B)
          ========================================================================= */}
      {activeTab === 'org-ledger' && (
        <div className="table-card">
          <div className="table-header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <span className="table-title">Organization-Wide Expense Records</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Unified ledger of all employee claims across the organization, subject to PostgreSQL RLS tenant isolation.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search vendor, file, employee..."
                className="form-input"
                style={{ width: '220px', fontSize: '0.8125rem', padding: '6px 10px' }}
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
              />

              <select
                className="form-select"
                style={{ width: 'auto', fontSize: '0.8125rem', padding: '6px 10px' }}
                value={orgClaimTypeFilter}
                onChange={(e) => {
                  setOrgClaimTypeFilter(e.target.value);
                  setOrgPage(1);
                }}
              >
                <option value="ALL">All Record Types</option>
                <option value="REIMBURSEMENT">Reimbursement Claims</option>
                <option value="NON_REIMBURSABLE">Non-Reimbursable (Recordkeeping)</option>
              </select>

              <select
                className="form-select"
                style={{ width: 'auto', fontSize: '0.8125rem', padding: '6px 10px' }}
                value={orgStatusFilter}
                onChange={(e) => {
                  setOrgStatusFilter(e.target.value);
                  setOrgPage(1);
                }}
              >
                <option value="ALL">All Workflow States</option>
                <option value="DOCUMENTED">Documented (Recordkeeping)</option>
                <option value="PENDING_APPROVAL">Pending Approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CORRECTION_REQUESTED">Correction Requested</option>
              </select>
            </div>
          </div>

          {loadingOrg ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading organization ledger...</div>
          ) : orgExpenses.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No expense claims found matching filter.</div>
          ) : (
            <>
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Employee</th>
                      <th>Merchant / Voucher</th>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'center' }}>Approval State</th>
                      <th style={{ textAlign: 'center' }}>Reimbursement</th>
                      <th style={{ textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgExpenses
                      .filter((r) => {
                        if (!orgSearch) return true;
                        const s = orgSearch.toLowerCase();
                        return (
                          (r.merchantName || '').toLowerCase().includes(s) ||
                          (r.employeeName || '').toLowerCase().includes(s) ||
                          (r.originalFilename || '').toLowerCase().includes(s) ||
                          (r.orgReference || '').toLowerCase().includes(s)
                        );
                      })
                      .map((r) => {
                        const st = r.workflowState || 'DRAFT';
                        const isNonReimbursable = r.claimType === 'NON_REIMBURSABLE';
                        return (
                          <tr key={r.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                              {new Date(r.createdAt).toLocaleDateString()}
                            </td>
                            <td>
                              {isNonReimbursable ? (
                                <div>
                                  <span className="status-pill" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #86efac', fontSize: '0.65rem', fontWeight: 700 }}>
                                    RECORDKEEPING
                                  </span>
                                  {r.orgReference && (
                                    <div style={{ fontSize: '0.675rem', color: '#15803d', marginTop: '2px' }}>
                                      Ref: {r.orgReference}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="status-pill" style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', fontSize: '0.65rem', fontWeight: 600 }}>
                                  REIMBURSEMENT
                                </span>
                              )}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{r.employeeName}</div>
                              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{r.employeeEmail}</div>
                            </td>
                            <td style={{ fontWeight: 600 }}>{r.merchantName || r.originalFilename || 'Receipt Image'}</td>
                            <td>{r.category || 'Other'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                              {r.currency || 'USD'} {Number(r.totalAmount || 0).toFixed(2)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`status-pill ${st === 'APPROVED' ? 'approved' : st === 'DOCUMENTED' ? 'approved' : st === 'PENDING_APPROVAL' ? 'pending' : st === 'REJECTED' ? 'rejected' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                                {st.replace('_', ' ')}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {isNonReimbursable ? (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>N/A (No Payout)</span>
                              ) : (
                                <span className="status-pill draft" style={{ fontSize: '0.7rem' }}>
                                  {r.workflowState === 'APPROVED' ? 'APPROVED' : 'UNELIGIBLE'}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {!isNonReimbursable && st === 'APPROVED' && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                                  onClick={() => handleOpenPaymentModal(r)}
                                >
                                  Record Payment
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>Showing {orgExpenses.length} of {orgTotal} entries</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={orgPage <= 1} onClick={() => setOrgPage((p) => Math.max(1, p - 1))}>
                    <IconChevronLeft size={11} /> Prev
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={orgExpenses.length < orgPageSize} onClick={() => setOrgPage((p) => p + 1)}>
                    Next <IconChevronRight size={11} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* =========================================================================
          MODAL: EMAIL PREVIEW & SEND
          ========================================================================= */}
      {showEmailModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '680px', width: '100%' }}>
            <div className="modal-header">
              <span className="modal-title">Preview &amp; Send Reimbursement Notifications</span>
              <button type="button" className="btn-close" onClick={() => setShowEmailModal(false)}>&times;</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                <div>Selected Recipients: <strong>{selectedEmployees.size} individual employee(s)</strong></div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Each employee will receive their own personalized breakdown. No recipient can see another employee's expenses.
                </div>
              </div>

              {/* Email Type Selection */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Notification Purpose</label>
                <select
                  className="form-select"
                  value={emailType}
                  onChange={(e) => setEmailType(e.target.value)}
                >
                  <option value="REIMBURSEMENT_APPROVED">Reimbursement Approved (Informs claim approved; payment pending)</option>
                  <option value="REIMBURSEMENT_PAID">Reimbursement Paid (Confirms payment processed with reference)</option>
                  <option value="REIMBURSEMENT_NOTIFICATION">General Reimbursement Notification (Status update)</option>
                </select>
              </div>

              {/* Custom Notes */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Custom Finance Notes (Optional)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder="e.g. Approved in Payroll Cycle #14. Expected direct deposit settlement by Friday."
                />
              </div>

              {/* Live Preview Box */}
              <div>
                <label className="form-label" style={{ fontWeight: 600 }}>Live Message Preview (Sample for First Recipient)</label>
                {loadingPreview ? (
                  <div style={{ padding: '20px', textAlign: 'center', background: '#f8fafc', borderRadius: 'var(--radius-sm)' }}>Generating live preview...</div>
                ) : emailPreview ? (
                  <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: '#ffffff', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.75rem' }}>
                      <div><strong>To:</strong> {emailPreview.recipientEmail}</div>
                      <div><strong>Subject:</strong> {emailPreview.subject}</div>
                      {emailPreview.isSimulated && (
                        <div style={{ color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                          Mode: SIMULATED (No external SMTP configured; logged safely in audit history)
                        </div>
                      )}
                    </div>
                    <pre style={{ margin: 0, padding: '12px', fontSize: '0.75rem', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', background: '#fafafa', color: '#334155', fontFamily: 'monospace' }}>
                      {emailPreview.previewText}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowEmailModal(false)} disabled={sendingEmails}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-gold btn-sm"
                onClick={handleSendEmails}
                disabled={sendingEmails || loadingPreview}
              >
                {sendingEmails ? 'Dispatching...' : `Confirm & Send ${selectedEmployees.size} Email(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: RECORD PAYMENT
          ========================================================================= */}
      {showPaymentModal && paymentClaim && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '480px', width: '100%' }}>
            <form onSubmit={handleRecordPaymentSubmit}>
              <div className="modal-header">
                <span className="modal-title">Record Reimbursement Payment</span>
                <button type="button" className="btn-close" onClick={() => setShowPaymentModal(false)}>&times;</button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid var(--border-subtle)' }}>
                  <div>Claim Voucher: <strong>{paymentClaim.merchant || paymentClaim.merchantName || 'Expense'}</strong></div>
                  <div>Approved Amount: <strong>{paymentClaim.currency || 'USD'} {Number(paymentClaim.approvedAmount || paymentClaim.totalAmount || 0).toFixed(2)}</strong></div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Payment Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="form-input"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Payment Method</label>
                  <select
                    className="form-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="DIRECT_DEPOSIT">Direct Deposit (ACH / NEFT)</option>
                    <option value="BANK_TRANSFER">Bank Wire Transfer</option>
                    <option value="CHECK">Check</option>
                    <option value="PAYROLL">Payroll Inclusion</option>
                    <option value="CASH">Cash</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Payment Reference / Transaction ID</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. ACH-994821 or UTR-20261023"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Internal Notes</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Paid via company corporate account"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowPaymentModal(false)} disabled={recordingPayment}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-gold btn-sm" disabled={recordingPayment}>
                  {recordingPayment ? 'Recording...' : 'Save Payment Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: INSPECT EMAIL LOG
          ========================================================================= */}
      {inspectLog && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '600px', width: '100%' }}>
            <div className="modal-header">
              <span className="modal-title">Email Log Details</span>
              <button type="button" className="btn-close" onClick={() => setInspectLog(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem' }}>
              <div><strong>Recipient:</strong> {inspectLog.recipientEmail} ({inspectLog.employeeName})</div>
              <div><strong>Subject:</strong> {inspectLog.subject}</div>
              <div><strong>Delivery Mode:</strong> {inspectLog.deliveryMode} | <strong>Status:</strong> {inspectLog.status}</div>
              <div><strong>Sent By:</strong> {inspectLog.senderName} on {new Date(inspectLog.createdAt).toLocaleString()}</div>
              <div><strong>Provider Response:</strong> <span style={{ color: 'var(--text-muted)' }}>{inspectLog.providerResponse}</span></div>
              <div style={{ marginTop: '8px' }}>
                <strong>Message Content:</strong>
                <pre style={{ background: '#f8fafc', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap', maxHeight: '220px', overflowY: 'auto' }}>
                  {inspectLog.bodyPreview}
                </pre>
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setInspectLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
