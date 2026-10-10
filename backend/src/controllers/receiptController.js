const receiptService = require('../services/receiptService');

/**
 * POST /api/receipts/upload (and POST /api/receipts)
 * Upload a receipt image with OCR processing.
 *
 * Authentication: Required (Bearer token)
 * Authorization: EMPLOYEE only (per AGENTS.md Section 13)
 * Content-Type: multipart/form-data with field "receipt"
 *
 * SECURITY:
 * - tenant_id and user_id come from req.user (set by authenticate middleware from JWT)
 * - Client-supplied tenant_id/user_id in body/query/params are ignored
 * - File validation (type, size, magic bytes) is performed by receiptService
 */
async function upload(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: { message: 'No file provided. Use multipart/form-data with field name "receipt".' },
      });
    }

    const result = await receiptService.uploadReceipt(req.user, req.file);

    return res.status(201).json({ receipt: result });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
}

/**
 * GET /api/receipts
 * List receipts for the authenticated user's tenant.
 * - EMPLOYEE: sees only their own receipts
 * - MANAGER / FINANCE: sees all receipts in the tenant
 */
async function list(req, res, next) {
  try {
    const { limit, offset } = req.query;
    const receipts = await receiptService.listReceipts(req.user.tenantId, {
      limit,
      offset,
      userId: req.user.id,
      role: req.user.role,
    });

    return res.status(200).json({ receipts });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/receipts/:id
 * Get a single receipt by ID.
 * - EMPLOYEE: can only view their own receipt
 * - MANAGER / FINANCE: can view any receipt within tenant
 */
async function getById(req, res, next) {
  try {
    const userFilter = { userId: req.user.id, role: req.user.role };
    const receipt = await receiptService.getReceiptById(req.user.tenantId, req.params.id, userFilter);

    if (!receipt) {
      return res.status(404).json({ error: { message: 'Receipt not found' } });
    }

    return res.status(200).json({ receipt });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/receipts/:id/file
 * Download / view original receipt file.
 * - EMPLOYEE: can only view their own receipt file
 * - MANAGER / FINANCE: can view receipt file within tenant
 */
async function getFile(req, res, next) {
  try {
    const userFilter = { userId: req.user.id, role: req.user.role };
    const fileData = await receiptService.getReceiptFile(req.user.tenantId, req.params.id, userFilter);

    if (!fileData) {
      return res.status(404).json({ error: { message: 'Receipt file not found' } });
    }

    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileData.filename}"`);
    return res.send(fileData.buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/receipts/:id/ocr
 * Get OCR status and raw text for a receipt.
 */
async function getOcr(req, res, next) {
  try {
    const userFilter = { userId: req.user.id, role: req.user.role };
    const receipt = await receiptService.getReceiptById(req.user.tenantId, req.params.id, userFilter);

    if (!receipt) {
      return res.status(404).json({ error: { message: 'Receipt not found' } });
    }

    return res.status(200).json({
      ocr: {
        id: receipt.id,
        ocrStatus: receipt.ocrStatus,
        ocrRawText: receipt.ocrRawText,
        ocrEngine: receipt.ocrEngine,
        ocrErrorMessage: receipt.ocrErrorMessage,
        ocrProcessedAt: receipt.ocrProcessedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/receipts/:id
 * Delete a receipt request/voucher and clean up physical file.
 */
async function remove(req, res, next) {
  try {
    const userFilter = { userId: req.user.id, role: req.user.role };
    const result = await receiptService.deleteReceipt(req.user.tenantId, req.params.id, userFilter);
    return res.status(200).json({ message: 'Receipt deleted successfully', id: result.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

/**
 * POST /api/receipts/:id/retry-ocr
 * Re-trigger OCR extraction on an existing receipt file.
 */
async function retryOcr(req, res, next) {
  try {
    const userFilter = { userId: req.user.id, role: req.user.role };
    const receipt = await receiptService.retryOCR(req.user.tenantId, req.params.id, userFilter);
    return res.status(200).json({ receipt });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: { message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  upload,
  list,
  getById,
  getFile,
  getOcr,
  retryOcr,
  remove,
};

