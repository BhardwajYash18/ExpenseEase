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

  // Fetch extraction when receipt changes
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

    fetchExtraction();
    return () => {
      isMounted = false;
    };
  }, [receipt?.id, authToken]);

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
