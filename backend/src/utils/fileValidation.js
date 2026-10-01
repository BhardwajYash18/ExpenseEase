const config = require('../config/env');

/**
 * File magic bytes (signatures) for validating actual file content.
 * SECURITY: MIME type from the client (Content-Type header) can be spoofed.
 * Checking magic bytes provides an additional layer of content validation.
 */
const MAGIC_BYTES = {
  'image/jpeg': [
    Buffer.from([0xFF, 0xD8, 0xFF]),           // JFIF/EXIF JPEG
  ],
  'image/png': [
    Buffer.from([0x89, 0x50, 0x4E, 0x47]),     // PNG signature
  ],
  'image/webp': [
    Buffer.from([0x52, 0x49, 0x46, 0x46]),     // RIFF header (bytes 0-3)
  ],
};

/**
 * Validate receipt file upload.
 *
 * Performs:
 * 1. Presence check (file exists and has content)
 * 2. MIME type validation against allowed types
 * 3. File size validation against configured maximum
 * 4. Magic byte validation (actual content vs. declared MIME type)
 *
 * @param {{ buffer: Buffer, mimetype: string, originalname: string, size: number }} file
 *   - Multer file object
 * @returns {{ valid: boolean, error?: string }}
 */
function validateReceiptFile(file) {
  // 1. Presence check
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!file.buffer || file.buffer.length === 0) {
    return { valid: false, error: 'Uploaded file is empty' };
  }

  // 2. MIME type validation
  const { allowedMimeTypes } = config.receipt;
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`,
    };
  }

  // 3. File size validation
  const { maxFileSizeBytes } = config.receipt;
  if (file.size > maxFileSizeBytes) {
    const maxMB = Math.round(maxFileSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size ${Math.round(file.size / (1024 * 1024))}MB exceeds maximum allowed size of ${maxMB}MB`,
    };
  }

  // 4. Magic byte validation — verify actual file content matches declared MIME type
  const signatures = MAGIC_BYTES[file.mimetype];
  if (signatures) {
    const headerBytes = file.buffer.subarray(0, 12);
    const matches = signatures.some((sig) =>
      headerBytes.subarray(0, sig.length).equals(sig)
    );
    if (!matches) {
      return {
        valid: false,
        error: 'File content does not match the declared file type',
      };
    }
    // For WebP, additionally verify 'WEBP' at offset 8..11
    if (file.mimetype === 'image/webp') {
      const webpMarker = headerBytes.subarray(8, 12).toString('ascii');
      if (webpMarker !== 'WEBP') {
        return {
          valid: false,
          error: 'File content does not match the declared file type',
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Sanitize an original filename for safe metadata storage.
 * Strips path separators and control characters. The result is stored
 * as metadata only — never used as a filesystem path.
 *
 * @param {string} originalName
 * @returns {string} sanitized filename
 */
function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'unnamed';
  }
  // Remove path separators and control characters
  return originalName
    .replace(/[/\\]/g, '_')         // Replace path separators
    .replace(/[^\x20-\x7E]/g, '_')  // Replace non-printable/non-ASCII
    .replace(/\.\./g, '_')          // Prevent directory traversal sequences
    .substring(0, 255);             // Limit length
}

module.exports = {
  validateReceiptFile,
  sanitizeFilename,
};
