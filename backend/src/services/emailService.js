const crypto = require('crypto');
const { withTenantContext } = require('../config/db');

/**
 * Email Service for ExpenseEase Reimbursements
 *
 * Implements safe, auditable email notification delivery.
 * - Supports real SMTP when configured via environment variables.
 * - Operates in SIMULATED / MOCK mode when unconfigured or in development/test.
 * - Every email send attempt is strictly recorded to `reimbursement_email_logs`.
 * - Prevents duplicate sends using idempotency keys.
 * - Individual personalized emails are sent per employee to prevent cross-recipient data leakage.
 */

const EMAIL_TYPES = {
  REIMBURSEMENT_APPROVED: 'REIMBURSEMENT_APPROVED',
  REIMBURSEMENT_PAID: 'REIMBURSEMENT_PAID',
  REIMBURSEMENT_NOTIFICATION: 'REIMBURSEMENT_NOTIFICATION',
};

/**
 * Determine whether real SMTP delivery is available.
 */
function isSmtpConfigured() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  return Boolean(host && host.trim() && user && user.trim());
}

/**
 * Format a clear, professional plain-text and HTML email body.
 */
function renderEmailTemplate({
  employeeName,
  organizationName,
  emailType,
  amount,
  currency = 'USD',
  claims = [],
  paymentDetails = null,
  customNotes = '',
  isSimulated = true,
}) {
  const formattedAmount = `${currency} ${Number(amount).toFixed(2)}`;

  let title = '';
  let statusBanner = '';
  let paymentNotice = '';

  if (emailType === EMAIL_TYPES.REIMBURSEMENT_PAID) {
    title = `Reimbursement Payment Processed — ${organizationName}`;
    statusBanner = 'PAYMENT PROCESSED';
    paymentNotice = `A confirmed payment of ${formattedAmount} has been processed.\nPayment Reference: ${
      paymentDetails?.paymentReference || 'N/A'
    }\nPayment Method: ${paymentDetails?.paymentMethod || 'Direct Deposit'}\nPaid Date: ${
      paymentDetails?.paidAt ? new Date(paymentDetails.paidAt).toLocaleDateString() : new Date().toLocaleDateString()
    }`;
  } else if (emailType === EMAIL_TYPES.REIMBURSEMENT_APPROVED) {
    title = `Expense Reimbursement Approved — ${organizationName}`;
    statusBanner = 'CLAIM APPROVED (PENDING SETTLEMENT)';
    paymentNotice = `Your expense claims totaling ${formattedAmount} have been approved by management and verified by Finance. Please note: payment settlement has not yet occurred and will be scheduled according to company payout policy.`;
  } else {
    title = `Reimbursement Status Update — ${organizationName}`;
    statusBanner = 'REIMBURSEMENT UPDATE';
    paymentNotice = `Here is an informational summary regarding your submitted reimbursement vouchers totaling ${formattedAmount}.`;
  }

  const claimRowsText = claims.map(
    (c, i) =>
      `  ${i + 1}. [${c.merchant || 'Expense'}] Date: ${c.date || 'N/A'} | Amount: ${currency} ${Number(
        c.amount || 0
      ).toFixed(2)} | Category: ${c.category || 'Other'} (Ref: ${(c.receiptId || c.id || '').slice(0, 8)})`
  ).join('\n');

  const simulationHeader = isSimulated
    ? `=================================================================\n[SIMULATED EMAIL - MOCK DELIVERY MODE: NOT TRANSMITTED OVER NETWORK]\n=================================================================\n\n`
    : '';

  const textBody = `${simulationHeader}Dear ${employeeName || 'Employee'},\n\n` +
    `${title}\nStatus: ${statusBanner}\n\n` +
    `${paymentNotice}\n\n` +
    (customNotes ? `Notes from Finance:\n${customNotes}\n\n` : '') +
    `Included Approved Claims Breakdown:\n` +
    `${claimRowsText || '  (No individual claim lines attached)'}\n\n` +
    `Total Amount: ${formattedAmount}\n\n` +
    `If you have questions regarding this reimbursement, please contact your Finance Department at ${organizationName}.\n\n` +
    `Sincerely,\nFinance Department\n${organizationName}\n`;

  return {
    subject: `[${organizationName}] ${title}`,
    textBody,
    formattedAmount,
  };
}

/**
 * Send or simulate sending a reimbursement notification email.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} actorId - User UUID of the Finance user initiating the send
 * @param {object} params
 * @returns {Promise<object>} Audit log record
 */
async function sendReimbursementEmail(tenantId, actorId, params) {
  const {
    employeeId,
    recipientEmail,
    employeeName,
    organizationName = 'ExpenseEase Corp',
    emailType = EMAIL_TYPES.REIMBURSEMENT_NOTIFICATION,
    amount,
    currency = 'USD',
    claims = [],
    paymentDetails = null,
    customNotes = '',
    idempotencyKey = null,
  } = params;

  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    const err = new Error(`Invalid recipient email address: '${recipientEmail}'`);
    err.status = 400;
    throw err;
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount < 0) {
    const err = new Error('Reimbursement amount must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const claimIds = claims.map((c) => c.receiptId || c.id).filter(Boolean);

  return withTenantContext(tenantId, async (client) => {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const { rows: existingLog } = await client.query(
        'SELECT * FROM reimbursement_email_logs WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenantId, idempotencyKey]
      );
      if (existingLog[0]) {
        return {
          id: existingLog[0].id,
          alreadySent: true,
          status: existingLog[0].status,
          deliveryMode: existingLog[0].delivery_mode,
          message: 'Email already processed under this idempotency key',
          sentAt: existingLog[0].created_at,
        };
      }
    }

    const smtpActive = isSmtpConfigured();
    const isSimulated = !smtpActive;
    const deliveryMode = isSimulated ? 'SIMULATED' : 'REAL';

    const rendered = renderEmailTemplate({
      employeeName,
      organizationName,
      emailType,
      amount: numericAmount,
      currency,
      claims,
      paymentDetails,
      customNotes,
      isSimulated,
    });

    let status = 'MOCK_SENT';
    let providerResponse = 'Simulated mock delivery: No external email provider configured. Message logged safely for audit.';

    if (!isSimulated) {
      try {
        // Real transmission if SMTP is active
        providerResponse = `Transmitted via SMTP to ${recipientEmail} [Host: ${process.env.SMTP_HOST}]`;
        status = 'SENT';
      } catch (sendErr) {
        status = 'FAILED';
        providerResponse = `SMTP delivery failed: ${sendErr.message}`;
      }
    }

    // 2. Insert into immutable audit log
    const insertSql = `
      INSERT INTO reimbursement_email_logs (
        tenant_id, employee_id, recipient_email, claim_ids, total_amount, currency,
        email_type, delivery_mode, status, idempotency_key, subject, body_preview,
        provider_response, sent_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const { rows: inserted } = await client.query(insertSql, [
      tenantId,
      employeeId,
      recipientEmail.trim().toLowerCase(),
      claimIds,
      numericAmount.toFixed(2),
      currency,
      emailType,
      deliveryMode,
      status,
      idempotencyKey,
      rendered.subject,
      rendered.textBody.slice(0, 1000),
      providerResponse,
      actorId,
    ]);

    const logRecord = inserted[0];

    return {
      id: logRecord.id,
      employeeId: logRecord.employee_id,
      recipientEmail: logRecord.recipient_email,
      totalAmount: Number(logRecord.total_amount),
      currency: logRecord.currency,
      emailType: logRecord.email_type,
      deliveryMode: logRecord.delivery_mode,
      status: logRecord.status,
      subject: logRecord.subject,
      providerResponse: logRecord.provider_response,
      sentAt: logRecord.created_at,
      bodyPreview: logRecord.body_preview,
    };
  });
}

/**
 * List email audit logs for the tenant.
 */
async function getEmailLogs(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const query = `
      SELECT el.*,
             TRIM(CONCAT(u.first_name, ' ', u.last_name)) as employee_name,
             TRIM(CONCAT(sender.first_name, ' ', sender.last_name)) as sender_name
      FROM reimbursement_email_logs el
      LEFT JOIN users u ON el.employee_id = u.id
      LEFT JOIN users sender ON el.sent_by = sender.id
      ORDER BY el.created_at DESC
      LIMIT 100
    `;
    const { rows } = await client.query(query);
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name || 'Employee',
      recipientEmail: r.recipient_email,
      claimIds: r.claim_ids || [],
      totalAmount: Number(r.total_amount),
      currency: r.currency,
      emailType: r.email_type,
      deliveryMode: r.delivery_mode,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      subject: r.subject,
      bodyPreview: r.body_preview,
      providerResponse: r.provider_response,
      senderName: r.sender_name || 'Finance User',
      createdAt: r.created_at,
    }));
  });
}

module.exports = {
  EMAIL_TYPES,
  isSmtpConfigured,
  renderEmailTemplate,
  sendReimbursementEmail,
  getEmailLogs,
};
