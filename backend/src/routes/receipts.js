const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const receiptController = require('../controllers/receiptController');
const config = require('../config/env');
const { validateUuidParam } = require('../utils/validationUtils');

const router = express.Router();

// Validate :id parameter across all receipt routes
router.param('id', validateUuidParam('id'));

// Configure multer for in-memory file handling
// Files are stored to disk by storageService, not by multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.receipt.maxFileSizeBytes,
    files: 1, // Single file per request
  },
});

// Multer error handler middleware
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMB = Math.round(config.receipt.maxFileSizeBytes / (1024 * 1024));
      return res.status(400).json({
        error: { message: `File size exceeds maximum allowed size of ${maxMB}MB` },
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: { message: 'Only one file can be uploaded per request' },
      });
    }
    return res.status(400).json({
      error: { message: 'File upload error' },
    });
  }
  if (err && err.message && (err.message.includes('Malformed part header') || err.message.includes('Unexpected end of form'))) {
    return res.status(400).json({
      error: { message: 'Malformed file upload: invalid filename or multipart header' },
    });
  }
  next(err);
}

/**
 * POST /api/receipts/upload & POST /api/receipts
 * Upload a receipt image with OCR processing.
 *
 * RBAC: EMPLOYEE only (AGENTS.md Section 13)
 * Accepts: multipart/form-data with field "receipt"
 */
router.post(
  '/upload',
  authenticate,
  requireRole('EMPLOYEE'),
  upload.single('receipt'),
  handleMulterError,
  receiptController.upload
);

router.post(
  '/',
  authenticate,
  requireRole('EMPLOYEE'),
  upload.single('receipt'),
  handleMulterError,
  receiptController.upload
);

/**
 * GET /api/receipts
 * List receipts for authenticated tenant.
 * - EMPLOYEE: sees own receipts
 * - MANAGER / FINANCE: sees all tenant receipts
 */
router.get(
  '/',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  receiptController.list
);

/**
 * GET /api/receipts/:id
 * Get single receipt metadata.
 */
router.get(
  '/:id',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  receiptController.getById
);

/**
 * DELETE /api/receipts/:id
 * Delete a receipt voucher and remove its physical file from storage.
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('EMPLOYEE'),
  receiptController.remove
);

/**
 * GET /api/receipts/:id/file
 * Download/view the original stored receipt image.
 */
router.get(
  '/:id/file',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  receiptController.getFile
);

const extractionController = require('../controllers/extractionController');

/**
 * GET /api/receipts/:id/ocr
 * Get OCR status and raw extracted text.
 */
router.get(
  '/:id/ocr',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  receiptController.getOcr
);

/**
 * POST /api/receipts/:id/retry-ocr
 * Re-trigger OCR extraction on an existing stored receipt.
 */
router.post(
  '/:id/retry-ocr',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  receiptController.retryOcr
);


/**
 * POST /api/receipts/:id/extraction
 * Trigger AI structured extraction on the receipt's OCR text.
 */
router.post(
  '/:id/extraction',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  extractionController.trigger
);

/**
 * GET /api/receipts/:id/extraction
 * Get extraction results, confidence, provenance, and deterministic effective values.
 */
router.get(
  '/:id/extraction',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  extractionController.get
);

/**
 * PUT /api/receipts/:id/extraction
 * Edit confirmed receipt values (human corrections).
 * Preserves AI extraction immutably.
 */
router.put(
  '/:id/extraction',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  extractionController.update
);

const validationController = require('../controllers/validationController');
const workflowController = require('../controllers/workflowController');

/**
 * POST /api/receipts/:id/validation
 * Run deterministic policy validation and duplicate detection (Checkpoint 5).
 */
router.post(
  '/:id/validation',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  validationController.validateReceipt
);

/**
 * GET /api/receipts/:id/validation
 * Retrieve latest policy validation and duplicate results.
 */
router.get(
  '/:id/validation',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  validationController.getReceiptValidation
);

/**
 * Workflow Routes (Checkpoint 6 - Approval Workflow)
 */
router.get(
  '/:id/workflow',
  authenticate,
  requireRole('EMPLOYEE', 'MANAGER', 'FINANCE'),
  workflowController.getWorkflow
);

router.post(
  '/:id/workflow/submit',
  authenticate,
  requireRole('EMPLOYEE'),
  workflowController.submitExpense
);

router.post(
  '/:id/workflow/approve',
  authenticate,
  requireRole('MANAGER'),
  workflowController.approveExpense
);

router.post(
  '/:id/workflow/reject',
  authenticate,
  requireRole('MANAGER'),
  workflowController.rejectExpense
);

router.post(
  '/:id/workflow/request-correction',
  authenticate,
  requireRole('MANAGER'),
  workflowController.requestCorrection
);

module.exports = router;
