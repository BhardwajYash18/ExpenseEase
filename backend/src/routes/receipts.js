const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const receiptController = require('../controllers/receiptController');
const config = require('../config/env');

const router = express.Router();

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

module.exports = router;
