const express = require('express');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const financeController = require('../controllers/financeReimbursementController');
const { validateUuidParam } = require('../utils/validationUtils');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// All routes require authentication and FINANCE role
router.use(authenticate);
router.use(requireRole('FINANCE'));

// Parameter validation
router.param('receiptId', validateUuidParam('receiptId'));
router.param('importId', validateUuidParam('importId'));
router.param('entryId', validateUuidParam('entryId'));

// 1. Reimbursement Email Center
router.get('/reimbursements/summary', financeController.getReimbursementSummary);
router.post('/reimbursements/preview', financeController.previewEmail);
router.post('/reimbursements/send', financeController.sendEmails);
router.get('/reimbursements/email-logs', financeController.getEmailLogs);
router.post('/reimbursements/payments', financeController.recordPayment);
router.get('/reimbursements/payments/:receiptId', financeController.getReceiptPayments);

// 2. Organization Expense Ledger
router.get('/expenses', financeController.getOrganizationExpenses);

// 3. External Financial Imports
router.get('/external-imports', financeController.listExternalImports);
router.post('/external-imports/upload', upload.single('file'), financeController.uploadAndPreviewExternalData);
router.post('/external-imports/:importId/commit', financeController.commitExternalData);

// 4. Direct Financial Entries (Feature B)
router.get('/direct-entries', financeController.listDirectEntries);
router.post('/direct-entries', upload.single('attachment'), financeController.createDirectEntry);
router.post('/direct-entries/ocr-preview', upload.single('attachment'), financeController.previewDirectEntryOcr);
router.get('/direct-entries/:entryId', financeController.getDirectEntry);
router.post('/direct-entries/:entryId/post', financeController.postDirectEntry);
router.get('/direct-entries/:entryId/attachment', financeController.getDirectEntryAttachment);

module.exports = router;
