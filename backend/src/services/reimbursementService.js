const { withTenantContext, withTransaction } = require('../config/db');
const { parseToCents } = require('./policy/decimalUtils');
const emailService = require('./emailService');

/**
 * Reimbursement Service
 *
 * Implements authoritative reimbursement calculations, payment ledger recordings,
 * and individual employee email dispatching.
 */

/**
 * Get reimbursement summaries grouped by employee.
 * Only APPROVED claims are eligible.
 */
async function getReimbursementSummary(tenantId, options = {}) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Get tenant details
    const { rows: tenantRows } = await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
    const tenantName = tenantRows[0]?.name || 'ExpenseEase';

    // 2. Query all approved claims with extractions and workflow state
    let query = `
      SELECT r.id as receipt_id, r.uploaded_by as employee_id, r.original_filename, r.created_at as receipt_date,
             u.email as employee_email, TRIM(CONCAT(u.first_name, ' ', u.last_name)) as employee_name,
             ew.id as workflow_id, ew.current_state as workflow_state,
             ew.reimbursement_status, ew.total_reimbursed_amount,
             ew.submitted_at, ew.completed_at as approved_at,
             re.ai_total_amount, re.confirmed_total_amount,
             re.ai_currency, re.confirmed_currency,
             re.ai_merchant_name, re.confirmed_merchant_name,
             re.ai_suggested_category, re.confirmed_category
      FROM receipts r
      JOIN expense_workflows ew ON r.id = ew.receipt_id
      JOIN users u ON r.uploaded_by = u.id
      LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
      WHERE ew.current_state = 'APPROVED' AND (ew.claim_type = 'REIMBURSEMENT' OR ew.claim_type IS NULL)
    `;

    const params = [];
    if (options.employeeId) {
      params.push(options.employeeId);
      query += ` AND r.uploaded_by = $${params.length}`;
    }

    if (options.reimbursementStatus && options.reimbursementStatus !== 'ALL') {
      params.push(options.reimbursementStatus);
      query += ` AND ew.reimbursement_status = $${params.length}`;
    }

    query += ` ORDER BY u.last_name ASC, u.first_name ASC, ew.completed_at DESC`;

    const { rows } = await client.query(query, params);

    // Group claims by employee
    const employeeMap = new Map();

    for (const row of rows) {
      const empId = row.employee_id;
      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          employeeId: empId,
          employeeName: row.employee_name || 'Employee',
          employeeEmail: row.employee_email || '',
          organizationName: tenantName,
          claims: [],
          totalApprovedCents: 0,
          totalReimbursedCents: 0,
          totalOutstandingCents: 0,
          currency: row.confirmed_currency || row.ai_currency || 'USD',
        });
      }

      const empRecord = employeeMap.get(empId);

      // Deterministic amount calculation
      const approvedAmount = row.confirmed_total_amount !== null && row.confirmed_total_amount !== undefined
        ? Number(row.confirmed_total_amount)
        : (row.ai_total_amount !== null && row.ai_total_amount !== undefined ? Number(row.ai_total_amount) : 0);

      const reimbursedAmount = Number(row.total_reimbursed_amount || 0);
      const outstandingAmount = Math.max(0, approvedAmount - reimbursedAmount);

      const approvedParsed = parseToCents(approvedAmount);
      const reimbursedParsed = parseToCents(reimbursedAmount);
      const outstandingParsed = parseToCents(outstandingAmount);

      empRecord.totalApprovedCents += approvedParsed.valid ? approvedParsed.cents : 0;
      empRecord.totalReimbursedCents += reimbursedParsed.valid ? reimbursedParsed.cents : 0;
      empRecord.totalOutstandingCents += outstandingParsed.valid ? outstandingParsed.cents : 0;

      empRecord.claims.push({
        receiptId: row.receipt_id,
        workflowId: row.workflow_id,
        filename: row.original_filename,
        merchant: row.confirmed_merchant_name || row.ai_merchant_name || 'Expense',
        category: row.confirmed_category || row.ai_suggested_category || 'Other',
        date: row.confirmed_receipt_date || row.receipt_date,
        approvedAt: row.approved_at,
        approvedAmount: approvedParsed.formatted,
        reimbursedAmount: reimbursedParsed.formatted,
        outstandingAmount: outstandingParsed.formatted,
        reimbursementStatus: row.reimbursement_status || 'UNPAID',
        currency: row.confirmed_currency || row.ai_currency || 'USD',
      });
    }

    const summaries = Array.from(employeeMap.values()).map((emp) => ({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      employeeEmail: emp.employeeEmail,
      organizationName: emp.organizationName,
      currency: emp.currency,
      totalApprovedAmount: (emp.totalApprovedCents / 100).toFixed(2),
      totalReimbursedAmount: (emp.totalReimbursedCents / 100).toFixed(2),
      totalOutstandingAmount: (emp.totalOutstandingCents / 100).toFixed(2),
      claimCount: emp.claims.length,
      claims: emp.claims,
    }));

    return {
      organizationName: tenantName,
      summaries,
      totalEligibleEmployees: summaries.length,
    };
  });
}

/**
 * Preview an email for a given employee and selected claims.
 */
async function previewReimbursementEmail(tenantId, params) {
  const { employeeId, claimIds = [], emailType = 'REIMBURSEMENT_NOTIFICATION', customNotes = '' } = params;

  return withTenantContext(tenantId, async (client) => {
    const { rows: tenantRows } = await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
    const organizationName = tenantRows[0]?.name || 'ExpenseEase';

    const { rows: userRows } = await client.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1 AND tenant_id = $2',
      [employeeId, tenantId]
    );

    if (!userRows[0]) {
      const err = new Error('Employee not found in organization');
      err.status = 404;
      throw err;
    }

    const employee = userRows[0];
    const employeeName = `${employee.first_name} ${employee.last_name}`.trim();

    // Fetch claims
    let claimQuery = `
      SELECT r.id as receipt_id, r.original_filename,
             re.confirmed_merchant_name, re.ai_merchant_name,
             re.confirmed_total_amount, re.ai_total_amount,
             re.confirmed_currency, re.ai_currency,
             re.confirmed_category, re.ai_suggested_category,
             ew.reimbursement_status, ew.total_reimbursed_amount
      FROM receipts r
      JOIN expense_workflows ew ON r.id = ew.receipt_id
      LEFT JOIN receipt_extractions re ON r.id = re.receipt_id
      WHERE r.uploaded_by = $1 AND ew.current_state = 'APPROVED' AND (ew.claim_type = 'REIMBURSEMENT' OR ew.claim_type IS NULL)
    `;

    const queryParams = [employeeId];
    if (claimIds && claimIds.length > 0) {
      queryParams.push(claimIds);
      claimQuery += ` AND r.id = ANY($2::uuid[])`;
    }

    const { rows: claimRows } = await client.query(claimQuery, queryParams);

    let totalCents = 0;
    const formattedClaims = claimRows.map((c) => {
      const amt = c.confirmed_total_amount !== null && c.confirmed_total_amount !== undefined
        ? Number(c.confirmed_total_amount)
        : (c.ai_total_amount !== null && c.ai_total_amount !== undefined ? Number(c.ai_total_amount) : 0);
      const parsed = parseToCents(amt);
      totalCents += parsed.valid ? parsed.cents : 0;

      return {
        receiptId: c.receipt_id,
        merchant: c.confirmed_merchant_name || c.ai_merchant_name || 'Expense',
        category: c.confirmed_category || c.ai_suggested_category || 'Other',
        amount: parsed.formatted,
        currency: c.confirmed_currency || c.ai_currency || 'USD',
        reimbursementStatus: c.reimbursement_status,
      };
    });

    const totalAmount = (totalCents / 100).toFixed(2);
    const currency = formattedClaims[0]?.currency || 'USD';

    // Check latest payment details if email type is REIMBURSEMENT_PAID
    let paymentDetails = null;
    if (emailType === 'REIMBURSEMENT_PAID' && formattedClaims.length > 0) {
      const receiptIds = formattedClaims.map((c) => c.receiptId);
      const { rows: payRows } = await client.query(
        `SELECT * FROM reimbursement_payments
         WHERE receipt_id = ANY($1::uuid[]) AND tenant_id = $2
         ORDER BY paid_at DESC LIMIT 1`,
        [receiptIds, tenantId]
      );
      if (payRows[0]) {
        paymentDetails = {
          paymentReference: payRows[0].payment_reference,
          paymentMethod: payRows[0].payment_method,
          paidAt: payRows[0].paid_at,
          amount: payRows[0].amount,
        };
      }
    }

    const isSimulated = !emailService.isSmtpConfigured();

    const rendered = emailService.renderEmailTemplate({
      employeeName,
      organizationName,
      emailType,
      amount: totalAmount,
      currency,
      claims: formattedClaims,
      paymentDetails,
      customNotes,
      isSimulated,
    });

    return {
      employeeId,
      employeeName,
      recipientEmail: employee.email,
      organizationName,
      emailType,
      amount: totalAmount,
      currency,
      claims: formattedClaims,
      paymentDetails,
      subject: rendered.subject,
      previewText: rendered.textBody,
      isSimulated,
      deliveryMode: isSimulated ? 'SIMULATED' : 'REAL',
    };
  });
}

/**
 * Send reimbursement emails to selected employees.
 * Each employee receives an individual, personalized message.
 */
async function sendReimbursementEmails(tenantId, actorId, payload) {
  const {
    employeeIds = [],
    claimIdsByEmployee = {},
    emailType = 'REIMBURSEMENT_NOTIFICATION',
    customNotes = '',
    idempotencyKey = null,
  } = payload;

  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    const err = new Error('At least one employee must be selected');
    err.status = 400;
    throw err;
  }

  const results = [];

  for (const empId of employeeIds) {
    const claimIds = claimIdsByEmployee[empId] || [];

    // Get preview/data for this employee
    const preview = await previewReimbursementEmail(tenantId, {
      employeeId: empId,
      claimIds,
      emailType,
      customNotes,
    });

    const empIdempotency = idempotencyKey ? `${idempotencyKey}-${empId}` : null;

    const sendRes = await emailService.sendReimbursementEmail(tenantId, actorId, {
      employeeId: empId,
      recipientEmail: preview.recipientEmail,
      employeeName: preview.employeeName,
      organizationName: preview.organizationName,
      emailType,
      amount: preview.amount,
      currency: preview.currency,
      claims: preview.claims,
      paymentDetails: preview.paymentDetails,
      customNotes,
      idempotencyKey: empIdempotency,
    });

    results.push(sendRes);
  }

  return {
    sentCount: results.length,
    results,
  };
}

/**
 * Record a payment for an approved expense claim.
 * Atomically updates total_reimbursed_amount and updates reimbursement_status.
 */
async function recordPayment(tenantId, actorId, payload) {
  const {
    receiptId,
    amount,
    paymentMethod = 'DIRECT_DEPOSIT',
    paymentReference = null,
    notes = null,
  } = payload;

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    const err = new Error('Payment amount must be a positive number');
    err.status = 400;
    throw err;
  }

  return withTenantContext(tenantId, async (client) => {
    // 1. Fetch workflow and extraction
    const { rows: wfRows } = await client.query(
      `SELECT ew.*,
              re.confirmed_total_amount, re.ai_total_amount
       FROM expense_workflows ew
       LEFT JOIN receipt_extractions re ON ew.receipt_id = re.receipt_id
       WHERE ew.receipt_id = $1 AND ew.tenant_id = $2`,
      [receiptId, tenantId]
    );

    if (!wfRows[0]) {
      const err = new Error('Expense claim workflow not found');
      err.status = 404;
      throw err;
    }

    const wf = wfRows[0];
    if (wf.claim_type === 'NON_REIMBURSABLE') {
      const err = new Error('Cannot record reimbursement payment for a non-reimbursable recordkeeping bill.');
      err.status = 400;
      throw err;
    }
    if (wf.current_state !== 'APPROVED') {
      const err = new Error(`Cannot record payment for claim in '${wf.current_state}' status. Claim must be APPROVED.`);
      err.status = 400;
      throw err;
    }

    const approvedAmount = wf.confirmed_total_amount !== null && wf.confirmed_total_amount !== undefined
      ? Number(wf.confirmed_total_amount)
      : (wf.ai_total_amount !== null && wf.ai_total_amount !== undefined ? Number(wf.ai_total_amount) : 0);

    const prevReimbursed = Number(wf.total_reimbursed_amount || 0);
    const newTotalReimbursed = prevReimbursed + numericAmount;

    // Check status
    let newStatus = 'PARTIALLY_PAID';
    if (newTotalReimbursed >= approvedAmount - 0.001) {
      newStatus = 'PAID';
    }

    // Insert payment record
    const { rows: payRows } = await client.query(
      `INSERT INTO reimbursement_payments (
        tenant_id, receipt_id, workflow_id, amount, payment_method,
        payment_reference, recorded_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        tenantId,
        receiptId,
        wf.id,
        numericAmount.toFixed(2),
        paymentMethod,
        paymentReference,
        actorId,
        notes,
      ]
    );

    // Update expense_workflows
    await client.query(
      `UPDATE expense_workflows SET
        reimbursement_status = $1,
        total_reimbursed_amount = $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [newStatus, newTotalReimbursed.toFixed(2), wf.id]
    );

    return {
      payment: payRows[0],
      newReimbursementStatus: newStatus,
      totalReimbursedAmount: newTotalReimbursed.toFixed(2),
      approvedAmount: approvedAmount.toFixed(2),
    };
  });
}

/**
 * Get all payment records for a receipt.
 */
async function getPaymentsForReceipt(tenantId, receiptId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT rp.*,
              CONCAT(u.first_name, ' ', u.last_name) as recorded_by_name
       FROM reimbursement_payments rp
       LEFT JOIN users u ON rp.recorded_by = u.id
       WHERE rp.receipt_id = $1 AND rp.tenant_id = $2
       ORDER BY rp.paid_at DESC`,
      [receiptId, tenantId]
    );
    return rows;
  });
}

module.exports = {
  getReimbursementSummary,
  previewReimbursementEmail,
  sendReimbursementEmails,
  recordPayment,
  getPaymentsForReceipt,
};
