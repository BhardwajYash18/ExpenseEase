const reimbursementService = require('../services/reimbursementService');
const emailService = require('../services/emailService');
const externalImportService = require('../services/externalImportService');
const directEntryService = require('../services/directEntryService');
const receiptService = require('../services/receiptService');

/**
 * Controller for Finance Reimbursements, Organization Expenses, External Imports, and Direct Financial Entries.
 * All handlers enforce tenant context and require FINANCE role.
 */

// 1. REIMBURSEMENT NOTIFICATION EMAILS
async function getReimbursementSummary(req, res, next) {
  try {
    const summary = await reimbursementService.getReimbursementSummary(req.user.tenantId, {
      employeeId: req.query.employeeId,
      reimbursementStatus: req.query.status,
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

async function previewEmail(req, res, next) {
  try {
    const preview = await reimbursementService.previewReimbursementEmail(req.user.tenantId, {
      employeeId: req.body.employeeId,
      claimIds: req.body.claimIds,
      emailType: req.body.emailType,
      customNotes: req.body.customNotes,
    });
    res.json(preview);
  } catch (err) {
    next(err);
  }
}

async function sendEmails(req, res, next) {
  try {
    const result = await reimbursementService.sendReimbursementEmails(
      req.user.tenantId,
      req.user.id,
      req.body
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getEmailLogs(req, res, next) {
  try {
    const logs = await emailService.getEmailLogs(req.user.tenantId);
    res.json({ emailLogs: logs });
  } catch (err) {
    next(err);
  }
}

async function recordPayment(req, res, next) {
  try {
    const result = await reimbursementService.recordPayment(
      req.user.tenantId,
      req.user.id,
      req.body
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getReceiptPayments(req, res, next) {
  try {
    const payments = await reimbursementService.getPaymentsForReceipt(req.user.tenantId, req.params.receiptId);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
}

// 2. ORGANIZATION EXPENSE LEDGER (Feature B / C)
async function getOrganizationExpenses(req, res, next) {
  try {
    // Pass role: 'FINANCE' to view tenant-wide submissions and filter by claimType
    const options = {
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      claimType: req.query.claimType,
      role: 'FINANCE',
      userId: req.user.id,
    };
    const result = await receiptService.listReceipts(req.user.tenantId, options);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// 3. EXTERNAL FINANCIAL IMPORTS
async function uploadAndPreviewExternalData(req, res, next) {
  try {
    if (!req.file) {
      const err = new Error('No CSV file uploaded');
      err.status = 400;
      throw err;
    }

    const preview = await externalImportService.validateAndPreviewCsv(
      req.user.tenantId,
      req.user.id,
      req.file.buffer,
      req.file.originalname
    );

    res.json(preview);
  } catch (err) {
    next(err);
  }
}

async function commitExternalData(req, res, next) {
  try {
    const result = await externalImportService.commitExternalImport(
      req.user.tenantId,
      req.user.id,
      req.params.importId,
      req.body
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function listExternalImports(req, res, next) {
  try {
    const imports = await externalImportService.listExternalImports(req.user.tenantId);
    res.json({ imports });
  } catch (err) {
    next(err);
  }
}

// 4. DIRECT FINANCIAL ENTRIES (Feature B)
async function createDirectEntry(req, res, next) {
  try {
    const result = await directEntryService.createDirectEntry(
      req.user.tenantId,
      req.user.id,
      req.body,
      req.file
    );
    res.status(201).json({ directEntry: result });
  } catch (err) {
    next(err);
  }
}

async function listDirectEntries(req, res, next) {
  try {
    const result = await directEntryService.listDirectEntries(
      req.user.tenantId,
      req.query
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getDirectEntry(req, res, next) {
  try {
    const entryId = req.params.entryId || req.params.id;
    const result = await directEntryService.getDirectEntryById(
      req.user.tenantId,
      entryId
    );
    if (!result) {
      return res.status(404).json({ error: { message: 'Direct financial entry not found' } });
    }
    res.json({ directEntry: result });
  } catch (err) {
    next(err);
  }
}

async function postDirectEntry(req, res, next) {
  try {
    const entryId = req.params.entryId || req.params.id;
    const result = await directEntryService.postDirectEntry(
      req.user.tenantId,
      req.user.id,
      entryId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getDirectEntryAttachment(req, res, next) {
  try {
    const entryId = req.params.entryId || req.params.id;
    const attachment = await directEntryService.getDirectEntryAttachment(
      req.user.tenantId,
      entryId
    );
    if (!attachment) {
      return res.status(404).json({ error: { message: 'Attachment not found' } });
    }
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    res.send(attachment.buffer);
  } catch (err) {
    next(err);
  }
}

async function previewDirectEntryOcr(req, res, next) {
  try {
    const result = await directEntryService.previewDirectEntryOcr(req.file);
    res.json({ preview: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getReimbursementSummary,
  previewEmail,
  sendEmails,
  getEmailLogs,
  recordPayment,
  getReceiptPayments,
  getOrganizationExpenses,
  uploadAndPreviewExternalData,
  commitExternalData,
  listExternalImports,
  createDirectEntry,
  listDirectEntries,
  getDirectEntry,
  postDirectEntry,
  getDirectEntryAttachment,
  previewDirectEntryOcr,
};
