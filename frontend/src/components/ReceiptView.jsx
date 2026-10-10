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

export default function ReceiptView({
  receipt,
  authToken,
  currentUser,
  onWorkflowUpdated,
  onRetakePicture,
  onAddMoreReceipts,
  onReceiptDeleted,
}) {
  if (!receipt) return null;

  const [extraction, setExtraction] = useState(null);
  const [loadingExtraction, setLoadingExtraction] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [retryOcrLoading, setRetryOcrLoading] = useState(false);

  // Deletion States
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Validation States
  const [validation, setValidation] = useState(null);
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [validatingLoading, setValidatingLoading] = useState(false);
  const [validationError, setValidationError] = useState(null);

  // Workflow States
  const [workflowData, setWorkflowData] = useState(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reasonModal, setReasonModal] = useState(null); // { type: 'REJECT' | 'REQUEST_CORRECTION', reason: '' }

  // OCR Raw text modal
  const [showRawOcr, setShowRawOcr] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  async function handleDeleteReceipt() {
    if (!receipt?.id || !authToken) return;
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to delete receipt');
      }

      setShowDeleteConfirm(false);
      if (onReceiptDeleted) {
        onReceiptDeleted(receipt.id);
      }
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }

  // Fetch extraction, validation, and workflow
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
          setWorkflowData(data.workflow);
        }
      } catch (err) {
        // Not yet in workflow
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

  function initEditForm(ext) {
    const eff = ext?.effectiveValues || {};
    const conf = ext?.confirmedData || {};
    const total = eff.totalAmount !== null && eff.totalAmount !== undefined ? eff.totalAmount : '';
    const req = conf.requestedAmount !== null && conf.requestedAmount !== undefined
      ? conf.requestedAmount
      : (eff.requestedAmount !== null && eff.requestedAmount !== undefined ? eff.requestedAmount : total);
    const desc = conf.reimbursementDescription || eff.reimbursementDescription || '';

    setEditForm({
      merchantName: eff.merchantName || '',
      receiptDate: eff.receiptDate ? eff.receiptDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      totalAmount: total,
      requestedAmount: req,
      description: desc,
      subtotalAmount: eff.subtotalAmount !== null && eff.subtotalAmount !== undefined ? eff.subtotalAmount : '',
      taxAmount: eff.taxAmount !== null && eff.taxAmount !== undefined ? eff.taxAmount : '',
      currency: eff.currency || 'INR',
      receiptNumber: eff.receiptNumber || '',
      category: eff.category || 'Other',
    });
  }

  // Trigger OCR Retry (using robust RapidOCR engine)
  async function handleRetryOcr() {
    if (!receipt?.id || !authToken) return;
    setRetryOcrLoading(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/retry-ocr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to retry OCR parsing');
      }
      if (data.receipt) {
        receipt.ocrStatus = data.receipt.ocrStatus;
        receipt.ocrRawText = data.receipt.ocrRawText;
        receipt.ocr_raw_text = data.receipt.ocrRawText;
        receipt.ocr_status = data.receipt.ocrStatus;
        if (data.receipt.ocrStatus === 'COMPLETED') {
          await handleTriggerExtraction();
        }
      }
    } catch (err) {
      setExtractError(err.message);
    } finally {
      setRetryOcrLoading(false);
    }
  }

  // Trigger AI extraction
  async function handleTriggerExtraction() {
    if (!receipt?.id || !authToken) return;
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

  // Save Confirmed Values (manual edits, requested amount, business description)
  async function handleSaveConfirmed(e) {
    e.preventDefault();
    setSaveLoading(true);
    setExtractError(null);
    setSaveSuccess(false);

    try {
      const totalNum = editForm.totalAmount !== '' ? Number(editForm.totalAmount) : null;
      const reqNum = editForm.requestedAmount !== '' ? Number(editForm.requestedAmount) : totalNum;

      const payload = {
        merchantName: editForm.merchantName || null,
        receiptDate: editForm.receiptDate || null,
        totalAmount: totalNum,
        requestedAmount: reqNum,
        description: editForm.description || null,
        reimbursementDescription: editForm.description || null,
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

  // Deterministic Policy Validation
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
        throw new Error(data.error?.message || 'Policy validation failed');
      }
      setValidation(data.validation);
    } catch (err) {
      setValidationError(err.message);
    } finally {
      setValidatingLoading(false);
    }
  }

  // Workflow Actions (Submit, Approve, Reject, Request Correction)
  async function handleWorkflowAction(actionType, reason = '') {
    if (!receipt?.id || !authToken) return;
    setActionLoading(true);
    setWorkflowError(null);

    let endpoint = '';
    const body = {};

    if (actionType === 'SUBMIT') {
      endpoint = `/api/receipts/${receipt.id}/workflow/submit`;
    } else if (actionType === 'APPROVE') {
      endpoint = `/api/receipts/${receipt.id}/workflow/approve`;
    } else if (actionType === 'REJECT') {
      endpoint = `/api/receipts/${receipt.id}/workflow/reject`;
      body.reason = reason;
    } else if (actionType === 'REQUEST_CORRECTION') {
      endpoint = `/api/receipts/${receipt.id}/workflow/request-correction`;
      body.reason = reason;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `Action ${actionType} failed`);
      }

      setWorkflowData(data.workflow);
      setReasonModal(null);
      if (onWorkflowUpdated) onWorkflowUpdated();
    } catch (err) {
      setWorkflowError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  const isOcrCompleted = receipt.ocrStatus === 'COMPLETED';
  const effective = extraction?.effectiveValues || {};
  const isSubmitter = currentUser && (receipt.uploaded_by === currentUser.id || receipt.uploadedBy === currentUser.id);
  const isManager = currentUser?.role === 'MANAGER';
  const currentState = workflowData?.currentState || 'DRAFT';

  const getStatusClass = (st) => {
    switch (st) {
      case 'APPROVED': return 'approved';
      case 'PENDING_APPROVAL': return 'pending';
      case 'CORRECTION_REQUESTED': return 'correction';
      case 'REJECTED': return 'rejected';
      default: return 'draft';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner / Dossier Header */}
      <div className="table-card" style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--gold-bg-subtle)', color: 'var(--gold-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>
            🧾
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {effective.merchantName || receipt.originalFilename || 'Receipt Voucher'}
              </h3>
              <span className={`status-pill ${getStatusClass(currentState)}`}>
                <span className="status-dot"></span>
                <span>{currentState.replace('_', ' ')}</span>
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Voucher ID: <code style={{ color: 'var(--text-primary)' }}>{receipt.id.slice(0, 13)}...</code> &bull; Uploaded: {new Date(receipt.createdAt || receipt.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {onRetakePicture && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              id="retake-picture-header-btn"
              onClick={onRetakePicture}
            >
              📷 Retake Picture
            </button>
          )}
          {onAddMoreReceipts && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              id="add-more-receipts-header-btn"
              onClick={onAddMoreReceipts}
            >
              ➕ Add More Receipts
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
            id="delete-receipt-header-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            🗑️ Delete Request
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowRawOcr(true)}
            disabled={!receipt.ocrRawText && !receipt.ocr_raw_text}
          >
            📄 Raw OCR Text
          </button>
          {!extraction && (
            <button
              type="button"
              className="btn btn-gold btn-sm"
              id="extract-ai-fields-btn"
              onClick={handleTriggerExtraction}
              disabled={loadingExtraction || !isOcrCompleted}
            >
              {loadingExtraction ? 'Extracting...' : '✨ Run AI Extraction'}
            </button>
          )}
        </div>
      </div>

      {/* Main Split Inspection View (Stitch Screen 2 & Screen 3) */}
      <div className="split-view-container">
        {/* Left Panel: Physical Scan View */}
        <div className="split-panel">
          <div className="split-panel-header">
            <span className="split-panel-title">Physical Scan View</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <span className={`status-pill ${(receipt.ocrStatus === 'COMPLETED' || receipt.ocr_status === 'COMPLETED') ? 'policy-pass' : (receipt.ocrStatus === 'FAILED' || receipt.ocr_status === 'FAILED') ? 'rejected' : 'draft'}`}>
                <span className="status-dot"></span>
                <span>OCR: {receipt.ocrStatus || receipt.ocr_status}</span>
              </span>
              <span className="status-pill draft">300 DPI</span>
            </div>
          </div>

          <div className="split-panel-body">
            {(receipt.ocrStatus === 'FAILED' || receipt.ocr_status === 'FAILED') && (
              <div className="alert alert-danger" style={{ marginBottom: '14px' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>⚠️ OCR Text Extraction Failed</div>
                <div style={{ fontSize: '0.8125rem' }}>
                  The uploaded receipt image could not be parsed clearly. You can retake the picture using your live camera, upload a clearer file, or delete this failed request.
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-gold btn-sm"
                    onClick={handleRetryOcr}
                    disabled={retryOcrLoading}
                  >
                    🔄 {retryOcrLoading ? 'Retrying OCR...' : 'Retry OCR Parsing'}
                  </button>
                  {onRetakePicture && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={onRetakePicture}
                    >
                      📷 Open Camera &amp; Retake
                    </button>
                  )}
                  {onAddMoreReceipts && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={onAddMoreReceipts}
                    >
                      📁 Browse &amp; Upload New File
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    🗑️ Delete Failed Request
                  </button>
                </div>

              </div>
            )}
            <div className="scan-preview-box">
              <img
                src={`/api/receipts/${receipt.id}/file`}
                alt="Receipt Scan"
                className="scan-image"
                style={{ transform: `scale(${zoomLevel})` }}
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <div className="scan-controls">
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Zoom Out"
                  onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                >
                  🔍-
                </button>
                <span style={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600 }}>
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Zoom In"
                  onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.2))}
                >
                  🔍+
                </button>
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Reset"
                  onClick={() => setZoomLevel(1)}
                >
                  Reset
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '0.75rem', background: '#f8fafc', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>FILE FORMAT</span>
                <strong>{receipt.mimeType || 'Image'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>FILE SIZE</span>
                <strong>{((receipt.fileSizeBytes || receipt.file_size_bytes || 0) / 1024).toFixed(1)} KB</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>STORAGE ENCRYPTION</span>
                <strong style={{ color: '#047857' }}>Encrypted at Rest</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: OCR Extracted Details & Policy Validation */}
        <div className="split-panel">
          <div className="split-panel-header">
            <span className="split-panel-title">OCR Extracted Details</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {extraction && (
                <span className="status-pill policy-pass">
                  <span className="status-dot"></span>
                  <span>AI Confidence: {Math.round((extraction.aiData?.confidenceScore || 0.92) * 100)}%</span>
                </span>
              )}
              {!isEditing && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    initEditForm(extraction);
                    setIsEditing(true);
                  }}
                >
                  ✏️ {extraction ? 'Edit Details & Claim' : 'Enter Details Manually'}
                </button>
              )}
            </div>
          </div>

          <div className="split-panel-body">
            {extractError && (
              <div className="alert alert-danger">
                <strong>Error:</strong> {extractError}
              </div>
            )}
            {saveSuccess && (
              <div className="alert alert-success">
                Confirmed values updated successfully. AI provenance preserved.
              </div>
            )}

            {!extraction && !loadingExtraction && !isEditing && (
              <div style={{ textAlign: 'center', padding: '30px 20px', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-default)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                  {isOcrCompleted
                    ? 'OCR text captured. Extract structured fields with assistive AI, or enter and adjust your reimbursement details manually.'
                    : 'OCR parsing not yet complete or needs retry. You can run OCR, or directly enter your reimbursement details and requested amount.'}
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {isOcrCompleted && (
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={handleTriggerExtraction}
                      disabled={loadingExtraction}
                    >
                      🚀 Run Structured AI Extraction
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      initEditForm(null);
                      setIsEditing(true);
                    }}
                  >
                    ✏️ Enter Details &amp; Request Manually
                  </button>
                  {(receipt.ocrStatus === 'FAILED' || receipt.ocr_status === 'FAILED') && (
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={handleRetryOcr}
                      disabled={retryOcrLoading}
                    >
                      🔄 {retryOcrLoading ? 'Parsing with RapidOCR...' : 'Retry OCR Text Extraction'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {loadingExtraction && (
              <div className="alert alert-info">
                Analyzing receipt text with AI understanding service...
              </div>
            )}

            {/* Extracted Form Fields (View Mode) */}
            {extraction && !isEditing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-grid-2">
                  <div className="form-group">
                    <span className="form-label">Merchant / Payee Name</span>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{effective.merchantName || '—'}</div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Transaction Date</span>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      {effective.receiptDate ? new Date(effective.receiptDate).toLocaleDateString() : '—'}
                    </div>
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <span className="form-label">Tax Invoice / Receipt #</span>
                    <div style={{ fontWeight: 600 }}>{effective.receiptNumber || '—'}</div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Expense Category</span>
                    <div>
                      <span className="status-pill draft">{effective.category || 'Other'}</span>
                    </div>
                  </div>
                </div>

                {/* Financial Summary: Receipt Total vs Requested Reimbursement Amount */}
                <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '12px', alignItems: 'center' }}>
                  <div className="form-group">
                    <span className="form-label">Receipt Slip Total</span>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-secondary)' }}>
                      {effective.currency || 'INR'} {Number(effective.totalAmount || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="form-group" style={{ background: 'var(--gold-bg-subtle)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gold-border-subtle)' }}>
                    <span className="form-label" style={{ color: 'var(--gold-hover)', fontWeight: 700, fontSize: '0.75rem' }}>
                      ★ Requested Reimbursement
                    </span>
                    <div style={{ fontWeight: 800, fontSize: '1.3rem', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                      {effective.currency || 'INR'} {Number(effective.requestedAmount ?? effective.totalAmount ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="form-group">
                    <span className="form-label">Tax / GST Amount</span>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {effective.taxAmount !== null ? `${effective.currency || 'INR'} ${Number(effective.taxAmount).toFixed(2)}` : '0.00'}
                    </div>
                  </div>
                </div>

                {/* Employee Request Explanation & Business Justification */}
                <div style={{ background: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span className="form-label" style={{ color: 'var(--text-primary)', fontWeight: 700, margin: 0 }}>
                      📝 Employee Business Purpose &amp; Description
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Required for Approval Review</span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }}>
                    {effective.reimbursementDescription ? (
                      effective.reimbursementDescription
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No description provided yet. Click "Edit Details &amp; Claim" above to write an explanation for your reimbursement request.
                      </span>
                    )}
                  </p>
                </div>

                {/* Line Items if present */}
                {extraction.lineItems && extraction.lineItems.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <span className="form-label" style={{ marginBottom: '6px', display: 'block' }}>Parsed Line Items</span>
                    <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 0' }}>Item Description</th>
                          <th style={{ textAlign: 'right', padding: '6px 0' }}>Qty</th>
                          <th style={{ textAlign: 'right', padding: '6px 0' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extraction.lineItems.map((li, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 0' }}>{li.description}</td>
                            <td style={{ textAlign: 'right', padding: '6px 0' }}>{li.quantity || 1}</td>
                            <td style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>
                              {li.totalAmount ? `$${Number(li.totalAmount).toFixed(2)}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Editable Form Mode (Allows updating OCR details, requested amount, and description) */}
            {isEditing && (
              <form onSubmit={handleSaveConfirmed} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: '#854d0e' }}>
                  ✏️ <strong>Employee Correction &amp; Reimbursement Claim Form:</strong> Modify any values parsed by OCR, adjust your requested claim amount, and explain your business request below.
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Merchant / Vendor Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.merchantName}
                      onChange={(e) => setEditForm({ ...editForm, merchantName: e.target.value })}
                      placeholder="e.g. The Urban Brew Café"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Transaction Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={editForm.receiptDate}
                      onChange={(e) => setEditForm({ ...editForm, receiptDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr', gap: '10px' }}>
                  <div className="form-group">
                    <label className="form-label">Invoice / Receipt #</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.receiptNumber}
                      onChange={(e) => setEditForm({ ...editForm, receiptNumber: e.target.value })}
                      placeholder="e.g. EE20261008-0147"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Expense Category</label>
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
                  <div className="form-group">
                    <label className="form-label">Currency</label>
                    <select
                      className="form-select"
                      value={editForm.currency}
                      onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '10px', background: '#f8fafc', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div className="form-group">
                    <label className="form-label">Receipt Slip Total</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      value={editForm.totalAmount}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditForm((prev) => ({
                          ...prev,
                          totalAmount: val,
                          // If requested amount was empty or equal to previous total, keep in sync
                          requestedAmount: prev.requestedAmount === '' || prev.requestedAmount === prev.totalAmount ? val : prev.requestedAmount,
                        }));
                      }}
                      placeholder="0.00"
                      required
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '3px' }}>
                      Exact total on receipt slip
                    </span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--gold-hover)', fontWeight: 700 }}>
                      ★ Requested Reimbursement
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      style={{ fontWeight: 700, borderColor: 'var(--gold-primary)', background: '#fff' }}
                      value={editForm.requestedAmount}
                      onChange={(e) => setEditForm({ ...editForm, requestedAmount: e.target.value })}
                      placeholder="0.00"
                      required
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--gold-hover)', display: 'block', marginTop: '3px' }}>
                      Amount you are claiming (can be partial)
                    </span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tax / GST Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      value={editForm.taxAmount}
                      onChange={(e) => setEditForm({ ...editForm, taxAmount: e.target.value })}
                      placeholder="0.00"
                    />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '3px' }}>
                      Applicable GST or tax
                    </span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    Description &amp; Request Business Purpose <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Provide a clear explanation for this reimbursement request (e.g., Client lunch meeting with Acme Corp team to review deployment roadmap; 3 participants attended)."
                    style={{ resize: 'vertical' }}
                  />
                  <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                    Explaining your request helps your manager review and approve your voucher quickly without requesting corrections.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-dark" disabled={saveLoading}>
                    {saveLoading ? 'Saving...' : '💾 Save Confirmed Details & Claim'}
                  </button>
                </div>
              </form>
            )}


            {/* Policy & Data Validation Section */}
            <div className="policy-checklist-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                  Policy &amp; Data Validation
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleRunValidation}
                  disabled={validatingLoading || !extraction}
                >
                  {validatingLoading ? 'Evaluating...' : '⚡ Validate Rules'}
                </button>
              </div>

              {validationError && (
                <div className="alert alert-danger" style={{ marginBottom: '8px' }}>
                  {validationError}
                </div>
              )}

              {validation ? (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="policy-item">
                    <span className="policy-label">
                      <span>{validation.validationStatus === 'PASSED' ? '✅' : '⚠️'}</span>
                      <span>Policy Compliance Check</span>
                    </span>
                    <span className={`status-pill ${validation.validationStatus === 'PASSED' ? 'policy-pass' : 'policy-warn'}`}>
                      {validation.validationStatus}
                    </span>
                  </div>

                  <div className="policy-item">
                    <span className="policy-label">
                      <span>{validation.duplicateStatus === 'NO_MATCH' ? '✅' : '🔍'}</span>
                      <span>Duplicate Similarity Check</span>
                    </span>
                    <span className={`status-pill ${validation.duplicateStatus === 'NO_MATCH' ? 'policy-pass' : 'policy-warn'}`}>
                      {validation.duplicateStatus} ({((validation.duplicateScore || 0) * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Validation not yet executed for this receipt. Run validation before submitting.
                </p>
              )}
            </div>

            {/* Workflow & Decision Action Bar */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {workflowError && (
                <div className="alert alert-danger">
                  <strong>Workflow Error:</strong> {workflowError}
                </div>
              )}

              {/* Submitter Actions (EMPLOYEE) */}
              {isSubmitter && (currentState === 'DRAFT' || currentState === 'CORRECTION_REQUESTED') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-gold btn-lg"
                    style={{ width: '100%' }}
                    onClick={() => handleWorkflowAction('SUBMIT')}
                    disabled={actionLoading || !extraction}
                  >
                    {actionLoading ? 'Submitting...' : '🚀 Submit for Approval'}
                  </button>
                </div>
              )}

              {/* Manager Actions */}
              {isManager && currentState === 'PENDING_APPROVAL' && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Manager Sign-Off Decisions
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-gold"
                      style={{ flex: 1 }}
                      onClick={() => handleWorkflowAction('APPROVE')}
                      disabled={actionLoading}
                    >
                      {actionLoading ? 'Approving...' : '✓ Approve Expense'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-warning"
                      onClick={() => setReasonModal({ type: 'REQUEST_CORRECTION', reason: '' })}
                      disabled={actionLoading}
                    >
                      ↺ Request Correction
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setReasonModal({ type: 'REJECT', reason: '' })}
                      disabled={actionLoading}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Chronological Audit Trail */}
              {workflowData?.actions && workflowData.actions.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <span className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Workflow Audit Trail</span>
                  <div className="timeline-list">
                    {workflowData.actions.map((act) => (
                      <div key={act.id} className="timeline-item">
                        <div className="timeline-dot"></div>
                        <span className="timeline-time">
                          {new Date(act.created_at || act.createdAt).toLocaleString()} &bull; <strong>{act.actorRole || act.actor_role}</strong>
                        </span>
                        <div className="timeline-text">
                          <strong>{act.action}</strong>
                          {act.reason && <div style={{ color: 'var(--text-secondary)', marginTop: '2px', fontStyle: 'italic' }}>"{act.reason}"</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Raw OCR Text Modal */}
      {showRawOcr && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4 className="modal-title">Raw Tesseract OCR Text</h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowRawOcr(false)}>✕</button>
            </div>
            <div className="modal-body">
              <pre style={{ background: '#f8fafc', padding: '14px', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto' }}>
                {receipt.ocrRawText || receipt.ocr_raw_text || 'No text extracted.'}
              </pre>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowRawOcr(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Reason Modal for Rejection / Correction */}
      {reasonModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4 className="modal-title">
                {reasonModal.type === 'REJECT' ? 'Reject Expense Claim' : 'Request Expense Correction'}
              </h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setReasonModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Please specify a mandatory reason for this decision. This will be preserved in the audit trail.
              </p>
              <textarea
                className="form-textarea"
                placeholder="Enter explanation..."
                value={reasonModal.reason}
                onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
                required
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setReasonModal(null)}>Cancel</button>
              <button
                type="button"
                className={`btn ${reasonModal.type === 'REJECT' ? 'btn-danger' : 'btn-warning'}`}
                disabled={!reasonModal.reason.trim() || actionLoading}
                onClick={() => handleWorkflowAction(reasonModal.type, reasonModal.reason)}
              >
                {actionLoading ? 'Recording...' : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Receipt Voucher Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h4 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626' }}>
                <span>🗑️</span> Delete Receipt Voucher?
              </h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowDeleteConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Are you sure you want to permanently delete this receipt voucher request (<strong>{receipt.originalFilename || receipt.original_filename || 'Receipt Voucher'}</strong>)?
              </p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                This will purge the physical scan image and all associated extraction and validation data from the system. This action cannot be undone.
              </p>

              {deleteError && (
                <div className="alert alert-danger" style={{ marginTop: '12px' }}>
                  <strong>Error:</strong> {deleteError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{ backgroundColor: '#dc2626', color: '#ffffff', borderColor: '#dc2626' }}
                onClick={handleDeleteReceipt}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting Voucher...' : 'Yes, Delete Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
