const axios = require('axios');
const config = require('../config/env');
const { withTenantContext } = require('../config/db');
const storageService = require('./storageService');
const { validateReceiptFile, sanitizeFilename } = require('../utils/fileValidation');

/**
 * Receipt service — orchestrates receipt upload, storage, and OCR processing.
 *
 * Architecture:
 *   Receipt Controller
 *       ↓
 *   Receipt Service (this module)
 *       ↓
 *   Storage Service (local filesystem abstraction)
 *       ↓
 *   AI Service (Python/FastAPI — image preprocessing + Tesseract OCR)
 *       ↓
 *   Database (receipt record with OCR results)
 *
 * SECURITY:
 * - tenant_id and user_id come from the authenticated JWT, never from the request body.
 * - All database access uses withTenantContext() for RLS enforcement.
 * - File storage paths are server-controlled; original filenames are metadata only.
 *
 * OCR extracts text only. AI/VLM receipt understanding is deferred to Checkpoint 4.
 */

/**
 * Upload and process a receipt.
 *
 * @param {{ id: string, tenantId: string }} user - Authenticated user from JWT
 * @param {object} file - Multer file object { buffer, mimetype, originalname, size }
 * @returns {Promise<object>} Safe receipt metadata (no filesystem paths)
 */
async function uploadReceipt(user, file) {
  // 1. Validate the uploaded file
  const validation = validateReceiptFile(file);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.status = 400;
    throw err;
  }

  // 2. Generate server-controlled storage key
  const storageKey = storageService.generateStorageKey(user.tenantId, file.mimetype);
  const safeFilename = sanitizeFilename(file.originalname);

  // 3. Store the original receipt file
  await storageService.storeFile(storageKey, file.buffer);

  // 4. Create the receipt database record within tenant context (RLS enforced)
  let receipt;
  try {
    receipt = await withTenantContext(user.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type,
          file_size_bytes, storage_key, upload_status, ocr_status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', 'PENDING')
        RETURNING id, tenant_id, uploaded_by, original_filename, mime_type,
                  file_size_bytes, upload_status, ocr_status, created_at, updated_at`,
        [
          user.tenantId,
          user.id,
          safeFilename,
          file.mimetype,
          file.size,
          storageKey,
        ]
      );
      return rows[0];
    });
  } catch (dbErr) {
    // Clean up stored file if database insert fails
    try { await storageService.deleteFile(storageKey); } catch (_) {}
    throw dbErr;
  }

  // 5. Trigger OCR processing (synchronous for CP3 simplicity)
  const ocrResult = await processOCR(user.tenantId, receipt.id, storageKey);

  // 6. Return safe receipt metadata (no filesystem paths, no storage_key)
  return {
    id: receipt.id,
    uploadStatus: receipt.upload_status,
    ocrStatus: ocrResult.ocr_status,
    originalFilename: receipt.original_filename,
    mimeType: receipt.mime_type,
    fileSizeBytes: receipt.file_size_bytes,
    ocrRawText: ocrResult.raw_text || null,
    ocrEngine: ocrResult.ocr_engine || null,
    createdAt: receipt.created_at,
  };
}

/**
 * Process OCR for a stored receipt by calling the AI service.
 *
 * OCR processing model: SYNCHRONOUS (CP3 implementation choice).
 * The backend calls the Python AI service's OCR endpoint and waits for the result.
 * This is acceptable for CP3 because OCR processing time is bounded by image size.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {string} receiptId - Receipt UUID
 * @param {string} storageKey - Server-controlled storage key
 * @returns {object} OCR result with status
 */
async function processOCR(tenantId, receiptId, storageKey) {
  let ocrResult = {
    raw_text: '',
    ocr_engine: 'tesseract',
    ocr_status: 'FAILED',
    error_message: null,
  };

  try {
    // Read the file from storage
    const fileBuffer = await storageService.readFile(storageKey);

    // Call the AI service OCR endpoint
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: 'receipt.jpg',
      contentType: 'image/jpeg',
    });

    const response = await axios.post(
      `${config.aiServiceUrl}/ocr/extract`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 30000, // 30-second timeout for OCR processing
        maxContentLength: 50 * 1024 * 1024,
      }
    );

    ocrResult = {
      raw_text: response.data.raw_text || '',
      ocr_engine: response.data.ocr_engine || 'tesseract',
      ocr_status: response.data.ocr_status || 'COMPLETED',
      error_message: response.data.error_message || null,
    };
  } catch (err) {
    // OCR failure should not lose the receipt — record the error
    ocrResult.error_message = err.message || 'OCR service unavailable';
    ocrResult.ocr_status = 'FAILED';
    console.error('[Receipt] OCR processing failed:', err.message);
  }

  // Update the receipt record with OCR results (within tenant context, RLS enforced)
  try {
    await withTenantContext(tenantId, async (client) => {
      await client.query(
        `UPDATE receipts SET
          ocr_status = $1,
          ocr_raw_text = $2,
          ocr_engine = $3,
          ocr_error_message = $4,
          ocr_processed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5`,
        [
          ocrResult.ocr_status,
          ocrResult.raw_text || null,
          ocrResult.ocr_engine,
          ocrResult.error_message,
          receiptId,
        ]
      );
    });
  } catch (updateErr) {
    console.error('[Receipt] Failed to update OCR status:', updateErr.message);
  }

  return ocrResult;
}

/**
 * Get receipt metadata by ID for the authenticated tenant.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {string} receiptId - Receipt UUID
 * @param {object} [userFilter] - Optional user filter { userId, role }
 * @returns {Promise<object|null>} Receipt metadata or null if not found
 */
async function getReceiptById(tenantId, receiptId, userFilter = null) {
  return withTenantContext(tenantId, async (client) => {
    let query = `
      SELECT id, uploaded_by, original_filename, mime_type,
             file_size_bytes, upload_status, ocr_status,
             ocr_raw_text, ocr_engine, ocr_error_message,
             ocr_processed_at, created_at, updated_at
      FROM receipts WHERE id = $1
    `;
    const params = [receiptId];

    if (userFilter && userFilter.role === 'EMPLOYEE') {
      query += ` AND uploaded_by = $2`;
      params.push(userFilter.userId);
    }

    const { rows } = await client.query(query, params);
    if (!rows[0]) return null;

    const r = rows[0];
    return {
      id: r.id,
      uploadedBy: r.uploaded_by,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      fileSizeBytes: r.file_size_bytes,
      uploadStatus: r.upload_status,
      ocrStatus: r.ocr_status,
      ocrRawText: r.ocr_raw_text,
      ocrEngine: r.ocr_engine,
      ocrErrorMessage: r.ocr_error_message,
      ocrProcessedAt: r.ocr_processed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * Get receipt file buffer and MIME type by ID for streaming.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {string} receiptId - Receipt UUID
 * @param {object} [userFilter] - Optional user filter { userId, role }
 * @returns {Promise<{ buffer: Buffer, mimeType: string, filename: string }|null>}
 */
async function getReceiptFile(tenantId, receiptId, userFilter = null) {
  return withTenantContext(tenantId, async (client) => {
    let query = `SELECT storage_key, mime_type, original_filename, uploaded_by FROM receipts WHERE id = $1`;
    const params = [receiptId];

    if (userFilter && userFilter.role === 'EMPLOYEE') {
      query += ` AND uploaded_by = $2`;
      params.push(userFilter.userId);
    }

    const { rows } = await client.query(query, params);
    if (!rows[0]) return null;

    const { storage_key, mime_type, original_filename } = rows[0];
    const buffer = await storageService.readFile(storage_key);

    return {
      buffer,
      mimeType: mime_type,
      filename: original_filename,
    };
  });
}

/**
 * List receipts for the authenticated tenant.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {{ limit?: number, offset?: number, userId?: string, role?: string }} options
 * @returns {Promise<object[]>} Array of receipt metadata
 */
async function listReceipts(tenantId, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(options.offset) || 0, 0);

  return withTenantContext(tenantId, async (client) => {
    let query = `
      SELECT id, uploaded_by, original_filename, mime_type,
             file_size_bytes, upload_status, ocr_status,
             created_at, updated_at
      FROM receipts
    `;
    const params = [];

    if (options.role === 'EMPLOYEE' && options.userId) {
      query += ` WHERE uploaded_by = $1`;
      params.push(options.userId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await client.query(query, params);

    return rows.map((r) => ({
      id: r.id,
      uploadedBy: r.uploaded_by,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      fileSizeBytes: r.file_size_bytes,
      uploadStatus: r.upload_status,
      ocrStatus: r.ocr_status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

module.exports = {
  uploadReceipt,
  getReceiptById,
  getReceiptFile,
  listReceipts,
};
