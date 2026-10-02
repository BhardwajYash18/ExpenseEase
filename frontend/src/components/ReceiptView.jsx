import React, { useState, useEffect } from 'react';

const ALLOWED_CATEGORIES = [
  'Meals',
  'Travel',
  'Accommodation',
  'Office Supplies',
  'Software',
  'Transportation',
  'Other',
];

export default function ReceiptView({ receipt, authToken, currentUser }) {
  if (!receipt) return null;

  const [extraction, setExtraction] = useState(null);
  const [loadingExtraction, setLoadingExtraction] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Checkpoint 5 Validation States
  const [validation, setValidation] = useState(null);
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [validatingLoading, setValidatingLoading] = useState(false);
  const [validationError, setValidationError] = useState(null);

  // Checkpoint 6 Approval Workflow States
  const [workflowData, setWorkflowData] = useState(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reasonModal, setReasonModal] = useState(null); // { type: 'REJECT' | 'REQUEST_CORRECTION', reason: '' }

  // Fetch extraction, validation, and workflow when receipt changes
  useEffect(() => {
    let isMounted = true;
    async function fetchExtraction() {
      if (!receipt?.id || !authToken) return;
      setLoadingExtraction(true);
      setExtractError(null);
      try {
        const res = await fetch(`/api/receipts/${receipt.id}/extraction`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.status === 404) {
          if (isMounted) setExtraction(null);
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || 'Failed to fetch extraction');
        }
        if (isMounted) {
          setExtraction(data.extraction);
          initEditForm(data.extraction);
        }
      } catch (err) {
        if (isMounted) setExtractError(err.message);
      } finally {
        if (isMounted) setLoadingExtraction(false);
      }
    }

    async function fetchValidation() {
      if (!receipt?.id || !authToken) return;
      setLoadingValidation(true);
      setValidationError(null);
      try {
        const res = await fetch(`/api/receipts/${receipt.id}/validation`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.status === 404) {
          if (isMounted) setValidation(null);
          return;
        }
        const data = await res.json();
        if (res.ok && isMounted) {
          setValidation(data.validation);
        }
      } catch (err) {
        // Not yet validated
      } finally {
        if (isMounted) setLoadingValidation(false);
      }
    }

    async function fetchWorkflow() {
      if (!receipt?.id || !authToken) return;
      setLoadingWorkflow(true);
      setWorkflowError(null);
      try {
        const res = await fetch(`/api/receipts/${receipt.id}/workflow`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.status === 404) {
          if (isMounted) setWorkflowData(null);
          return;
        }
        const data = await res.json();
        if (res.ok && isMounted) {
          setWorkflowData(data);
        }
      } catch (err) {
        // Workflow may not exist or not ready
      } finally {
        if (isMounted) setLoadingWorkflow(false);
      }
    }

    fetchExtraction();
    fetchValidation();
    fetchWorkflow();
    return () => {
      isMounted = false;
    };
  }, [receipt?.id, authToken]);

  async function handleRunValidation() {
    if (!receipt?.id || !authToken) return;
    setValidatingLoading(true);
    setValidationError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/validation`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Validation failed');
      }
      setValidation(data.validation);
    } catch (err) {
      setValidationError(err.message);
    } finally {
      setValidatingLoading(false);
    }
  }

  async function reloadWorkflow() {
    if (!receipt?.id || !authToken) return;
    setLoadingWorkflow(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/workflow`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 404) {
        setWorkflowData(null);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setWorkflowData(data);
      }
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setLoadingWorkflow(false);
    }
  }

  async function handleSubmitWorkflow() {
    if (!receipt?.id || !authToken) return;
    setActionLoading(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/workflow/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Submission failed');
      }
      await reloadWorkflow();
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApproveWorkflow() {
    if (!receipt?.id || !authToken) return;
    setActionLoading(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/workflow/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Approval failed');
      }
      await reloadWorkflow();
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectWorkflow(reason) {
    if (!receipt?.id || !authToken) return;
    if (!reason || !reason.trim()) {
      setWorkflowError('Rejection reason is required by business policy');
      return;
    }
    setActionLoading(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/workflow/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Rejection failed');
      }
      setReasonModal(null);
      await reloadWorkflow();
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestCorrectionWorkflow(reason) {
    if (!receipt?.id || !authToken) return;
    if (!reason || !reason.trim()) {
      setWorkflowError('Correction reason is required by business policy');
      return;
    }
    setActionLoading(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/workflow/request-correction`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Request correction failed');
      }
      setReasonModal(null);
      await reloadWorkflow();
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  function initEditForm(ext) {
    if (!ext) return;
    const eff = ext.effectiveValues || {};
    setEditForm({
      merchantName: eff.merchantName || '',
      receiptDate: eff.receiptDate || '',
      totalAmount: eff.totalAmount !== null && eff.totalAmount !== undefined ? eff.totalAmount : '',
      subtotalAmount: eff.subtotalAmount !== null && eff.subtotalAmount !== undefined ? eff.subtotalAmount : '',
      taxAmount: eff.taxAmount !== null && eff.taxAmount !== undefined ? eff.taxAmount : '',
      currency: eff.currency || 'USD',
      receiptNumber: eff.receiptNumber || '',
      category: eff.category || 'Other',
    });
  }

  // Trigger AI Extraction
  async function handleTriggerExtraction() {
    setLoadingExtraction(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/extraction`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Extraction failed');
      }
      setExtraction(data.extraction);
      initEditForm(data.extraction);
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setLoadingExtraction(false);
    }
  }

  // Save Confirmed Values (PUT /api/receipts/:id/extraction)
  async function handleSaveConfirmed(e) {
    e.preventDefault();
    setSaveLoading(true);
    setExtractError(null);
    setSaveSuccess(false);

    try {
      const payload = {
        merchantName: editForm.merchantName || null,
        receiptDate: editForm.receiptDate || null,
        totalAmount: editForm.totalAmount !== '' ? Number(editForm.totalAmount) : null,
        subtotalAmount: editForm.subtotalAmount !== '' ? Number(editForm.subtotalAmount) : null,
        taxAmount: editForm.taxAmount !== '' ? Number(editForm.taxAmount) : null,
        currency: editForm.currency || 'USD',
        receiptNumber: editForm.receiptNumber || null,
        category: editForm.category || 'Other',
      };

      const res = await fetch(`/api/receipts/${receipt.id}/extraction`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to update confirmed values');
      }

      setExtraction(data.extraction);
      initEditForm(data.extraction);
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setSaveLoading(false);
    }
  }

  const isOcrCompleted = receipt.ocrStatus === 'COMPLETED';
  const isOcrFailed = receipt.ocrStatus === 'FAILED';
  const effective = extraction?.effectiveValues || {};
  const ai = extraction?.aiData || {};
  const confirmed = extraction?.confirmedData || {};

  return (
    <div className="card receipt-view-card" id="receipt-view-component" style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Receipt & AI Understanding</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span
            className={`status-badge ${isOcrCompleted ? 'ok' : isOcrFailed ? 'error' : 'pending'}`}
            style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold', margin: 0 }}
          >
            OCR: {receipt.ocrStatus}
          </span>
          {extraction && (
            <span
              className={`status-badge ${extraction.extractionStatus === 'MANUALLY_CONFIRMED' ? 'ok' : 'pending'}`}
              style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold', margin: 0 }}
            >
              Extraction: {extraction.extractionStatus}
            </span>
          )}
        </div>
      </div>

      {/* Main Grid: Receipt Image + OCR / AI Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginTop: '16px' }}>
        {/* Left: Original Receipt */}
        <div>
          <h4>Original Stored Receipt</h4>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px', background: 'rgba(15, 23, 42, 0.4)', marginTop: '8px' }}>
            <img
              src={`/api/receipts/${receipt.id}/file`}
              alt="Original Receipt"
              style={{ width: '100%', maxHeight: '350px', objectFit: 'contain', borderRadius: '4px' }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            <div><strong>Filename:</strong> {receipt.originalFilename}</div>
            <div><strong>Size:</strong> {(receipt.fileSizeBytes / 1024).toFixed(1)} KB</div>
            <div><strong>MIME:</strong> {receipt.mimeType}</div>
          </div>
        </div>

        {/* Right: AI Understanding & Fields */}
        <div>
          <h4>AI Understanding & Structured Fields</h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            <em>AI UNDERSTANDS AND SUGGESTS. DETERMINISTIC CODE VALIDATES. AUTHORIZED HUMANS DECIDE.</em>
          </p>

          {extractError && (
            <div className="alert alert-danger" style={{ marginBottom: '12px' }}>
              <strong>Error:</strong> {extractError}
            </div>
          )}

          {saveSuccess && (
            <div className="alert alert-info" style={{ marginBottom: '12px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7' }}>
              Confirmed values updated successfully. AI extraction provenance safely preserved.
            </div>
          )}

          {/* Trigger Extraction Button if not yet extracted */}
          {!extraction && !loadingExtraction && (
            <div style={{ textAlign: 'center', padding: '24px', background: 'rgba(15, 23, 42, 0.5)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                OCR text extracted. Ready to extract structured fields (merchant, date, amounts, category) using AI.
              </p>
              <button
                type="button"
                id="extract-ai-fields-btn"
                className="btn btn-primary"
                onClick={handleTriggerExtraction}
                disabled={loadingExtraction || !isOcrCompleted}
              >
                Extract Fields with AI
              </button>
            </div>
          )}

          {loadingExtraction && (
            <div className="alert alert-info">
              Processing receipt with AI understanding service...
            </div>
          )}

          {/* Structured Fields Presentation */}
          {extraction && !loadingExtraction && !isEditing && (
            <div>
              {/* Flagged for Review Alert */}
              {ai.isFlaggedForReview && (
                <div className="alert alert-danger" style={{ marginBottom: '14px' }}>
                  <strong>Flagged for Review:</strong>
                  <ul style={{ paddingLeft: '20px', marginTop: '6px', fontSize: '0.85rem' }}>
                    {ai.reviewReasons?.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Confidence Score Pill */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  AI Confidence: <strong>{ai.confidenceScore !== null ? `${Math.round(ai.confidenceScore * 100)}%` : 'N/A'}</strong>
                </span>
                <button
                  type="button"
                  id="edit-confirmed-values-btn"
                  className="btn btn-secondary"
                  onClick={() => setIsEditing(true)}
                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                >
                  Edit / Confirm Values
                </button>
              </div>

              {/* Deterministic Effective Fields Grid */}
              <div className="info-list" style={{ gap: '8px' }}>
                <div className="info-item">
                  <span className="info-label">
                    Merchant Name
                    {confirmed.merchantName ? <span className="badge-confirmed" style={{ marginLeft: '6px' }}>Confirmed</span> : <span className="badge-ai" style={{ marginLeft: '6px' }}>AI</span>}
                  </span>
                  <span className="info-value">{effective.merchantName || '—'}</span>
                </div>

                <div className="info-item">
                  <span className="info-label">
                    Receipt Date
                    {confirmed.receiptDate ? <span className="badge-confirmed" style={{ marginLeft: '6px' }}>Confirmed</span> : <span className="badge-ai" style={{ marginLeft: '6px' }}>AI</span>}
                  </span>
                  <span className="info-value">{effective.receiptDate || '—'}</span>
                </div>

                <div className="info-item">
                  <span className="info-label">
                    Total Amount
                    {confirmed.totalAmount !== null && confirmed.totalAmount !== undefined ? <span className="badge-confirmed" style={{ marginLeft: '6px' }}>Confirmed</span> : <span className="badge-ai" style={{ marginLeft: '6px' }}>AI</span>}
                  </span>
                  <span className="info-value" style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                    {effective.totalAmount !== null ? `${effective.currency || 'USD'} ${effective.totalAmount.toFixed(2)}` : '—'}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">
                    Category
                    {confirmed.category ? <span className="badge-confirmed" style={{ marginLeft: '6px' }}>Confirmed</span> : <span className="badge-ai" style={{ marginLeft: '6px' }}>AI Suggested</span>}
                  </span>
                  <span className="info-value">{effective.category || 'Other'}</span>
                </div>

                <div className="info-item">
                  <span className="info-label">Subtotal / Tax</span>
                  <span className="info-value">
                    {effective.subtotalAmount !== null ? effective.subtotalAmount.toFixed(2) : '—'} / {effective.taxAmount !== null ? effective.taxAmount.toFixed(2) : '—'}
                  </span>
                </div>

                <div className="info-item">
                  <span className="info-label">Receipt #</span>
                  <span className="info-value">{effective.receiptNumber || '—'}</span>
                </div>
              </div>

              {/* Line items table */}
              {extraction.lineItems && extraction.lineItems.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <h5 style={{ fontSize: '0.9rem', marginBottom: '6px' }}>Line Items ({extraction.lineItems.length})</h5>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraction.lineItems.map((li) => (
                        <tr key={li.lineNumber || li.id}>
                          <td>{li.lineNumber}</td>
                          <td>{li.description}</td>
                          <td>{li.quantity}</td>
                          <td>${li.totalPrice !== null ? li.totalPrice.toFixed(2) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Provenance Details Box */}
              {confirmed.correctedAt && (
                <div className="provenance-box" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <strong>Provenance Audit:</strong> Confirmed by user on {new Date(confirmed.correctedAt).toLocaleString()}.
                  Original AI extraction preserved unmodified.
                </div>
              )}
            </div>
          )}

          {/* Edit / Confirm Form */}
          {extraction && isEditing && (
            <form onSubmit={handleSaveConfirmed} id="edit-extraction-form" style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <h5 style={{ marginBottom: '12px' }}>Edit / Confirm Receipt Values</h5>

              <div className="form-group">
                <label className="form-label">Merchant Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editForm.merchantName}
                  onChange={(e) => setEditForm({ ...editForm, merchantName: e.target.value })}
                  placeholder="Merchant name"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Receipt Date (YYYY-MM-DD)</label>
                <input
                  type="date"
                  className="form-input"
                  value={editForm.receiptDate}
                  onChange={(e) => setEditForm({ ...editForm, receiptDate: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Total Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={editForm.totalAmount}
                    onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  >
                    {ALLOWED_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Subtotal Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={editForm.subtotalAmount}
                    onChange={(e) => setEditForm({ ...editForm, subtotalAmount: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tax Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={editForm.taxAmount}
                    onChange={(e) => setEditForm({ ...editForm, taxAmount: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsEditing(false)}
                  disabled={saveLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="save-confirmed-values-btn"
                  className="btn btn-success"
                  disabled={saveLoading}
                >
                  {saveLoading ? 'Saving...' : 'Confirm Values'}
                </button>
              </div>
            </form>
          )}
          {/* Checkpoint 5: Policy Validation & Duplicate Detection */}
          <div className="validation-card" style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>
                  Policy & Duplicate Validation
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Deterministic policy engine & tenant-isolated duplicate detection
                </p>
              </div>

              <button
                type="button"
                id="run-validation-btn"
                className="btn btn-primary"
                onClick={handleRunValidation}
                disabled={validatingLoading || !extraction}
                style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              >
                {validatingLoading ? 'Validating...' : (validation ? 'Re-run Validation' : 'Run Policy Validation')}
              </button>
            </div>

            {validationError && (
              <div className="alert alert-danger" style={{ marginBottom: '12px', fontSize: '0.8rem' }}>
                {validationError}
              </div>
            )}

            {!validation && !loadingValidation && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0' }}>
                No validation has been performed on this receipt yet. Click &quot;Run Policy Validation&quot; to evaluate against tenant policies and check for duplicate submissions.
              </p>
            )}

            {loadingValidation && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '8px 0' }}>
                Loading validation results...
              </p>
            )}

            {validation && (
              <div>
                {/* Status Badges Header */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                  {/* Policy Validation Status */}
                  <div style={{ padding: '10px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Deterministic Policy</div>
                    <div>
                      {validation.policy?.status === 'PASSED' && (
                        <span className="badge-pass">✓ Policy passed</span>
                      )}
                      {validation.policy?.status === 'FAILED' && (
                        <span className="badge-fail">✕ Policy violation</span>
                      )}
                      {validation.policy?.status === 'REVIEW_REQUIRED' && (
                        <span className="badge-review">⚠ Review required</span>
                      )}
                    </div>
                  </div>

                  {/* Duplicate Status */}
                  <div style={{ padding: '10px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Duplicate Check</div>
                    <div>
                      {validation.duplicate?.status === 'NO_MATCH' && (
                        <span className="badge-dup-none">✓ No duplicate candidate</span>
                      )}
                      {validation.duplicate?.status === 'POSSIBLE_DUPLICATE' && (
                        <span className="badge-dup-possible">⚠ Possible duplicate</span>
                      )}
                      {validation.duplicate?.status === 'HIGH_SIMILARITY' && (
                        <span className="badge-dup-high">⚠ High similarity</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Policy Rules List */}
                <div style={{ marginBottom: '16px' }}>
                  <h5 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Evaluated Policy Rules ({validation.policy?.rules?.length || 0})
                  </h5>
                  <table className="data-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Status</th>
                        <th>Message</th>
                        <th>Actual / Expected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.policy?.rules?.map((r, idx) => (
                        <tr key={idx}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.rule}</td>
                          <td>
                            {r.status === 'PASSED' && <span className="badge-pass" style={{ fontSize: '0.7rem' }}>PASS</span>}
                            {r.status === 'FAILED' && <span className="badge-fail" style={{ fontSize: '0.7rem' }}>FAIL</span>}
                            {r.status === 'REVIEW_REQUIRED' && <span className="badge-review" style={{ fontSize: '0.7rem' }}>REVIEW</span>}
                          </td>
                          <td style={{ color: r.status === 'FAILED' ? '#f87171' : 'var(--text-primary)' }}>{r.message}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {r.actual_value !== undefined && r.actual_value !== null ? String(r.actual_value) : '-'} / {r.expected_value !== undefined && r.expected_value !== null ? String(r.expected_value) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Duplicate Candidates List */}
                <div style={{ marginBottom: '16px' }}>
                  <h5 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Duplicate Candidates ({validation.duplicate?.candidates?.length || 0})
                  </h5>
                  {(!validation.duplicate?.candidates || validation.duplicate.candidates.length === 0) ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                      No duplicate candidate detected within tenant.
                    </p>
                  ) : (
                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>Candidate Receipt ID</th>
                          <th>Similarity Score</th>
                          <th>Matching Signals</th>
                          <th>Method</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validation.duplicate.candidates.map((cand, idx) => (
                          <tr key={idx}>
                            <td style={{ fontFamily: 'monospace' }}>
                              {cand.candidateReceiptId ? cand.candidateReceiptId.slice(0, 8) + '...' : '-'}
                            </td>
                            <td>
                              <span style={{ fontWeight: 600, color: cand.similarityScore >= 0.85 ? '#f87171' : '#fbbf24' }}>
                                {(cand.similarityScore * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td>
                              {cand.matchingSignals && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {Object.entries(cand.matchingSignals)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join(' | ')}
                                </span>
                              )}
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {cand.detectionMethod || 'heuristics'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Provenance & Disclaimer */}
                <div className="provenance-box" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div><strong>Validation Version:</strong> {validation.metadata?.validationVersion || 'v1'} &bull; <strong>Validated At:</strong> {validation.metadata?.validatedAt ? new Date(validation.metadata.validatedAt).toLocaleString() : 'N/A'}</div>
                  <div style={{ marginTop: '4px', fontStyle: 'italic' }}>
                    Core Principle: AI understands and suggests. Deterministic code validates. Authorized humans decide. Accounting logic records.
                    Validation results and duplicate detection are review signals and do not represent approval or rejection workflow decisions.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Checkpoint 6 — Approval Workflow Card */}
          <div className="workflow-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Workflow & Approval State</span>
                {(() => {
                  const state = workflowData?.workflow?.current_state || 'DRAFT';
                  switch (state) {
                    case 'PENDING_APPROVAL':
                      return <span className="badge-pending">Pending Approval</span>;
                    case 'APPROVED':
                      return <span className="badge-approved">Approved</span>;
                    case 'REJECTED':
                      return <span className="badge-rejected">Rejected</span>;
                    case 'CORRECTION_REQUESTED':
                      return <span className="badge-correction">Correction Requested</span>;
                    case 'DRAFT':
                    default:
                      return <span className="badge-draft">Draft</span>;
                  }
                })()}
              </h4>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                onClick={reloadWorkflow}
                disabled={loadingWorkflow}
              >
                {loadingWorkflow ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {workflowError && (
              <div className="alert alert-danger" style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
                {workflowError}
              </div>
            )}

            {/* Workflow Banner for Rejection or Correction with Reason */}
            {(() => {
              const state = workflowData?.workflow?.current_state || 'DRAFT';
              const actions = workflowData?.actions || [];
              const latestReasonAction = actions.slice().reverse().find((a) => a.reason);
              if (state === 'REJECTED' && latestReasonAction) {
                return (
                  <div className="alert alert-danger" style={{ marginBottom: '14px', fontSize: '0.85rem' }}>
                    <strong>Rejection Reason:</strong> {latestReasonAction.reason}
                    <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.85 }}>
                      Recorded by {latestReasonAction.actor_first_name} ({latestReasonAction.actor_role}) on {new Date(latestReasonAction.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              }
              if (state === 'CORRECTION_REQUESTED' && latestReasonAction) {
                return (
                  <div className="alert" style={{ background: 'rgba(249, 115, 22, 0.15)', border: '1px solid rgba(249, 115, 22, 0.4)', color: '#fb923c', marginBottom: '14px', fontSize: '0.85rem' }}>
                    <strong>Correction Requested:</strong> {latestReasonAction.reason}
                    <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.85 }}>
                      Please adjust the confirmed receipt details above and resubmit.
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Workflow Action Controls */}
            {(() => {
              const state = workflowData?.workflow?.current_state || 'DRAFT';
              const isUploader = (workflowData?.workflow?.submitted_by && workflowData?.workflow?.submitted_by === currentUser?.id) || receipt.uploadedBy === currentUser?.id;
              const hasExtraction = !!extraction;
              const hasValidation = !!validation;

              return (
                <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(30, 41, 59, 0.4)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.85rem', marginBottom: '10px' }}>
                    <strong>Workflow Status:</strong> <code style={{ color: '#38bdf8' }}>{state}</code>
                    {workflowData?.workflow?.submitted_by && (
                      <span style={{ marginLeft: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Submitter: {workflowData.workflow.submitted_by.slice(0, 8)}...
                      </span>
                    )}
                  </div>

                  {/* EMPLOYEE Controls */}
                  {currentUser?.role === 'EMPLOYEE' && (
                    <div>
                      {state === 'DRAFT' && (
                        <div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSubmitWorkflow}
                            disabled={actionLoading || !hasExtraction || !hasValidation}
                            style={{ fontSize: '0.85rem', padding: '8px 16px' }}
                          >
                            {actionLoading ? 'Submitting...' : 'Submit Expense for Approval'}
                          </button>
                          {(!hasExtraction || !hasValidation) && (
                            <p style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '6px', margin: 0 }}>
                              * Notice: Extraction and policy validation must be completed before submission.
                            </p>
                          )}
                        </div>
                      )}

                      {state === 'CORRECTION_REQUESTED' && (
                        <div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSubmitWorkflow}
                            disabled={actionLoading}
                            style={{ fontSize: '0.85rem', padding: '8px 16px' }}
                          >
                            {actionLoading ? 'Resubmitting...' : 'Resubmit Corrected Expense'}
                          </button>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', margin: 0 }}>
                            Review and save any corrections above before resubmitting.
                          </p>
                        </div>
                      )}

                      {state === 'PENDING_APPROVAL' && (
                        <p style={{ fontSize: '0.85rem', color: '#fbbf24', margin: 0 }}>
                          &#x23F3; Expense is submitted and currently awaiting manager review and decision.
                        </p>
                      )}

                      {state === 'APPROVED' && (
                        <p style={{ fontSize: '0.85rem', color: '#34d399', margin: 0 }}>
                          &#x2714; Expense has been approved by management.
                        </p>
                      )}

                      {state === 'REJECTED' && (
                        <p style={{ fontSize: '0.85rem', color: '#f87171', margin: 0 }}>
                          &#x2716; Expense was rejected by management.
                        </p>
                      )}
                    </div>
                  )}

                  {/* MANAGER Controls */}
                  {currentUser?.role === 'MANAGER' && (
                    <div>
                      {state === 'PENDING_APPROVAL' && (
                        <div>
                          {isUploader ? (
                            <div className="alert alert-warning" style={{ margin: 0, fontSize: '0.8rem' }}>
                              <strong>Separation of Duties (AGENTS.md Section 13):</strong> You submitted this expense. Per governance rules, submitters cannot review or approve their own expenses. Another authorized manager must review.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn"
                                onClick={handleApproveWorkflow}
                                disabled={actionLoading}
                                style={{
                                  background: 'rgba(16, 185, 129, 0.25)',
                                  border: '1px solid #10b981',
                                  color: '#34d399',
                                  fontSize: '0.85rem',
                                  padding: '8px 16px',
                                }}
                              >
                                {actionLoading ? 'Processing...' : 'Approve Expense'}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setReasonModal({ type: 'REQUEST_CORRECTION', reason: '' })}
                                disabled={actionLoading}
                                style={{
                                  background: 'rgba(249, 115, 22, 0.2)',
                                  border: '1px solid #f97316',
                                  color: '#fb923c',
                                  fontSize: '0.85rem',
                                  padding: '8px 16px',
                                }}
                              >
                                Request Correction
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setReasonModal({ type: 'REJECT', reason: '' })}
                                disabled={actionLoading}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.2)',
                                  border: '1px solid #ef4444',
                                  color: '#f87171',
                                  fontSize: '0.85rem',
                                  padding: '8px 16px',
                                }}
                              >
                                Reject Expense
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {state === 'DRAFT' && (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                          Expense is in DRAFT state. Awaiting submission by the employee.
                        </p>
                      )}

                      {state === 'APPROVED' && (
                        <p style={{ fontSize: '0.85rem', color: '#34d399', margin: 0 }}>
                          &#x2714; Expense has already been approved.
                        </p>
                      )}

                      {state === 'REJECTED' && (
                        <p style={{ fontSize: '0.85rem', color: '#f87171', margin: 0 }}>
                          &#x2716; Expense is rejected.
                        </p>
                      )}

                      {state === 'CORRECTION_REQUESTED' && (
                        <p style={{ fontSize: '0.85rem', color: '#fb923c', margin: 0 }}>
                          &#x21BA; Correction requested. Awaiting resubmission by the employee.
                        </p>
                      )}
                    </div>
                  )}

                  {/* FINANCE Controls */}
                  {currentUser?.role === 'FINANCE' && (
                    <div>
                      {state === 'APPROVED' ? (
                        <div style={{ fontSize: '0.85rem', color: '#34d399' }}>
                          &#x2714; Approved expense &mdash; available for Finance Batch grouping in Checkpoint 7 per PRD FR-09.1.
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                          Expense is in state <code>{state}</code>. Awaiting manager approval before becoming available for finance processing.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Modal / Form for Mandatory Reason (Reject or Request Correction) */}
            {reasonModal && (
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px',
                }}
              >
                <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: reasonModal.type === 'REJECT' ? '#f87171' : '#fb923c' }}>
                  {reasonModal.type === 'REJECT' ? 'Enter Rejection Reason' : 'Enter Correction Request Reason'} (Mandatory per PRD FR-08.4)
                </h5>
                <textarea
                  value={reasonModal.reason}
                  onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
                  rows={3}
                  placeholder={`Describe the reason for ${reasonModal.type === 'REJECT' ? 'rejection' : 'correction'}...`}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    background: '#1e293b',
                    color: '#fff',
                    border: '1px solid #475569',
                    fontSize: '0.85rem',
                    marginBottom: '10px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setReasonModal(null)}
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={actionLoading || !reasonModal.reason.trim()}
                    onClick={() => {
                      if (reasonModal.type === 'REJECT') {
                        handleRejectWorkflow(reasonModal.reason);
                      } else {
                        handleRequestCorrectionWorkflow(reasonModal.reason);
                      }
                    }}
                    style={{
                      fontSize: '0.8rem',
                      padding: '6px 12px',
                      background: reasonModal.type === 'REJECT' ? '#ef4444' : '#f97316',
                    }}
                  >
                    {actionLoading ? 'Saving...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {/* Chronological Audit Trail & Workflow History */}
            <div style={{ marginTop: '16px' }}>
              <h5 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Workflow Audit History ({workflowData?.actions?.length || 0} transitions)
              </h5>
              {(!workflowData?.actions || workflowData.actions.length === 0) ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                  No workflow transitions recorded yet.
                </p>
              ) : (
                <div className="workflow-timeline">
                  {workflowData.actions.map((act, idx) => (
                    <div key={idx} className={`workflow-timeline-item action-${act.action}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{act.action}</strong>
                          <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {act.previous_state || 'INIT'} &rarr; {act.new_state}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {act.created_at ? new Date(act.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        By: {act.actor_first_name} {act.actor_last_name} ({act.actor_email}) &bull; Role: <strong>{act.actor_role}</strong>
                      </div>
                      {act.reason && (
                        <div style={{ marginTop: '4px', padding: '6px 10px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '4px', fontSize: '0.8rem', borderLeft: '2px solid #94a3b8' }}>
                          <em>&ldquo;{act.reason}&rdquo;</em>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Raw OCR text toggle */}
          <details style={{ marginTop: '16px', fontSize: '0.8rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>View Raw OCR Extracted Text</summary>
            <pre
              style={{
                marginTop: '8px',
                padding: '10px',
                background: 'rgba(15, 23, 42, 0.6)',
                borderRadius: '6px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '180px',
                overflowY: 'auto',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                border: '1px solid var(--border-color)',
              }}
            >
              {receipt.ocrRawText || '(No OCR text detected)'}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
