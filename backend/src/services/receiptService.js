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
async function uploadReceipt(user, file, options = {}) {
  // 1. Validate the uploaded file
  const validation = validateReceiptFile(file);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.status = 400;
    throw err;
  }

  const claimType = options.claimType === 'NON_REIMBURSABLE' ? 'NON_REIMBURSABLE' : 'REIMBURSEMENT';
  const orgReference = options.orgReference ? String(options.orgReference).trim().slice(0, 100) : null;

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
          file_size_bytes, storage_key, upload_status, ocr_status,
          claim_type, org_reference
        ) VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', 'PENDING', $7, $8)
        RETURNING id, tenant_id, uploaded_by, original_filename, mime_type,
                  file_size_bytes, upload_status, ocr_status, claim_type, org_reference, created_at, updated_at`,
        [
          user.tenantId,
          user.id,
          safeFilename,
          file.mimetype,
          file.size,
          storageKey,
          claimType,
          orgReference,
        ]
      );

      const r = rows[0];

      // If non-reimbursable recordkeeping bill, immediately create documented workflow state
      if (claimType === 'NON_REIMBURSABLE') {
        const { rows: wfRows } = await client.query(
          `INSERT INTO expense_workflows (
            tenant_id, receipt_id, submitted_by, current_state, claim_type, org_reference, submitted_at
          ) VALUES ($1, $2, $3, 'DOCUMENTED', 'NON_REIMBURSABLE', $4, CURRENT_TIMESTAMP)
          RETURNING id`,
          [user.tenantId, r.id, user.id, orgReference]
        );

        if (wfRows[0]) {
          await client.query(
            `INSERT INTO expense_workflow_actions (
              workflow_id, receipt_id, tenant_id, actor_id, action, previous_state, new_state, reason
            ) VALUES ($1, $2, $3, $4, 'DOCUMENT', 'DRAFT', 'DOCUMENTED', $5)`,
            [
              wfRows[0].id,
              r.id,
              user.tenantId,
              user.id,
              orgReference ? `Documented non-reimbursable purchase (Ref: ${orgReference})` : 'Documented non-reimbursable purchase for recordkeeping',
            ]
          );
        }
      }

      return r;
    });
  } catch (dbErr) {
    // Clean up stored file if database insert fails
    try { await storageService.deleteFile(storageKey); } catch (_) {}
    throw dbErr;
  }

  // 5. Trigger OCR processing (synchronous for CP3 simplicity)
  const ocrResult = await processOCR(user.tenantId, receipt.id, storageKey);

  // 5b. If OCR completed with text, trigger structured extraction immediately
  if (ocrResult.ocr_status === 'COMPLETED' && ocrResult.raw_text) {
    try {
      const extractionService = require('./extractionService');
      await extractionService.triggerExtraction(user.tenantId, receipt.id, user);
    } catch (extErr) {
      console.warn('[Receipt] Auto-extraction on upload skipped or failed:', extErr.message);
    }
  }

  // 6. Return safe receipt metadata (no filesystem paths, no storage_key)
  return {
    id: receipt.id,
    uploadStatus: receipt.upload_status,
    ocrStatus: ocrResult.ocr_status,
    uploaded_by: receipt.uploaded_by,
    uploadedBy: receipt.uploaded_by,
    originalFilename: receipt.original_filename,
    mimeType: receipt.mime_type,
    fileSizeBytes: receipt.file_size_bytes,
    claimType: receipt.claim_type,
    orgReference: receipt.org_reference,
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
             claim_type, org_reference,
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
      claimType: r.claim_type,
      orgReference: r.org_reference,
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
 * List receipts for the authenticated tenant with workflow state, employee metadata, and pagination.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {{ limit?: number, offset?: number, page?: number, pageSize?: number, status?: string, userId?: string, role?: string }} options
 * @returns {Promise<{ receipts: object[], total: number, page: number, pageSize: number, totalPages: number }>}
 */
async function listReceipts(tenantId, options = {}) {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(options.pageSize || options.limit) || 20, 1), 100);
  const offset = options.offset !== undefined && options.offset !== null
    ? Math.max(parseInt(options.offset) || 0, 0)
    : (page - 1) * pageSize;
  const limit = pageSize;

  return withTenantContext(tenantId, async (client) => {
    let query = `
      SELECT r.id, r.uploaded_by, r.original_filename, r.mime_type,
             r.file_size_bytes, r.upload_status, r.ocr_status,
             r.claim_type, r.org_reference,
             r.created_at, r.updated_at,
             COALESCE(w.current_state, 'DRAFT') AS workflow_state,
             w.id AS workflow_id,
             w.submitted_at,
             u.email AS employee_email,
             TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS employee_name,
             re.extraction_status,
             re.ai_confidence_score,
             re.ai_merchant_name,
             re.confirmed_merchant_name,
             re.ai_total_amount,
             re.confirmed_total_amount,
             re.ai_currency,
             re.confirmed_currency,
             re.ai_suggested_category,
             re.confirmed_category,
             re.ai_receipt_date,
             re.confirmed_receipt_date,
             re.requested_amount,
             re.reimbursement_description,
             rv.validation_status,
             rv.duplicate_status,
             rv.duplicate_score,
             COUNT(*) OVER() AS full_count
      FROM receipts r
      LEFT JOIN expense_workflows w ON w.receipt_id = r.id
      LEFT JOIN users u ON u.id = r.uploaded_by
      LEFT JOIN receipt_extractions re ON re.receipt_id = r.id
      LEFT JOIN receipt_validation_results rv ON rv.receipt_id = r.id
    `;
    const params = [];
    const conditions = [];

    const isPersonalScope = options.scope === 'personal' || options.scope === 'my' || options.role === 'EMPLOYEE';

    if (isPersonalScope && options.userId) {
      params.push(options.userId);
      conditions.push(`r.uploaded_by = $${params.length}`);
    } else if (options.role === 'MANAGER') {
      // Submissions by other users that are drafts are strictly excluded
      conditions.push(`(w.current_state IS NOT NULL AND w.current_state != 'DRAFT')`);
      // If manager is checking reimbursement approval queue, exclude non-reimbursable records
      if (options.status === 'PENDING' || options.status === 'PENDING_APPROVAL') {
        conditions.push(`(r.claim_type = 'REIMBURSEMENT' OR r.claim_type IS NULL)`);
      }
    } else {
      // For FINANCE or tenant batches pool: drafts are excluded
      conditions.push(`(w.current_state IS NOT NULL AND w.current_state != 'DRAFT')`);
    }

    if (options.claimType && options.claimType !== 'ALL') {
      params.push(options.claimType);
      conditions.push(`(r.claim_type = $${params.length} OR w.claim_type = $${params.length})`);
    }

    if (options.status) {
      if (options.status === 'DRAFT') {
        if (!isPersonalScope && options.userId) {
          params.push(options.userId);
          conditions.push(`r.uploaded_by = $${params.length}`);
        }
        conditions.push(`(w.current_state = 'DRAFT' OR w.current_state IS NULL)`);
      } else if (options.status === 'PENDING' || options.status === 'PENDING_APPROVAL') {
        conditions.push(`w.current_state = 'PENDING_APPROVAL'`);
      } else if (options.status === 'APPROVED') {
        conditions.push(`w.current_state = 'APPROVED'`);
      } else if (options.status === 'REJECTED') {
        conditions.push(`w.current_state = 'REJECTED'`);
      } else if (options.status === 'CORRECTION_REQUESTED') {
        conditions.push(`w.current_state = 'CORRECTION_REQUESTED'`);
      } else if (options.status === 'DOCUMENTED') {
        conditions.push(`w.current_state = 'DOCUMENTED'`);
      } else if (options.status === 'HISTORY') {
        conditions.push(`w.current_state IN ('APPROVED', 'REJECTED')`);
      } else if (options.status !== 'ALL') {
        params.push(options.status);
        conditions.push(`w.current_state = $${params.length}`);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    params.push(limit, offset);
    query += ` ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await client.query(query, params);
    const total = rows.length > 0 ? parseInt(rows[0].full_count, 10) : 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const receipts = rows.map((r) => {
      const totalAmount = r.confirmed_total_amount !== null && r.confirmed_total_amount !== undefined
        ? parseFloat(r.confirmed_total_amount)
        : (r.ai_total_amount !== null && r.ai_total_amount !== undefined ? parseFloat(r.ai_total_amount) : null);

      const requestedAmount = r.requested_amount !== null && r.requested_amount !== undefined
        ? parseFloat(r.requested_amount)
        : totalAmount;

      const merchantName = r.confirmed_merchant_name || r.ai_merchant_name || null;
      const currency = r.confirmed_currency || r.ai_currency || 'INR';
      const category = r.confirmed_category || r.ai_suggested_category || 'Other';
      const receiptDate = r.confirmed_receipt_date || r.ai_receipt_date || null;

      return {
        id: r.id,
        uploadedBy: r.uploaded_by,
        employeeName: r.employee_name || 'Employee',
        employeeEmail: r.employee_email || '',
        originalFilename: r.original_filename,
        mimeType: r.mime_type,
        fileSizeBytes: r.file_size_bytes,
        uploadStatus: r.upload_status,
        ocrStatus: r.ocr_status,
        claimType: r.claim_type || 'REIMBURSEMENT',
        orgReference: r.org_reference || null,
        workflowState: r.workflow_state,
        workflow_state: r.workflow_state,
        workflowId: r.workflow_id,
        submittedAt: r.submitted_at,
        merchantName,
        totalAmount,
        requestedAmount,
        currency,
        category,
        receiptDate,
        reimbursementDescription: r.reimbursement_description || '',
        validationStatus: r.validation_status || null,
        duplicateStatus: r.duplicate_status || null,
        duplicateScore: r.duplicate_score !== null && r.duplicate_score !== undefined ? parseFloat(r.duplicate_score) : null,
        confidenceScore: r.ai_confidence_score !== null && r.ai_confidence_score !== undefined ? parseFloat(r.ai_confidence_score) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    return {
      receipts,
      total,
      page,
      pageSize,
      totalPages,
    };
  });
}

/**
 * Delete a receipt request/voucher and clean up file storage.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {string} receiptId - Receipt UUID
 * @param {object} [userFilter] - Optional user filter { userId, role }
 * @returns {Promise<{ id: string, deleted: boolean }>}
 */
async function deleteReceipt(tenantId, receiptId, userFilter = null) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Verify receipt existence and ownership
    let query = `SELECT id, storage_key, uploaded_by FROM receipts WHERE id = $1`;
    const params = [receiptId];

    if (userFilter && (userFilter.role === 'EMPLOYEE' || userFilter.role === 'MANAGER')) {
      query += ` AND uploaded_by = $2`;
      params.push(userFilter.userId);
    }

    const { rows } = await client.query(query, params);
    if (!rows[0]) {
      const err = new Error('Receipt not found or unauthorized to delete');
      err.status = 404;
      throw err;
    }

    const { storage_key } = rows[0];

    // 2. Prevent deleting receipts that are part of a Finance Batch
    const batchCheck = await client.query(
      `SELECT id FROM finance_batch_items WHERE receipt_id = $1 LIMIT 1`,
      [receiptId]
    );
    if (batchCheck.rows.length > 0) {
      const err = new Error('Cannot delete a receipt voucher that has already been included in a Finance Batch');
      err.status = 400;
      throw err;
    }

    // 3. Delete database record (Cascades to extractions, validations, workflows)
    await client.query(`DELETE FROM receipts WHERE id = $1`, [receiptId]);

    // 4. Delete physical file from storage
    if (storage_key) {
      try {
        await storageService.deleteFile(storage_key);
      } catch (fileErr) {
        console.warn(`[Storage] Failed to delete file for storage key ${storage_key}:`, fileErr.message);
      }
    }

    return { id: receiptId, deleted: true };
  });
}

/**
 * Retry OCR processing for an existing receipt file.
 *
 * @param {string} tenantId - Tenant UUID from JWT
 * @param {string} receiptId - Receipt UUID
 * @param {object} [userFilter] - Optional user filter { userId, role }
 * @returns {Promise<object>} Updated receipt metadata
 */
async function retryOCR(tenantId, receiptId, userFilter = null) {
  return withTenantContext(tenantId, async (client) => {
    let query = `SELECT id, storage_key, uploaded_by FROM receipts WHERE id = $1`;
    const params = [receiptId];

    if (userFilter && userFilter.role === 'EMPLOYEE') {
      query += ` AND uploaded_by = $2`;
      params.push(userFilter.userId);
    }

    const { rows } = await client.query(query, params);
    if (!rows[0]) {
      const err = new Error('Receipt not found or unauthorized');
      err.status = 404;
      throw err;
    }

    const { storage_key } = rows[0];
    await processOCR(tenantId, receiptId, storage_key);

    return getReceiptById(tenantId, receiptId, userFilter);
  });
}

module.exports = {
  uploadReceipt,
  getReceiptById,
  getReceiptFile,
  listReceipts,
  deleteReceipt,
  retryOCR,
};

