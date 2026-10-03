import React, { useState, useRef } from 'react';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export default function ReceiptCapture({ authToken, onReceiptUploaded }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const processFile = (file) => {
    setError(null);
    if (!file) return;

    // Check size limit
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB.`);
      return;
    }

    // Check supported format (Images only: JPEG, PNG, WebP)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        setError('PDF format is deferred for Checkpoint 3. Please upload JPEG, PNG, or WebP images.');
      } else {
        setError(`Unsupported format (${file.type || 'unknown'}). Please select a JPEG, PNG, or WebP image.`);
      }
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleFileSelection = (e) => {
    const file = e.target.files?.[0];
    processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleClear = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setError(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    if (!authToken) {
      setError('Authentication token is required to upload receipts. Please log in as an EMPLOYEE.');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress('Uploading receipt & performing OCR preprocessing...');

    const formData = new FormData();
    formData.append('receipt', selectedFile);

    try {
      const response = await fetch('/api/receipts/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `Upload failed with status ${response.status}`);
      }

      setUploadProgress('Receipt uploaded and OCR processed successfully!');
      if (onReceiptUploaded) {
        onReceiptUploaded(data.receipt);
      }
      handleClear();
    } catch (err) {
      setError(err.message || 'An error occurred during receipt upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="table-card" id="receipt-capture-component" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h3 className="table-title">Upload or Snap Receipt</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Optical Character Recognition automatically extracts expense lines, taxes, and vendor details.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="status-pill policy-pass">
            <span className="status-dot"></span>
            <span>GSTIN Validated</span>
          </span>
          <span className="status-pill draft">
            <span>Tesseract OCR 300 DPI</span>
          </span>
        </div>
      </div>

      {/* Hidden native file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        id="file-upload-input"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileSelection}
      />
      <input
        ref={cameraInputRef}
        type="file"
        id="camera-capture-input"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileSelection}
      />

      {/* Drop Zone */}
      {!previewUrl ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: `2px dashed ${dragOver ? 'var(--gold-primary)' : 'var(--border-default)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: '36px 20px',
            textAlign: 'center',
            backgroundColor: dragOver ? 'var(--gold-bg-subtle)' : '#fafafa',
            transition: 'all 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '54px',
              height: '54px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--gold-bg-subtle)',
              color: 'var(--gold-hover)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}
          >
            📸
          </div>
          <div>
            <p style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              Drag and drop your receipt image here, or browse
            </p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Supports high-resolution JPEG, PNG, WebP up to 10MB
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-gold"
              id="btn-choose-file"
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Browse Files
            </button>
            <button
              type="button"
              className="btn btn-outline"
              id="btn-take-photo"
              onClick={() => cameraInputRef.current?.click()}
            >
              📷 Open Camera
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedFile?.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {(selectedFile?.size / 1024).toFixed(1)} KB &bull; {selectedFile?.type}
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleClear} disabled={uploading}>
              ✕ Remove
            </button>
          </div>

          <div className="scan-preview-box">
            <img src={previewUrl} alt="Receipt Preview" className="scan-image" />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={handleClear} disabled={uploading}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-gold"
              id="btn-submit-receipt"
              disabled={uploading}
              onClick={handleUpload}
            >
              {uploading ? 'Processing OCR & Preprocessing...' : '🚀 Submit Receipt for OCR'}
            </button>
          </div>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="alert alert-danger" id="receipt-error-alert" style={{ marginTop: '16px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Status alert */}
      {uploadProgress && !error && (
        <div className="alert alert-info" id="receipt-status-alert" style={{ marginTop: '16px' }}>
          {uploading ? '⏳ ' : '✅ '} {uploadProgress}
        </div>
      )}
    </div>
  );
}
