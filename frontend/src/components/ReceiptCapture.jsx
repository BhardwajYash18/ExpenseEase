import React, { useState, useRef, useEffect } from 'react';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export default function ReceiptCapture({ authToken, onReceiptUploaded, autoStartCamera = false }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Live Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);

  // Auto-start camera if requested by caller (e.g., retake picture action)
  useEffect(() => {
    if (autoStartCamera) {
      startLiveCamera();
    }
  }, [autoStartCamera]);

  // Stop camera stream tracks on unmount
  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, []);

  const startLiveCamera = async () => {
    setError(null);
    setCameraLoading(true);

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        setIsCameraActive(true);
        setCameraLoading(false);

        // Attach stream after modal element renders
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch((err) => {
              console.warn('[Camera] Video play warning:', err);
            });
          }
        }, 150);
        return;
      } catch (err) {
        console.warn('[Camera] Live camera stream failed, using native file fallback:', err.message);
        setCameraLoading(false);
      }
    }

    // Fallback if WebRTC stream is denied/unavailable
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const stopLiveCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setCameraLoading(false);
  };

  const capturePhotoFromStream = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `receipt-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
          processFile(file);
        }
        stopLiveCamera();
      },
      'image/jpeg',
      0.92
    );
  };

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
    stopLiveCamera();
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

      {/* Live Camera Viewfinder Overlay */}
      {isCameraActive ? (
        <div
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px',
            backgroundColor: '#0f172a',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="live-pulse"></span>
              Live Camera Viewfinder
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ color: '#fff', borderColor: '#334155' }}
              onClick={stopLiveCamera}
            >
              ✕ Close
            </button>
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '540px',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              backgroundColor: '#000000',
              aspectRatio: '4 / 3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Viewfinder Overlay Lines */}
            <div
              style={{
                position: 'absolute',
                top: '10%',
                left: '10%',
                right: '10%',
                bottom: '10%',
                border: '2px dashed dashed var(--gold-primary)',
                borderRadius: '8px',
                pointerEvents: 'none',
                opacity: 0.6,
              }}
            ></div>
          </div>

          <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-gold btn-lg"
              id="btn-snap-photo"
              onClick={capturePhotoFromStream}
              style={{ minWidth: '180px' }}
            >
              📸 Snap Photo
            </button>
            <button
              type="button"
              className="btn btn-outline"
              style={{ color: '#fff', borderColor: '#334155' }}
              onClick={stopLiveCamera}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !previewUrl ? (
        /* Drop Zone */
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
              onClick={startLiveCamera}
              disabled={cameraLoading}
            >
              {cameraLoading ? 'Starting Camera...' : '📷 Open Camera'}
            </button>
          </div>
        </div>
      ) : (
        /* Image Preview Box */
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

