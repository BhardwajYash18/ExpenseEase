import React, { useState, useEffect } from 'react';
import {
  IconReceipt,
  IconCamera,
  IconPlus,
  IconTrash,
  IconFileText,
  IconSparkles,
  IconCoins,
  IconCalendar,
  IconTag,
  IconEdit,
  IconClock,
  IconSend,
  IconCheckCircle,
  IconXCircle,
  IconShield,
  IconUser,
  IconStar,
  IconLock,
  IconCheck,
  IconUndo,
  IconX,
  IconSplit,
  IconClipboard,
  IconZoomIn,
  IconZoomOut,
  IconAlertTriangle,
  IconRefresh,
  IconFolder,
  IconMaximize,
  IconSave,
  IconZap,
  IconSearch,
  IconEye,
  IconInfo,
  IconExternalLink,
} from './Icons';

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
  const [inspectorTab, setInspectorTab] = useState('split'); // 'split' | 'scan' | 'details'
  const [showFullImageModal, setShowFullImageModal] = useState(false);

  // Authenticated Image File Preview States
  const [imageObjectUrl, setImageObjectUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageLoadError, setImageLoadError] = useState(false);

  // Load authenticated receipt image file
  useEffect(() => {
    let isMounted = true;
    if (!receipt?.id || !authToken) return;

    setImageLoading(true);
    setImageLoadError(false);

    fetch(`/api/receipts/${receipt.id}/file`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load image');
        return res.blob();
      })
      .then((blob) => {
        if (isMounted) {
          const url = URL.createObjectURL(blob);
          setImageObjectUrl(url);
          setImageLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setImageLoadError(true);
          setImageLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [receipt?.id, authToken]);

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
          // If OCR is completed, automatically trigger structured extraction
          if (receipt.ocrStatus === 'COMPLETED' || receipt.ocr_status === 'COMPLETED') {
            try {
              const triggerRes = await fetch(`/api/receipts/${receipt.id}/extraction`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${authToken}`,
                  'Content-Type': 'application/json',
                },
              });
              const triggerData = await triggerRes.json();
              if (triggerRes.ok && isMounted && triggerData.extraction) {
                setExtraction(triggerData.extraction);
                if (!isEditing) {
                  initEditForm(triggerData.extraction);
                }
              }
            } catch (_) {}
          }
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || 'Failed to fetch extraction');
        }
        if (isMounted) {
          setExtraction(data.extraction);
          if (!isEditing) {
            initEditForm(data.extraction);
          }
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

    const rawItems = Array.isArray(ext?.lineItems) ? ext.lineItems : [];
    const lineItems = rawItems.map((li) => ({
      id: li.id || null,
      lineNumber: li.lineNumber,
      description: li.description || '',
      quantity: li.quantity != null ? Number(li.quantity) : 1,
      unitPrice: li.unitPrice != null ? Number(li.unitPrice) : null,
      totalPrice: li.totalPrice != null ? Number(li.totalPrice) : null,
    }));

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
      lineItems,
      deletedLineItemIds: [],
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

  // Save Confirmed Values (manual edits, requested amount, business description, and line items)
  async function handleSaveConfirmed(e = null) {
    if (e && e.preventDefault) e.preventDefault();
    setSaveLoading(true);
    setExtractError(null);
    setSaveSuccess(false);

    try {
      // Validate line items: product name must not be empty and quantity must be positive number
      const items = editForm.lineItems || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.description || !String(item.description).trim()) {
          throw new Error(`Product / item name on row ${i + 1} cannot be empty.`);
        }
        const qtyNum = Number(item.quantity);
        if (isNaN(qtyNum) || qtyNum <= 0) {
          throw new Error(`Quantity on row ${i + 1} must be a valid positive number.`);
        }
      }

      const totalNum = editForm.totalAmount !== '' && editForm.totalAmount !== null ? Number(editForm.totalAmount) : null;
      const reqNum = editForm.requestedAmount !== '' && editForm.requestedAmount !== null ? Number(editForm.requestedAmount) : totalNum;

      const payload = {
        merchantName: editForm.merchantName || null,
        receiptDate: editForm.receiptDate || null,
        totalAmount: totalNum,
        requestedAmount: reqNum,
        description: editForm.description || null,
        reimbursementDescription: editForm.description || null,
        subtotalAmount: editForm.subtotalAmount !== '' && editForm.subtotalAmount !== null ? Number(editForm.subtotalAmount) : null,
        taxAmount: editForm.taxAmount !== '' && editForm.taxAmount !== null ? Number(editForm.taxAmount) : null,
        currency: editForm.currency || 'USD',
        receiptNumber: editForm.receiptNumber || null,
        category: editForm.category || 'Other',
        lineItems: items.map((li) => ({
          id: li.id || undefined,
          description: String(li.description).trim(),
          quantity: Number(li.quantity),
          unitPrice: li.unitPrice != null ? Number(li.unitPrice) : null,
          totalPrice: li.totalPrice != null ? Number(li.totalPrice) : null,
        })),
        deletedLineItemIds: editForm.deletedLineItemIds || [],
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
      return true;
    } catch (err) {
      setExtractError(err.message);
      return false;
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

    // Save pending edits before submitting claim; abort submission if saving fails
    if (actionType === 'SUBMIT' && isEditing) {
      const saveSucceeded = await handleSaveConfirmed();
      if (!saveSucceeded) {
        setActionLoading(false);
        setWorkflowError('Please correct any validation errors and ensure your changes are saved before submitting.');
        return;
      }
    }

    // If submitting, automatically execute policy validation if not already completed
    if (actionType === 'SUBMIT') {
      try {
        const valRes = await fetch(`/api/receipts/${receipt.id}/validation`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        });
        const valData = await valRes.json();
        if (valRes.ok && valData.validation) {
          setValidation(valData.validation);
        }
      } catch (_) {
        // Continue to submission attempt which will enforce business rule
      }
    }

    let endpoint = '';
    const body = {};

    if (actionType === 'SUBMIT') {
      endpoint = `/api/receipts/${receipt.id}/workflow/submit`;
    } else if (actionType === 'APPROVE') {
      endpoint = `/api/receipts/${receipt.id}/workflow/approve`;
      if (reason && reason.trim()) {
        body.comment = reason.trim();
      }
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

  const isOcrCompleted = receipt.ocrStatus === 'COMPLETED' || receipt.ocr_status === 'COMPLETED';
  const effective = extraction?.effectiveValues || {};
  const isEmployee = currentUser?.role === 'EMPLOYEE';
  const isManager = currentUser?.role === 'MANAGER';
  const isFinance = currentUser?.role === 'FINANCE';
  const isSelfSubmitted = Boolean(
    currentUser?.id && (
      receipt.uploaded_by === currentUser.id ||
      receipt.uploadedBy === currentUser.id ||
      workflowData?.submittedBy === currentUser.id
    )
  );
  const isSubmitter = isSelfSubmitted || (isEmployee && !receipt.uploaded_by);
  const currentState = workflowData?.currentState || 'DRAFT';
  const canEditDetails = (isSubmitter || isSelfSubmitted) && (currentState === 'DRAFT' || currentState === 'CORRECTION_REQUESTED');

  const latestCorrectionAction = workflowData?.history?.slice().reverse().find(
    (a) => a.action === 'REQUEST_CORRECTION' && a.reason
  );
  const latestCorrectionReason = latestCorrectionAction?.reason || null;

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
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--gold-bg-subtle)', color: 'var(--gold-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconReceipt size={22} />
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
              Voucher ID: <code style={{ color: 'var(--text-primary)' }}>{(receipt?.id || '').slice(0, 13)}...</code> &bull; Uploaded: {receipt?.createdAt || receipt?.created_at ? new Date(receipt.createdAt || receipt.created_at).toLocaleDateString() : '—'}
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <IconCamera size={14} /> Retake Picture
            </button>
          )}
          {onAddMoreReceipts && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              id="add-more-receipts-header-btn"
              onClick={onAddMoreReceipts}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <IconPlus size={14} /> Add More Receipts
            </button>
          )}
          {isSubmitter && (currentState === 'DRAFT' || currentState === 'CORRECTION_REQUESTED') && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ color: '#ef4444', borderColor: '#fca5a5', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              id="delete-receipt-header-btn"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <IconTrash size={14} /> Delete Request
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowRawOcr(true)}
            disabled={!receipt.ocrRawText && !receipt.ocr_raw_text}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <IconFileText size={14} /> Raw OCR Text
          </button>
          {!extraction && (
            <button
              type="button"
              className="btn btn-gold btn-sm"
              id="extract-ai-fields-btn"
              onClick={handleTriggerExtraction}
              disabled={loadingExtraction || !isOcrCompleted}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {loadingExtraction ? (
                <><IconClock size={14} className="spin" /> Extracting...</>
              ) : (
                <><IconSparkles size={14} /> Run AI Extraction</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Prominent Expense Claim Submission Bar for Submitter (Employee or Submitting Manager) */}
      {(isSubmitter || !isManager) && (
        <div
          className="table-card"
          id="claim-submission-banner"
          style={{
            padding: '20px 24px',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid #334155',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: '280px' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--gold-primary) 0%, var(--gold-hover) 100%)',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(217, 119, 6, 0.35)',
                flexShrink: 0,
              }}
            >
              <IconCoins size={26} color="#0f172a" />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', fontWeight: 700 }}>
                Recognized Expense Claim
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
                  {effective.merchantName || editForm.merchantName || 'Recognized Vendor'}
                </span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fbbf24' }}>
                  {effective.currency || editForm.currency || 'INR'}{' '}
                  {effective.requestedAmount !== null && effective.requestedAmount !== undefined
                    ? Number(effective.requestedAmount).toFixed(2)
                    : effective.totalAmount !== null && effective.totalAmount !== undefined
                    ? Number(effective.totalAmount).toFixed(2)
                    : editForm.requestedAmount !== '' && editForm.requestedAmount !== undefined
                    ? Number(editForm.requestedAmount).toFixed(2)
                    : editForm.totalAmount !== '' && editForm.totalAmount !== undefined
                    ? Number(editForm.totalAmount).toFixed(2)
                    : '0.00'}
                </span>
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#cbd5e1', marginTop: '4px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><IconCalendar size={13} /> {effective.receiptDate || editForm.receiptDate || 'Date: N/A'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><IconTag size={13} /> {effective.category || editForm.category || 'Other'}</span>
                {effective.taxAmount !== null && effective.taxAmount !== undefined && (
                  <span style={{ color: '#94a3b8' }}>Tax: {Number(effective.taxAmount).toFixed(2)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Claim Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {isSubmitter && (currentState === 'DRAFT' || currentState === 'CORRECTION_REQUESTED') ? (
              <>
                {!isEditing && (
                  <button
                    type="button"
                    className="btn btn-outline btn-md"
                    id="btn-banner-edit-claim"
                    style={{ color: '#f8fafc', borderColor: '#475569', background: 'rgba(255, 255, 255, 0.05)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => {
                      initEditForm(extraction);
                      setIsEditing(true);
                    }}
                  >
                    <IconEdit size={14} /> Adjust Name / Amount
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-gold btn-lg"
                  id="btn-banner-submit-claim"
                  style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    padding: '12px 24px',
                    boxShadow: '0 4px 14px rgba(217, 119, 6, 0.4)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onClick={() => handleWorkflowAction('SUBMIT')}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <><IconClock size={16} className="spin" /> Submitting Claim...</>
                  ) : currentState === 'CORRECTION_REQUESTED' ? (
                    <><IconSend size={16} /> Resubmit Expense Claim</>
                  ) : (
                    <><IconSend size={16} /> Submit Expense Claim</>
                  )}
                </button>
              </>
            ) : currentState === 'PENDING_APPROVAL' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '10px 16px', borderRadius: 'var(--radius-md)' }}>
                <IconClock size={20} color="#93c5fd" />
                <div>
                  <div style={{ fontWeight: 700, color: '#93c5fd', fontSize: '0.875rem' }}>Claim Submitted</div>
                  <div style={{ fontSize: '0.75rem', color: '#bfdbfe' }}>Queued for Manager review &amp; approval</div>
                </div>
              </div>
            ) : currentState === 'APPROVED' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px 16px', borderRadius: 'var(--radius-md)' }}>
                <IconCheckCircle size={20} color="#10b981" />
                <div>
                  <div style={{ fontWeight: 700, color: '#6ee7b7', fontSize: '0.875rem' }}>Claim Approved</div>
                  <div style={{ fontSize: '0.75rem', color: '#a7f3d0' }}>Ready for Finance Batch processing</div>
                </div>
              </div>
            ) : currentState === 'REJECTED' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px 16px', borderRadius: 'var(--radius-md)' }}>
                <IconXCircle size={20} color="#ef4444" />
                <div>
                  <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: '0.875rem' }}>Claim Rejected</div>
                  <div style={{ fontSize: '0.75rem', color: '#fecaca' }}>Check audit log for reason</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Top Manager Review & Decision Bar (Prominent, Uncompressed, Right at the Top) */}
      {isManager && (
        <div
          className="table-card"
          id="manager-decision-bar"
          style={{
            padding: '18px 24px',
            background: '#ffffff',
            border: currentState === 'PENDING_APPROVAL' ? '2px solid var(--gold-primary)' : '1px solid var(--border-subtle)',
            boxShadow: currentState === 'PENDING_APPROVAL' ? '0 4px 16px rgba(229, 169, 59, 0.15)' : 'var(--shadow-xs)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ minWidth: '220px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconShield size={20} color="var(--gold-hover)" />
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Manager Review &amp; Decision Bar
                </h4>
                <span className={`status-pill ${getStatusClass(currentState)}`}>
                  {currentState.replace('_', ' ')}
                </span>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Claimant: <IconUser size={13} /> <strong>{receipt.employeeName || 'Employee'}</strong> &bull; {receipt.employeeEmail || ''}
              </div>
            </div>

            {/* Financial Comparison Highlights */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f8fafc', padding: '10px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Slip Total</span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {effective.currency || 'INR'} {effective.totalAmount !== null && effective.totalAmount !== undefined ? Number(effective.totalAmount).toFixed(2) : '0.00'}
                </span>
              </div>
              <div style={{ width: '1px', height: '28px', background: 'var(--border-subtle)' }}></div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--gold-hover)', display: 'inline-flex', alignItems: 'center', gap: '3px', textTransform: 'uppercase', fontWeight: 700 }}>
                  <IconStar size={11} /> Claimed Reimbursement
                </span>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold-hover)', fontFamily: 'var(--font-display)', display: 'block' }}>
                  {effective.currency || 'INR'} {effective.requestedAmount !== null && effective.requestedAmount !== undefined ? Number(effective.requestedAmount).toFixed(2) : (effective.totalAmount !== null && effective.totalAmount !== undefined ? Number(effective.totalAmount).toFixed(2) : '0.00')}
                </span>
              </div>
            </div>

            {/* Decision Controls: If self-submitted, prohibit self-approval/rejection under separation of duties */}
            {isSelfSubmitted ? (
              <div
                id="self-approval-forbidden-banner"
                style={{
                  padding: '10px 18px',
                  background: '#fffbeb',
                  border: '1px solid #fef3c7',
                  borderRadius: 'var(--radius-md)',
                  color: '#92400e',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <IconLock size={15} color="#92400e" />
                <span>
                  <strong>Self-Approval &amp; Rejection Prohibited:</strong> You submitted this claim. Under company policy, another authorized manager must review and sign off on it.
                </span>
              </div>
            ) : (
              currentState === 'PENDING_APPROVAL' && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-gold btn-md"
                    id="btn-manager-approve-top"
                    style={{ padding: '10px 22px', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 8px rgba(229,169,59,0.35)' }}
                    onClick={() => setReasonModal({ type: 'APPROVE', reason: '' })}
                    disabled={actionLoading}
                  >
                    <IconCheck size={16} /> Approve Claim
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-md"
                    id="btn-manager-correct-top"
                    style={{ padding: '10px 18px', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setReasonModal({ type: 'REQUEST_CORRECTION', reason: '' })}
                    disabled={actionLoading}
                  >
                    <IconUndo size={16} /> Request Correction
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-md"
                    id="btn-manager-reject-top"
                    style={{ padding: '10px 18px', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setReasonModal({ type: 'REJECT', reason: '' })}
                    disabled={actionLoading}
                  >
                    <IconX size={16} /> Reject
                  </button>
                </div>
              )
            )}

            {currentState === 'DRAFT' && (
              <div style={{ padding: '8px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', color: '#1e40af', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconClock size={15} /> <strong>DRAFT:</strong> Submitter has not submitted this voucher yet. Approval options will unlock once submitted.
              </div>
            )}

            {currentState === 'APPROVED' && (
              <div style={{ padding: '8px 18px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 'var(--radius-md)', color: '#065f46', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconCheckCircle size={16} color="#10b981" /> Claim Approved by Manager &bull; Queued for Finance Processing
              </div>
            )}

            {currentState === 'CORRECTION_REQUESTED' && (
              <div style={{ padding: '8px 18px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', color: '#92400e', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconUndo size={16} color="#d97706" /> Returned to Employee for Correction &bull; Awaiting Resubmission
              </div>
            )}

            {currentState === 'REJECTED' && (
              <div style={{ padding: '8px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', color: '#991b1b', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <IconXCircle size={16} color="#ef4444" /> Claim Rejected by Manager
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inspector View Mode Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '6px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-xs)', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: inspectorTab === 'split' ? 'var(--gold-bg-subtle)' : 'transparent',
              color: inspectorTab === 'split' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              fontWeight: inspectorTab === 'split' ? 700 : 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => setInspectorTab('split')}
          >
            <IconSplit size={14} /> Side-by-Side Review
          </button>
          <button
            type="button"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: inspectorTab === 'scan' ? 'var(--gold-bg-subtle)' : 'transparent',
              color: inspectorTab === 'scan' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              fontWeight: inspectorTab === 'scan' ? 700 : 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => setInspectorTab('scan')}
          >
            <IconCamera size={14} /> Full Document Scan
          </button>
          <button
            type="button"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: inspectorTab === 'details' ? 'var(--gold-bg-subtle)' : 'transparent',
              color: inspectorTab === 'details' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              fontWeight: inspectorTab === 'details' ? 700 : 500,
              fontSize: '0.8125rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => setInspectorTab('details')}
          >
            <IconClipboard size={14} /> Extracted Data &amp; Policy
          </button>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => setShowFullImageModal(true)}
          style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          title="Open full resolution photo in modal overlay"
        >
          <IconZoomIn size={14} /> Enlarge Receipt Image
        </button>
      </div>

      {/* Main Split Inspection View (Stitch Screen 2 & Screen 3) */}
      <div
        className="split-view-container"
        style={{
          display: 'grid',
          gridTemplateColumns: inspectorTab === 'split' ? 'repeat(auto-fit, minmax(360px, 1fr))' : '1fr',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* Left Panel: Physical Scan View */}
        {(inspectorTab === 'split' || inspectorTab === 'scan') && (
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
                <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconAlertTriangle size={16} color="#ef4444" /> OCR Text Extraction Failed
                </div>
                <div style={{ fontSize: '0.8125rem' }}>
                  The uploaded receipt image could not be parsed clearly. You can retake the picture using your live camera, upload a clearer file, or delete this failed request.
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-gold btn-sm"
                    onClick={handleRetryOcr}
                    disabled={retryOcrLoading}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <IconRefresh size={14} className={retryOcrLoading ? 'spin' : ''} /> {retryOcrLoading ? 'Retrying OCR...' : 'Retry OCR Parsing'}
                  </button>
                  {onRetakePicture && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={onRetakePicture}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <IconCamera size={14} /> Open Camera &amp; Retake
                    </button>
                  )}
                  {onAddMoreReceipts && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={onAddMoreReceipts}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <IconFolder size={14} /> Browse &amp; Upload New File
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ color: '#ef4444', borderColor: '#fca5a5', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <IconTrash size={14} /> Delete Failed Request
                  </button>
                </div>

              </div>
            )}
            <div className="scan-preview-box">
              {imageLoading && (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                    <IconRefresh size={32} color="#94a3b8" className="spin" />
                  </div>
                  <div>Loading high-resolution voucher scan...</div>
                </div>
              )}
              {imageLoadError && !imageLoading && (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                    <IconCamera size={36} color="#94a3b8" />
                  </div>
                  <div style={{ fontSize: '0.875rem' }}>Receipt preview could not be displayed directly.</div>
                  <a
                    href={`/api/receipts/${receipt.id}/file?token=${encodeURIComponent(authToken)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <IconExternalLink size={14} /> Open Image in New Tab
                  </a>
                </div>
              )}
              {!imageLoadError && (
                <img
                  src={imageObjectUrl || `/api/receipts/${receipt.id}/file?token=${encodeURIComponent(authToken)}`}
                  alt="Receipt Scan"
                  className="scan-image"
                  style={{
                    transform: `scale(${zoomLevel})`,
                    display: imageLoading ? 'none' : 'block',
                  }}
                  onLoad={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoadError(true);
                    setImageLoading(false);
                  }}
                />
              )}
              <div className="scan-controls">
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Zoom Out"
                  onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <IconZoomOut size={14} />
                </button>
                <span style={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600 }}>
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Zoom In"
                  onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.2))}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <IconZoomIn size={14} />
                </button>
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Reset"
                  onClick={() => setZoomLevel(1)}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="scan-control-btn"
                  title="Open Full Resolution Modal"
                  onClick={() => setShowFullImageModal(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <IconMaximize size={14} />
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
        )}

        {/* Right Panel: OCR Extracted Details & Policy Validation */}
        {(inspectorTab === 'split' || inspectorTab === 'details') && (
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
                {canEditDetails && !isEditing && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      initEditForm(extraction);
                      setIsEditing(true);
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <IconEdit size={13} />
                    <span>{extraction ? 'Edit Details & Claim' : 'Enter Details Manually'}</span>
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
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <IconSparkles size={14} />
                      <span>Run Structured AI Extraction</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      initEditForm(null);
                      setIsEditing(true);
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <IconEdit size={14} />
                    <span>Enter Details &amp; Request Manually</span>
                  </button>
                  {(receipt.ocrStatus === 'FAILED' || receipt.ocr_status === 'FAILED') && (
                    <button
                      type="button"
                      className="btn btn-gold"
                      onClick={handleRetryOcr}
                      disabled={retryOcrLoading}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <IconRefresh size={14} className={retryOcrLoading ? 'spin' : ''} />
                      <span>{retryOcrLoading ? 'Parsing with RapidOCR...' : 'Retry OCR Text Extraction'}</span>
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
                    <span className="form-label">Name / Merchant / Payee</span>
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
                <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', alignItems: 'center' }}>
                  <div className="form-group">
                    <span className="form-label">Total Amount / MRP</span>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-secondary)' }}>
                      {effective.currency || 'INR'} {Number(effective.totalAmount || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="form-group" style={{ background: 'var(--gold-bg-subtle)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gold-border-subtle)' }}>
                    <span className="form-label" style={{ color: 'var(--gold-hover)', fontWeight: 700, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconStar size={12} color="var(--gold-hover)" /> Requested Reimbursement
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
                    <span className="form-label" style={{ color: 'var(--text-primary)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconFileText size={14} color="var(--text-primary)" /> Employee Business Purpose &amp; Description
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
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconEdit size={16} color="#854d0e" />
                  <span><strong>Employee Correction &amp; Reimbursement Claim Form:</strong> Modify any values parsed by OCR, adjust your requested claim amount, and explain your business request below.</span>
                </div>

                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Name / Merchant / Vendor</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.merchantName}
                      onChange={(e) => setEditForm({ ...editForm, merchantName: e.target.value })}
                      placeholder="e.g. Rahul Sharma or The Urban Brew Café"
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
                    <label className="form-label">Total Amount / MRP</label>
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
                      Exact total or MRP on receipt slip
                    </span>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--gold-hover)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <IconStar size={12} color="var(--gold-hover)" /> Requested Reimbursement
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

                <div style={{ background: '#f8fafc', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <span className="form-label" style={{ fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <IconClipboard size={14} /> Receipt Products &amp; Quantities
                      </span>
                      <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                        Review and edit OCR-extracted product names and quantities, or manually add missing purchased items.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setEditForm((prev) => ({
                          ...prev,
                          lineItems: [
                            ...(prev.lineItems || []),
                            { id: null, description: '', quantity: 1, unitPrice: null, totalPrice: null },
                          ],
                        }));
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
                    >
                      <IconPlus size={12} /> Add Product
                    </button>
                  </div>

                  {(!editForm.lineItems || editForm.lineItems.length === 0) ? (
                    <div style={{ padding: '12px', textAlign: 'center', background: '#fff', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                      No product line items listed. Click <strong>"Add Product"</strong> above to manually enter missing purchased products.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Product / Item Name *</th>
                            <th style={{ textAlign: 'center', padding: '6px 8px', width: '90px' }}>Qty *</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', width: '90px' }}>Unit Price</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', width: '90px' }}>Total</th>
                            <th style={{ textAlign: 'center', padding: '6px 8px', width: '70px' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editForm.lineItems.map((li, idx) => (
                            <tr key={li.id || `manual-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 8px' }}>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ padding: '6px 10px', fontSize: '0.8125rem', width: '100%' }}
                                  value={li.description || ''}
                                  placeholder="e.g. Arabica Roast Beans or Taxi Fare"
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditForm((prev) => {
                                      const updated = [...prev.lineItems];
                                      updated[idx] = { ...updated[idx], description: val };
                                      return { ...prev, lineItems: updated };
                                    });
                                  }}
                                  required
                                />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <input
                                  type="number"
                                  step="any"
                                  min="0.001"
                                  className="form-input"
                                  style={{ padding: '6px 8px', fontSize: '0.8125rem', width: '75px', textAlign: 'center', display: 'inline-block' }}
                                  value={li.quantity ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditForm((prev) => {
                                      const updated = [...prev.lineItems];
                                      updated[idx] = { ...updated[idx], quantity: val };
                                      return { ...prev, lineItems: updated };
                                    });
                                  }}
                                  required
                                />
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                                {li.unitPrice != null ? `${editForm.currency || 'USD'} ${Number(li.unitPrice).toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {li.totalPrice != null ? `${editForm.currency || 'USD'} ${Number(li.totalPrice).toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ padding: '4px 8px', fontSize: '0.7rem', color: '#ef4444', borderColor: '#fca5a5' }}
                                  onClick={() => {
                                    setEditForm((prev) => {
                                      const removedItem = prev.lineItems[idx];
                                      const updatedList = prev.lineItems.filter((_, i) => i !== idx);
                                      const updatedDeleted = removedItem.id
                                        ? [...(prev.deletedLineItemIds || []), removedItem.id]
                                        : (prev.deletedLineItemIds || []);
                                      return { ...prev, lineItems: updatedList, deletedLineItemIds: updatedDeleted };
                                    });
                                  }}
                                  title="Remove this line item"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                  <button type="submit" className="btn btn-dark" disabled={saveLoading} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {saveLoading ? 'Saving...' : (
                      <>
                        <IconSave size={14} />
                        <span>Save Confirmed Details & Claim</span>
                      </>
                    )}
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
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  {validatingLoading ? 'Evaluating...' : (
                    <>
                      <IconZap size={13} />
                      <span>Validate Rules</span>
                    </>
                  )}
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
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {validation.validationStatus === 'PASSED' ? (
                          <IconCheckCircle size={15} color="#10b981" />
                        ) : (
                          <IconAlertTriangle size={15} color="#f59e0b" />
                        )}
                      </span>
                      <span>Policy Compliance Check</span>
                    </span>
                    <span className={`status-pill ${validation.validationStatus === 'PASSED' ? 'policy-pass' : 'policy-warn'}`}>
                      {validation.validationStatus}
                    </span>
                  </div>

                  <div className="policy-item">
                    <span className="policy-label">
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {validation.duplicateStatus === 'NO_MATCH' ? (
                          <IconCheckCircle size={15} color="#10b981" />
                        ) : (
                          <IconSearch size={15} color="#3b82f6" />
                        )}
                      </span>
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

              {/* Correction Banner if returned by Manager */}
              {currentState === 'CORRECTION_REQUESTED' && (
                <div className="alert alert-warning" style={{ borderLeft: '4px solid #f59e0b', background: '#fffbeb', padding: '14px 16px', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <IconUndo size={16} />
                    <span>Correction Requested by Manager</span>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#78350f', marginTop: '6px', fontStyle: 'italic', background: '#fef3c7', padding: '8px 12px', borderRadius: '4px' }}>
                    {latestCorrectionReason ? `"${latestCorrectionReason}"` : 'Please review and adjust your claim details or requested reimbursement amount before resubmission.'}
                  </div>
                  {isEmployee && (
                    <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '8px' }}>
                      Click "Edit Details &amp; Claim" above to make changes, then click "Resubmit for Approval" below.
                    </div>
                  )}
                </div>
              )}

              {/* Submitter Actions (EMPLOYEE) */}
              {isSubmitter && (currentState === 'DRAFT' || currentState === 'CORRECTION_REQUESTED') && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-gold btn-lg"
                    style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    onClick={() => handleWorkflowAction('SUBMIT')}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      'Submitting...'
                    ) : (
                      <>
                        <IconSend size={15} />
                        <span>{currentState === 'CORRECTION_REQUESTED' ? 'Resubmit for Approval' : 'Submit for Approval'}</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Informational State Banner when in PENDING_APPROVAL for Employee */}
              {isEmployee && currentState === 'PENDING_APPROVAL' && (
                <div className="alert alert-info" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <IconClock size={20} color="#3b82f6" />
                  <div>
                    <strong>Submitted to Manager:</strong> This claim is currently queued for Manager review and approval.
                  </div>
                </div>
              )}

              {/* Informational State Banner when APPROVED */}
              {currentState === 'APPROVED' && (
                <div className="alert alert-success" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <IconCheckCircle size={20} color="#10b981" />
                  <div>
                    <strong>Claim Approved:</strong> This expense has been approved by the Manager and is queued for Finance Batch processing.
                  </div>
                </div>
              )}

              {/* Informational State Banner when REJECTED */}
              {currentState === 'REJECTED' && (
                <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <IconXCircle size={20} color="#ef4444" />
                  <div>
                    <strong>Claim Rejected:</strong> This expense claim was rejected during review. Check the audit trail below for details.
                  </div>
                </div>
              )}

              {/* Manager Actions */}
              {isManager && currentState === 'PENDING_APPROVAL' && (
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <IconShield size={16} />
                    <span>Manager Sign-Off Decisions</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-gold"
                      style={{ flex: 1, minWidth: '160px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={() => setReasonModal({ type: 'APPROVE', reason: '' })}
                      disabled={actionLoading}
                    >
                      <IconCheck size={14} />
                      <span>Approve Claim</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-warning"
                      style={{ minWidth: '180px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={() => setReasonModal({ type: 'REQUEST_CORRECTION', reason: '' })}
                      disabled={actionLoading}
                    >
                      <IconUndo size={14} />
                      <span>Request Correction</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ minWidth: '120px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      onClick={() => setReasonModal({ type: 'REJECT', reason: '' })}
                      disabled={actionLoading}
                    >
                      <IconX size={14} />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Notice for Manager when voucher is still in DRAFT */}
              {isManager && currentState === 'DRAFT' && (
                <div className="alert alert-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconInfo size={16} color="#3b82f6" />
                  <span>This receipt voucher is currently in <strong>DRAFT</strong>. The employee has not submitted it for review yet. Manager approval decisions become available once submitted.</span>
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
        )}
      </div>

      {/* Full Resolution Receipt Image Modal */}
      {showFullImageModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1100, backgroundColor: 'rgba(15, 23, 42, 0.85)' }}
          onClick={() => setShowFullImageModal(false)}
        >
          <div
            className="modal-dialog"
            style={{ maxWidth: '95vw', width: '1000px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 className="modal-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <IconCamera size={16} /> Full Resolution Voucher Scan — {effective.merchantName || receipt.originalFilename || 'Receipt'}
                </h4>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {receipt.originalFilename || receipt.original_filename || 'Receipt Image'} &bull; {((receipt.fileSizeBytes || receipt.file_size_bytes || 0) / 1024).toFixed(1)} KB
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <a
                  href={`/api/receipts/${receipt.id}/file?token=${encodeURIComponent(authToken)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline btn-sm"
                  style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <span>Open in New Tab</span>
                  <IconExternalLink size={12} />
                </a>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowFullImageModal(false)}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Close"
                >
                  <IconX size={14} />
                </button>
              </div>
            </div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto', textAlign: 'center', background: '#0b0f19', padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
              <img
                src={imageObjectUrl || `/api/receipts/${receipt.id}/file?token=${encodeURIComponent(authToken)}`}
                alt="Full High Resolution Receipt Preview"
                style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}
              />
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Tip: Click outside or press close to return to the approval workspace.
              </span>
              <button type="button" className="btn btn-dark btn-sm" onClick={() => setShowFullImageModal(false)}>
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw OCR Text Modal */}
      {showRawOcr && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4 className="modal-title">Raw Tesseract OCR Text</h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowRawOcr(false)} style={{ display: 'inline-flex', alignItems: 'center' }}><IconX size={14} /></button>
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

      {/* Reason Modal for Rejection / Correction / Approval */}
      {reasonModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4 className="modal-title">
                {reasonModal.type === 'APPROVE'
                  ? 'Approve Expense Claim'
                  : reasonModal.type === 'REJECT'
                  ? 'Reject Expense Claim'
                  : 'Request Expense Correction & Resubmission'}
              </h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setReasonModal(null)} style={{ display: 'inline-flex', alignItems: 'center' }}><IconX size={14} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {reasonModal.type === 'APPROVE'
                  ? 'You may optionally add an approval note or compliance comment for the employee and finance audit trail.'
                  : reasonModal.type === 'REJECT'
                  ? 'Please specify a mandatory reason explaining why this expense claim is being rejected.'
                  : 'Please specify what corrections or explanations the employee needs to provide before resubmission.'}
              </p>
              <textarea
                className="form-textarea"
                placeholder={
                  reasonModal.type === 'APPROVE'
                    ? 'Optional approval comment (e.g. Approved within quarterly travel budget)...'
                    : 'Enter explanation message (mandatory)...'
                }
                value={reasonModal.reason}
                onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
                rows={3}
                required={reasonModal.type !== 'APPROVE'}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setReasonModal(null)}>Cancel</button>
              <button
                type="button"
                className={`btn ${
                  reasonModal.type === 'APPROVE'
                    ? 'btn-gold'
                    : reasonModal.type === 'REJECT'
                    ? 'btn-danger'
                    : 'btn-warning'
                }`}
                disabled={actionLoading || (reasonModal.type !== 'APPROVE' && !reasonModal.reason.trim())}
                onClick={() => handleWorkflowAction(reasonModal.type, reasonModal.reason)}
              >
                {actionLoading
                  ? 'Recording...'
                  : reasonModal.type === 'APPROVE'
                  ? 'Confirm Approval'
                  : reasonModal.type === 'REJECT'
                  ? 'Confirm Rejection'
                  : 'Send Correction Request'}
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
                <IconTrash size={18} color="#dc2626" /> Delete Receipt Voucher?
              </h4>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowDeleteConfirm(false)} style={{ display: 'inline-flex', alignItems: 'center' }}><IconX size={14} /></button>
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
