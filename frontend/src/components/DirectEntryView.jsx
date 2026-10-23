import React, { useState, useEffect } from 'react';
import {
  IconPlus,
  IconRefresh,
  IconCheckCircle,
  IconClock,
  IconFolder,
  IconSparkles,
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconEye,
  IconLock,
  IconSend,
  IconFileText,
} from './Icons';

const SOURCE_TYPES = [
  { value: 'SUPPLIER_BILL', label: 'Supplier / Vendor Bill' },
  { value: 'EXTERNAL_INVOICE', label: 'External Invoice' },
  { value: 'DIRECT_PAYMENT', label: 'Direct Payment Voucher' },
  { value: 'WIRE_TRANSFER', label: 'Wire Transfer' },
  { value: 'OTHER', label: 'Other Direct Record' },
];

const CATEGORIES = [
  { name: 'Other', debit: '6900 - Miscellaneous / Other Expense' },
  { name: 'Office Supplies', debit: '6300 - Office Supplies' },
  { name: 'Software', debit: '6400 - Software & Subscriptions' },
  { name: 'Meals', debit: '6100 - Meals & Entertainment' },
  { name: 'Travel', debit: '6200 - Travel & Lodging' },
  { name: 'Transportation', debit: '6250 - Local Transportation' },
  { name: 'Accommodation', debit: '6210 - Hotel & Accommodation' },
];

export default function DirectEntryView({ authToken, currentUser }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal & Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState(null);

  // Form Fields
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formVendor, setFormVendor] = useState('');
  const [formRef, setFormRef] = useState('');
  const [formSource, setFormSource] = useState('SUPPLIER_BILL');
  const [formCategory, setFormCategory] = useState('Other');
  const [formAmount, setFormAmount] = useState('');
  const [formTax, setFormTax] = useState('0.00');
  const [formCurrency, setFormCurrency] = useState('USD');
  const [formDebitAccount, setFormDebitAccount] = useState('6900 - Miscellaneous / Other Expense');
  const [formCreditAccount, setFormCreditAccount] = useState('2000 - Accounts Payable');
  const [formDescription, setFormDescription] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formReconciliation, setFormReconciliation] = useState('UNRECONCILED');
  const [formAttachment, setFormAttachment] = useState(null);

  // Detail / Inspector State
  const [inspectEntry, setInspectEntry] = useState(null);
  const [postingId, setPostingId] = useState(null);

  async function fetchEntries() {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page,
        pageSize,
        status: statusFilter,
      });
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      const res = await fetch(`/api/finance/direct-entries?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error('Failed to load direct financial entries');
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEntries();
  }, [authToken, page, pageSize, statusFilter]);

  function handleCategoryChange(catName) {
    setFormCategory(catName);
    const matched = CATEGORIES.find((c) => c.name === catName);
    if (matched) {
      setFormDebitAccount(matched.debit);
    }
  }

  async function handleOcrPreview() {
    if (!formAttachment) {
      alert('Please choose an image file first to preview OCR extraction.');
      return;
    }
    setOcrLoading(true);
    setOcrMsg(null);
    try {
      const formData = new FormData();
      formData.append('attachment', formAttachment);
      const res = await fetch('/api/finance/direct-entries/ocr-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });
      if (!res.ok) throw new Error('OCR preview failed');
      const data = await res.json();
      const p = data.preview || {};

      if (p.merchantName && !formVendor) setFormVendor(p.merchantName);
      if (p.receiptDate && !formDate) setFormDate(p.receiptDate);
      if (p.totalAmount && !formAmount) setFormAmount(String(p.totalAmount));
      if (p.taxAmount) setFormTax(String(p.taxAmount));
      if (p.currency) setFormCurrency(p.currency);
      if (p.category) handleCategoryChange(p.category);

      setOcrMsg(
        p.rawText
          ? 'OCR extracted values reviewed and pre-filled into the form. You may modify any field before saving.'
          : 'Document processed. No text recognized; please fill fields manually.'
      );
    } catch (err) {
      setOcrMsg('OCR service unavailable or failed. You can continue filling details manually.');
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    if (!formVendor.trim() || !formAmount || !formDescription.trim()) {
      setError('Please fill in required fields: Vendor, Amount, Description.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('transactionDate', formDate);
      formData.append('vendor', formVendor.trim());
      if (formRef.trim()) formData.append('referenceNumber', formRef.trim());
      formData.append('sourceType', formSource);
      formData.append('category', formCategory);
      formData.append('amount', formAmount);
      formData.append('taxAmount', formTax || '0.00');
      formData.append('currency', formCurrency);
      formData.append('debitAccount', formDebitAccount);
      formData.append('creditAccount', formCreditAccount);
      formData.append('description', formDescription.trim());
      if (formNotes.trim()) formData.append('notes', formNotes.trim());
      formData.append('reconciliationStatus', formReconciliation);

      if (formAttachment) {
        formData.append('attachment', formAttachment);
      }

      const res = await fetch('/api/finance/direct-entries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save direct financial entry');
      }

      setSuccessMsg(`Direct Financial Entry #${data.directEntry.entryNumber} created as DRAFT!`);
      setShowCreateModal(false);
      resetForm();
      fetchEntries();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormVendor('');
    setFormRef('');
    setFormSource('SUPPLIER_BILL');
    setFormCategory('Other');
    setFormAmount('');
    setFormTax('0.00');
    setFormCurrency('USD');
    setFormDebitAccount('6900 - Miscellaneous / Other Expense');
    setFormCreditAccount('2000 - Accounts Payable');
    setFormDescription('');
    setFormNotes('');
    setFormReconciliation('UNRECONCILED');
    setFormAttachment(null);
    setOcrMsg(null);
  }

  async function handlePostEntry(entryId) {
    if (!window.confirm('Post this financial record to the General Ledger? This will finalize a balanced double-entry Journal Entry.')) {
      return;
    }
    setPostingId(entryId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/finance/direct-entries/${entryId}/post`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to post direct financial entry');
      }
      setSuccessMsg(`Direct Entry posted successfully! General Ledger Journal Entry #${data.journalEntryId.slice(0, 8)} created.`);
      fetchEntries();
      if (inspectEntry?.id === entryId) {
        inspectDirectEntry(entryId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPostingId(null);
    }
  }

  async function inspectDirectEntry(entryId) {
    try {
      const res = await fetch(`/api/finance/direct-entries/${entryId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInspectEntry(data.directEntry);
      }
    } catch {
      // quiet fail
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner / Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', background: '#ffffff', padding: '16px 20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-xs)' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            Direct Financial Entries
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Enter supplier invoices, utility bills, and direct expenses received by Finance without employee reimbursement claims.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={fetchEntries}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconRefresh size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-gold btn-sm"
            id="btn-new-direct-entry"
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
          >
            <IconPlus size={15} /> New Direct Entry
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert alert-danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><strong>Error:</strong> {error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><IconX size={14} /></button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><IconCheckCircle size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><IconX size={14} /></button>
        </div>
      )}

      {/* Table Card */}
      <div className="table-card">
        {/* Table Filters */}
        <div className="table-header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['ALL', 'DRAFT', 'POSTED'].map((st) => (
              <button
                key={st}
                type="button"
                className={`btn btn-sm ${statusFilter === st ? 'btn-gold' : 'btn-outline'}`}
                style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
              >
                {st === 'ALL' ? 'All Records' : st === 'DRAFT' ? 'Drafts' : 'Posted to GL'}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              fetchEntries();
            }}
            style={{ display: 'flex', gap: '8px' }}
          >
            <input
              type="text"
              placeholder="Search vendor, ref#, description..."
              className="form-input"
              style={{ width: '240px', fontSize: '0.8125rem', padding: '6px 10px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-outline btn-sm">Search</button>
          </form>
        </div>

        {/* Table Data */}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading financial entries...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No direct financial entries found. Click <strong>"New Direct Entry"</strong> to add a supplier bill or external payment.
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry #</th>
                  <th>Vendor / Payee</th>
                  <th>Ref # / Source</th>
                  <th>Category &amp; Ledger</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'center' }}>Attachment</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {entry.transactionDate ? String(entry.transactionDate).slice(0, 10) : 'N/A'}
                    </td>
                    <td style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
                      #{entry.entryNumber}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{entry.vendor}</div>
                      <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                        {entry.description.slice(0, 45)}{entry.description.length > 45 ? '...' : ''}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>
                        {entry.referenceNumber ? `Ref: ${entry.referenceNumber}` : 'No Ref'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {entry.sourceType.replace('_', ' ')}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.75rem' }}>{entry.category || 'Other'}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Dr: {entry.debitAccount.split(' - ')[0]} &bull; Cr: {entry.creditAccount.split(' - ')[0]}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.875rem' }}>
                      {entry.currency} {Number(entry.amount).toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`status-pill ${entry.status === 'POSTED' ? 'approved' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                        {entry.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {entry.hasAttachment ? (
                        <a
                          href={`/api/finance/direct-entries/${entry.id}/attachment`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '3px 8px', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          title={entry.attachmentFilename}
                        >
                          <IconFileText size={12} /> View Doc
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>None</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                          onClick={() => inspectDirectEntry(entry.id)}
                        >
                          <IconEye size={13} />
                        </button>
                        {entry.status === 'DRAFT' && (
                          <button
                            type="button"
                            className="btn btn-gold btn-sm"
                            style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700 }}
                            disabled={postingId === entry.id}
                            onClick={() => handlePostEntry(entry.id)}
                          >
                            {postingId === entry.id ? 'Posting...' : 'Post to GL'}
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

        {/* Pagination */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
          <span>Showing {entries.length} of {total} records</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <IconChevronLeft size={11} /> Prev
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={entries.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <IconChevronRight size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* CREATE DIRECT ENTRY MODAL */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => !submitting && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>New Direct Financial Entry</h3>
              <button type="button" className="btn-close" onClick={() => setShowCreateModal(false)} disabled={submitting}>
                <IconX size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Transaction Date *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Source Type</label>
                  <select
                    className="form-select"
                    value={formSource}
                    onChange={(e) => setFormSource(e.target.value)}
                  >
                    {SOURCE_TYPES.map((st) => (
                      <option key={st.value} value={st.value}>{st.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Vendor / Payee *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Acme Supplies, Google Cloud, City Water"
                    value={formVendor}
                    onChange={(e) => setFormVendor(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Ref / Invoice #</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. INV-2026-99"
                    value={formRef}
                    onChange={(e) => setFormRef(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="form-input"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Tax Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.00"
                    className="form-input"
                    placeholder="0.00"
                    value={formTax}
                    onChange={(e) => setFormTax(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Currency</label>
                  <select
                    className="form-select"
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value)}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Expense Category</label>
                <select
                  className="form-select"
                  value={formCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.name} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: '#f8fafc', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.725rem', color: '#1e40af' }}>Debit Account (Expense)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formDebitAccount}
                    onChange={(e) => setFormDebitAccount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.725rem', color: '#1e40af' }}>Credit Account (Payable/Cash)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formCreditAccount}
                    onChange={(e) => setFormCreditAccount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Description *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Summary of goods or services received"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  required
                />
              </div>

              {/* Supporting Document / OCR */}
              <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid #bbf7d0' }}>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>
                  Supporting Document (Invoice / Bill Photo)
                </label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setFormAttachment(e.target.files?.[0] || null)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                  {formAttachment && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={handleOcrPreview}
                      disabled={ocrLoading}
                      style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <IconSparkles size={13} /> {ocrLoading ? 'Reading OCR...' : 'Preview OCR Extracted Values'}
                    </button>
                  )}
                </div>
                {ocrMsg && (
                  <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: '8px' }}>
                    {ocrMsg}
                  </div>
                )}
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Notes (Optional)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Additional reconciliation or payment notes"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-gold"
                  disabled={submitting}
                >
                  {submitting ? 'Saving Draft...' : 'Save as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECTOR DRAWER / MODAL */}
      {inspectEntry && (
        <div className="modal-backdrop" onClick={() => setInspectEntry(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                Direct Financial Entry #{inspectEntry.entryNumber}
              </h3>
              <button type="button" className="btn-close" onClick={() => setInspectEntry(null)}>
                <IconX size={16} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status &bull; Source</div>
                  <div style={{ fontWeight: 700 }}>
                    <span className={`status-pill ${inspectEntry.status === 'POSTED' ? 'approved' : 'draft'}`} style={{ marginRight: '8px' }}>
                      {inspectEntry.status}
                    </span>
                    {inspectEntry.sourceType}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Amount</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold-hover)' }}>
                    {inspectEntry.currency} {Number(inspectEntry.amount).toFixed(2)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
                <div><strong>Vendor:</strong> {inspectEntry.vendor}</div>
                <div><strong>Date:</strong> {String(inspectEntry.transactionDate).slice(0, 10)}</div>
                <div><strong>Reference:</strong> {inspectEntry.referenceNumber || 'N/A'}</div>
                <div><strong>Category:</strong> {inspectEntry.category}</div>
                <div><strong>Debit Account:</strong> {inspectEntry.debitAccount}</div>
                <div><strong>Credit Account:</strong> {inspectEntry.creditAccount}</div>
                <div><strong>Created By:</strong> {inspectEntry.createdByName || 'Finance User'}</div>
                <div><strong>Created At:</strong> {new Date(inspectEntry.createdAt).toLocaleString()}</div>
              </div>

              <div>
                <strong>Description:</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {inspectEntry.description}
                </p>
              </div>

              {inspectEntry.notes && (
                <div>
                  <strong>Notes:</strong>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {inspectEntry.notes}
                  </p>
                </div>
              )}

              {inspectEntry.hasAttachment && (
                <div style={{ padding: '10px 14px', background: '#eff6ff', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#1e40af' }}>
                    📎 {inspectEntry.attachmentFilename}
                  </span>
                  <a
                    href={`/api/finance/direct-entries/${inspectEntry.id}/attachment`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.75rem' }}
                  >
                    View Document
                  </a>
                </div>
              )}

              {/* Audit History */}
              {inspectEntry.auditHistory && inspectEntry.auditHistory.length > 0 && (
                <div>
                  <strong style={{ fontSize: '0.85rem' }}>Audit Trail:</strong>
                  <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {inspectEntry.auditHistory.map((a) => (
                      <div key={a.id} style={{ fontSize: '0.75rem', padding: '6px 10px', background: '#f8fafc', borderRadius: '4px', borderLeft: '3px solid var(--gold-primary)' }}>
                        <strong>{a.action}</strong> by {a.actorName} &bull; {new Date(a.createdAt).toLocaleString()}
                        <div style={{ color: 'var(--text-muted)' }}>{a.details}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {inspectEntry.status === 'DRAFT' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-gold"
                    disabled={postingId === inspectEntry.id}
                    onClick={() => handlePostEntry(inspectEntry.id)}
                  >
                    {postingId === inspectEntry.id ? 'Posting...' : 'Post to General Ledger'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
