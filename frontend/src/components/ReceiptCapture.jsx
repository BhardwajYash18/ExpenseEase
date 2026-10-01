import React, { useState, useRef } from 'react';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export default function ReceiptCapture({ authToken, onReceiptUploaded }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const handleFileSelection = (e) => {
    setError(null);
    const file = e.target.files?.[0];
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
    setUploadProgress('Uploading receipt & performing OCR...');

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
    } catch (err) {
      setError(err.message || 'An error occurred during receipt upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card receipt-capture-card" id="receipt-capture-component">
      <h3 className="section-title">Receipt Capture & OCR</h3>
      <p className="section-subtitle">
        Upload or capture a receipt image (JPEG, PNG, WebP &le; 10MB) for text extraction.
      </p>

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

      {/* Capture trigger buttons */}
      <div className="button-group" style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
        <button
          type="button"
          className="btn btn-primary"
          id="btn-choose-file"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          📁 Choose Receipt File
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          id="btn-take-photo"
          disabled={uploading}
          onClick={() => cameraInputRef.current?.click()}
        >
          📷 Capture with Camera
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="alert alert-danger" id="receipt-error-alert" style={{ marginTop: '14px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Progress display */}
      {uploadProgress && !error && (
        <div className="alert alert-info" id="receipt-status-alert" style={{ marginTop: '14px' }}>
          {uploading ? '⏳ ' : '✅ '} {uploadProgress}
        </div>
      )}

      {/* Image Preview */}
      {previewUrl && (
        <div className="preview-container" style={{ marginTop: '16px' }}>
          <h4>Selected Receipt Preview:</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {selectedFile?.name} ({(selectedFile?.size / 1024).toFixed(1)} KB)
          </p>
          <div style={{ maxHeight: '350px', overflow: 'hidden', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px' }}>
            <img
              src={previewUrl}
              alt="Receipt Preview"
              style={{ width: '100%', maxHeight: '350px', objectFit: 'contain' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button
              type="button"
              className="btn btn-success"
              id="btn-submit-receipt"
              disabled={uploading}
              onClick={handleUpload}
            >
              {uploading ? 'Processing OCR...' : '🚀 Submit Receipt for OCR'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={uploading}
              onClick={handleClear}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
