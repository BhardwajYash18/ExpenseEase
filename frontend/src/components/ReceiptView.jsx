import React from 'react';

export default function ReceiptView({ receipt, authToken }) {
  if (!receipt) return null;

  const isCompleted = receipt.ocrStatus === 'COMPLETED';
  const isFailed = receipt.ocrStatus === 'FAILED';

  return (
    <div className="card receipt-view-card" id="receipt-view-component" style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="section-title">Receipt Details</h3>
        <span
          className={`status-badge ${isCompleted ? 'ok' : isFailed ? 'error' : 'pending'}`}
          style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}
        >
          OCR Status: {receipt.ocrStatus}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '16px' }}>
        {/* Receipt Image */}
        <div>
          <h4>Original Receipt</h4>
          <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '6px', background: '#fafafa' }}>
            <img
              src={`/api/receipts/${receipt.id}/file`}
              alt="Original Receipt"
              style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '4px' }}
              onError={(e) => {
                // If direct image fetch fails (e.g., auth header required in fetch), show fallback notice
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            <div><strong>Filename:</strong> {receipt.originalFilename}</div>
            <div><strong>Size:</strong> {(receipt.fileSizeBytes / 1024).toFixed(1)} KB</div>
            <div><strong>MIME:</strong> {receipt.mimeType}</div>
          </div>
        </div>

        {/* OCR Extracted Text */}
        <div>
          <h4>Raw OCR Extracted Text</h4>
          <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '8px' }}>
            <em>Untrusted raw extracted text. AI-assisted understanding and structured field extraction will be introduced in Checkpoint 4.</em>
          </p>

          {isCompleted && (
            <pre
              id="raw-ocr-text-box"
              style={{
                background: '#f4f6f8',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '340px',
                overflowY: 'auto',
                fontSize: '0.85rem',
                fontFamily: 'monospace',
              }}
            >
              {receipt.ocrRawText || '(No text detected in receipt image)'}
            </pre>
          )}

          {isFailed && (
            <div className="alert alert-danger" style={{ padding: '12px', borderRadius: '6px' }}>
              <strong>OCR Extraction Failed:</strong>
              <p style={{ marginTop: '4px' }}>
                {receipt.ocrErrorMessage || 'The OCR engine could not process this image.'}
              </p>
              <p style={{ fontSize: '0.8rem', marginTop: '6px' }}>
                The original receipt has been safely preserved for manual inspection or retry.
              </p>
            </div>
          )}

          {receipt.ocrStatus === 'PENDING' && (
            <div className="alert alert-info">
              OCR extraction is currently in progress...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
