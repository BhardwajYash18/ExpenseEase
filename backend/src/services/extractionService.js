const axios = require('axios');
const config = require('../config/env');
const { withTenantContext } = require('../config/db');
const { validateAndSanitizeAiOutput, ALLOWED_CATEGORIES } = require('../utils/aiOutputValidation');

/**
 * Extraction service — orchestrates AI receipt understanding and human confirmation.
 *
 * Data Provenance Architecture:
 * - AI fields (ai_*) are stored on extraction and NEVER overwritten by human edits.
 * - Confirmed fields (confirmed_*) are populated when an authorized user edits/confirms.
 * - Effective values are computed deterministically:
 *     effective_value = confirmed_value IS NOT NULL ? confirmed_value : ai_value
 *
 * Authorization:
 * - EMPLOYEE: can only trigger, view, and confirm extractions for receipts they uploaded.
 * - MANAGER / FINANCE: can view and confirm extractions for any receipt within their tenant.
 */

function formatDateString(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    return val.split('T')[0];
  }
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val);
}

function computeEffectiveValues(row) {
  const confirmedDate = formatDateString(row.confirmed_receipt_date);
  const aiDate = formatDateString(row.ai_receipt_date);
  const total = row.confirmed_total_amount !== null && row.confirmed_total_amount !== undefined
    ? Number(row.confirmed_total_amount)
    : (row.ai_total_amount !== null ? Number(row.ai_total_amount) : null);

  const reqAmount = row.requested_amount !== null && row.requested_amount !== undefined
    ? Number(row.requested_amount)
    : total;

  return {
    merchantName: row.confirmed_merchant_name !== null && row.confirmed_merchant_name !== undefined
      ? row.confirmed_merchant_name
      : row.ai_merchant_name,
    receiptDate: confirmedDate !== null && confirmedDate !== undefined
      ? confirmedDate
      : aiDate,
    totalAmount: total,
    requestedAmount: reqAmount,
    reimbursementDescription: row.reimbursement_description || '',
    subtotalAmount: row.confirmed_subtotal_amount !== null && row.confirmed_subtotal_amount !== undefined
      ? Number(row.confirmed_subtotal_amount)
      : (row.ai_subtotal_amount !== null ? Number(row.ai_subtotal_amount) : null),
    taxAmount: row.confirmed_tax_amount !== null && row.confirmed_tax_amount !== undefined
      ? Number(row.confirmed_tax_amount)
      : (row.ai_tax_amount !== null ? Number(row.ai_tax_amount) : null),
    currency: row.confirmed_currency !== null && row.confirmed_currency !== undefined
      ? row.confirmed_currency
      : (row.ai_currency || 'USD'),
    receiptNumber: row.confirmed_receipt_number !== null && row.confirmed_receipt_number !== undefined
      ? row.confirmed_receipt_number
      : row.ai_receipt_number,
    category: row.confirmed_category !== null && row.confirmed_category !== undefined
      ? row.confirmed_category
      : (row.ai_suggested_category || 'Other'),
  };
}

function formatExtractionResponse(row, lineItems = []) {
  if (!row) return null;

  return {
    id: row.id,
    receiptId: row.receipt_id,
    tenantId: row.tenant_id,
    extractionStatus: row.extraction_status,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    // AI extracted values (Immutable provenance)
    aiData: {
      merchantName: row.ai_merchant_name,
      receiptDate: formatDateString(row.ai_receipt_date),
      totalAmount: row.ai_total_amount !== null ? Number(row.ai_total_amount) : null,
      subtotalAmount: row.ai_subtotal_amount !== null ? Number(row.ai_subtotal_amount) : null,
      taxAmount: row.ai_tax_amount !== null ? Number(row.ai_tax_amount) : null,
      currency: row.ai_currency,
      receiptNumber: row.ai_receipt_number,
      suggestedCategory: row.ai_suggested_category,
      confidenceScore: row.ai_confidence_score !== null ? Number(row.ai_confidence_score) : null,
      isFlaggedForReview: Boolean(row.ai_is_flagged_for_review),
      reviewReasons: row.ai_review_reasons || [],
      fieldConfidences: row.ai_field_confidences || {},
    },

    // Confirmed values (Human corrections)
    confirmedData: {
      merchantName: row.confirmed_merchant_name,
      receiptDate: formatDateString(row.confirmed_receipt_date),
      totalAmount: row.confirmed_total_amount !== null ? Number(row.confirmed_total_amount) : null,
      requestedAmount: row.requested_amount !== null && row.requested_amount !== undefined ? Number(row.requested_amount) : null,
      reimbursementDescription: row.reimbursement_description || null,
      subtotalAmount: row.confirmed_subtotal_amount !== null ? Number(row.confirmed_subtotal_amount) : null,
      taxAmount: row.confirmed_tax_amount !== null ? Number(row.confirmed_tax_amount) : null,
      currency: row.confirmed_currency,
      receiptNumber: row.confirmed_receipt_number,
      category: row.confirmed_category,
      correctedBy: row.corrected_by,
      correctedAt: row.corrected_at,
    },

    // Deterministic effective values
    effectiveValues: computeEffectiveValues(row),


    // Line items
    lineItems: lineItems.map((li) => ({
      id: li.id,
      lineNumber: li.line_number,
      description: li.description,
      quantity: Number(li.quantity),
      unitPrice: li.unit_price !== null ? Number(li.unit_price) : null,
      totalPrice: li.total_price !== null ? Number(li.total_price) : null,
    })),
  };
}

/**
 * Trigger AI extraction for a receipt.
 */
async function triggerExtraction(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Verify receipt exists and check user role permissions
    let receiptQuery = 'SELECT id, uploaded_by, ocr_raw_text, ocr_status FROM receipts WHERE id = $1';
    const params = [receiptId];
    if (user.role === 'EMPLOYEE') {
      receiptQuery += ' AND uploaded_by = $2';
      params.push(user.id);
    }

    const { rows: receiptRows } = await client.query(receiptQuery, params);
    if (!receiptRows[0]) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }

    const receipt = receiptRows[0];
    const ocrRawText = receipt.ocr_raw_text || '';

    // 2. Upsert extraction record with status PROCESSING
    const upsertProcessingSql = `
      INSERT INTO receipt_extractions (
        receipt_id, tenant_id, extraction_status
      ) VALUES ($1, $2, 'PROCESSING')
      ON CONFLICT (receipt_id) DO UPDATE SET
        extraction_status = 'PROCESSING',
        extraction_error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const { rows: extractionInit } = await client.query(upsertProcessingSql, [receiptId, tenantId]);
    const extractionId = extractionInit[0].id;

    // 3. Call AI Service /receipt-understanding/extract
    let aiResponseData;
    try {
      const aiServiceUrl = `${config.aiServiceUrl}/receipt-understanding/extract`;
      const response = await axios.post(
        aiServiceUrl,
        { ocr_raw_text: ocrRawText },
        { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
      );
      aiResponseData = response.data;
    } catch (aiErr) {
      const errorMsg = aiErr.response?.data?.detail || aiErr.message || 'AI service call failed';
      await client.query(
        `UPDATE receipt_extractions SET
          extraction_status = 'FAILED',
          extraction_error_message = $1,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [errorMsg, extractionId]
      );
      const err = new Error(`AI service processing failed: ${errorMsg}`);
      err.status = 502;
      throw err;
    }

    // 4. Validate & sanitize AI response
    const validation = validateAndSanitizeAiOutput(aiResponseData);
    if (!validation.valid) {
      const err = new Error(`AI output validation failed: ${validation.error}`);
      err.status = 502;
      throw err;
    }

    const s = validation.data;

    // 5. Update extraction record with validated AI values (ai_* fields only)
    const updateSql = `
      UPDATE receipt_extractions SET
        extraction_status = 'COMPLETED',
        model_provider = $1,
        model_name = $2,
        raw_model_response = $3,
        extracted_at = CURRENT_TIMESTAMP,
        ai_merchant_name = $4,
        ai_receipt_date = $5,
        ai_total_amount = $6,
        ai_subtotal_amount = $7,
        ai_tax_amount = $8,
        ai_currency = $9,
        ai_receipt_number = $10,
        ai_suggested_category = $11,
        ai_confidence_score = $12,
        ai_is_flagged_for_review = $13,
        ai_review_reasons = $14,
        ai_field_confidences = $15,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *
    `;

    const { rows: updatedRows } = await client.query(updateSql, [
      s.modelProvider,
      s.modelName,
      s.rawModelResponse,
      s.merchantName,
      s.receiptDate,
      s.totalAmount,
      s.subtotalAmount,
      s.taxAmount,
      s.currency,
      s.receiptNumber,
      s.suggestedCategory,
      s.confidenceScore,
      s.isFlaggedForReview,
      JSON.stringify(s.reviewReasons),
      JSON.stringify(s.fieldConfidences),
      extractionId,
    ]);

    // 6. Delete previous line items and insert new ones
    await client.query('DELETE FROM receipt_line_items WHERE receipt_extraction_id = $1', [extractionId]);

    const insertedLineItems = [];
    for (const li of s.lineItems) {
      const { rows: liRows } = await client.query(
        `INSERT INTO receipt_line_items (
          receipt_extraction_id, tenant_id, line_number, description, quantity, unit_price, total_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [extractionId, tenantId, li.lineNumber, li.description, li.quantity, li.unitPrice, li.totalPrice]
      );
      insertedLineItems.push(liRows[0]);
    }

    return formatExtractionResponse(updatedRows[0], insertedLineItems);
  });
}

/**
 * Get extraction for a receipt.
 */
async function getExtraction(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
    // Check receipt ownership/tenant access
    let receiptQuery = 'SELECT id, uploaded_by FROM receipts WHERE id = $1';
    const params = [receiptId];
    if (user.role === 'EMPLOYEE') {
      receiptQuery += ' AND uploaded_by = $2';
      params.push(user.id);
    }

    const { rows: receiptRows } = await client.query(receiptQuery, params);
    if (!receiptRows[0]) {
      return null;
    }

    const { rows: extractionRows } = await client.query(
      'SELECT * FROM receipt_extractions WHERE receipt_id = $1',
      [receiptId]
    );

    if (!extractionRows[0]) {
      return null;
    }

    const extraction = extractionRows[0];
    const { rows: lineItemRows } = await client.query(
      'SELECT * FROM receipt_line_items WHERE receipt_extraction_id = $1 ORDER BY line_number ASC',
      [extraction.id]
    );

    return formatExtractionResponse(extraction, lineItemRows);
  });
}

/**
 * Confirm / update extracted values (Human edits).
 * Never mutates AI-extracted values (ai_*).
 */
async function updateExtraction(tenantId, receiptId, user, confirmedData) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Verify receipt existence and role-based access
    let receiptQuery = 'SELECT id, uploaded_by FROM receipts WHERE id = $1';
    const params = [receiptId];
    if (user.role === 'EMPLOYEE') {
      receiptQuery += ' AND uploaded_by = $2';
      params.push(user.id);
    }

    const { rows: receiptRows } = await client.query(receiptQuery, params);
    if (!receiptRows[0]) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }

    // 2. Fetch existing extraction
    const { rows: existingRows } = await client.query(
      'SELECT * FROM receipt_extractions WHERE receipt_id = $1',
      [receiptId]
    );

    const extraction = existingRows[0] || null;

    // 3. Validate confirmed data fields
    let merchant = extraction ? extraction.confirmed_merchant_name : null;
    if (confirmedData.merchantName !== undefined) {
      merchant = confirmedData.merchantName !== null ? String(confirmedData.merchantName).trim().slice(0, 255) || null : null;
    }

    let receiptDate = extraction ? extraction.confirmed_receipt_date : null;
    if (confirmedData.receiptDate !== undefined) {
      if (confirmedData.receiptDate === null || confirmedData.receiptDate === '') {
        receiptDate = null;
      } else {
        const dStr = String(confirmedData.receiptDate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
          const err = new Error('receiptDate must be in YYYY-MM-DD format');
          err.status = 400;
          throw err;
        }
        receiptDate = dStr;
      }
    }

    let totalAmount = extraction ? extraction.confirmed_total_amount : null;
    if (confirmedData.totalAmount !== undefined) {
      if (confirmedData.totalAmount === null || confirmedData.totalAmount === '') {
        totalAmount = null;
      } else {
        const num = Number(confirmedData.totalAmount);
        if (isNaN(num) || num < 0) {
          const err = new Error('totalAmount must be a non-negative number');
          err.status = 400;
          throw err;
        }
        totalAmount = Number(num.toFixed(2));
      }
    }

    let subtotalAmount = extraction ? extraction.confirmed_subtotal_amount : null;
    if (confirmedData.subtotalAmount !== undefined) {
      if (confirmedData.subtotalAmount === null || confirmedData.subtotalAmount === '') {
        subtotalAmount = null;
      } else {
        const num = Number(confirmedData.subtotalAmount);
        if (isNaN(num) || num < 0) {
          const err = new Error('subtotalAmount must be a non-negative number');
          err.status = 400;
          throw err;
        }
        subtotalAmount = Number(num.toFixed(2));
      }
    }

    let taxAmount = extraction ? extraction.confirmed_tax_amount : null;
    if (confirmedData.taxAmount !== undefined) {
      if (confirmedData.taxAmount === null || confirmedData.taxAmount === '') {
        taxAmount = null;
      } else {
        const num = Number(confirmedData.taxAmount);
        if (isNaN(num) || num < 0) {
          const err = new Error('taxAmount must be a non-negative number');
          err.status = 400;
          throw err;
        }
        taxAmount = Number(num.toFixed(2));
      }
    }

    let currency = extraction ? extraction.confirmed_currency : 'USD';
    if (confirmedData.currency !== undefined) {
      currency = confirmedData.currency ? String(confirmedData.currency).trim().toUpperCase().slice(0, 3) : 'USD';
    }

    let receiptNumber = extraction ? extraction.confirmed_receipt_number : null;
    if (confirmedData.receiptNumber !== undefined) {
      receiptNumber = confirmedData.receiptNumber !== null ? String(confirmedData.receiptNumber).trim().slice(0, 100) || null : null;
    }

    let category = extraction ? extraction.confirmed_category : 'Other';
    if (confirmedData.category !== undefined) {
      if (confirmedData.category === null || confirmedData.category === '') {
        category = 'Other';
      } else {
        const catStr = String(confirmedData.category).trim();
        if (!ALLOWED_CATEGORIES.has(catStr)) {
          const err = new Error(`Invalid category '${catStr}'. Allowed categories: ${Array.from(ALLOWED_CATEGORIES).join(', ')}`);
          err.status = 400;
          throw err;
        }
        category = catStr;
      }
    }

    let requestedAmount = extraction ? extraction.requested_amount : null;
    if (confirmedData.requestedAmount !== undefined) {
      if (confirmedData.requestedAmount === null || confirmedData.requestedAmount === '') {
        requestedAmount = null;
      } else {
        const num = Number(confirmedData.requestedAmount);
        if (isNaN(num) || num < 0) {
          const err = new Error('requestedAmount must be a non-negative number');
          err.status = 400;
          throw err;
        }
        requestedAmount = Number(num.toFixed(2));
      }
    } else if (requestedAmount === null && totalAmount !== null) {
      requestedAmount = totalAmount;
    }

    let reimbursementDescription = extraction ? extraction.reimbursement_description : null;
    if (confirmedData.description !== undefined) {
      reimbursementDescription = confirmedData.description !== null ? String(confirmedData.description).trim() || null : null;
    } else if (confirmedData.reimbursementDescription !== undefined) {
      reimbursementDescription = confirmedData.reimbursementDescription !== null ? String(confirmedData.reimbursementDescription).trim() || null : null;
    }

    // 4. Update or insert the extraction record
    let updatedRows;
    if (extraction) {
      const updateSql = `
        UPDATE receipt_extractions SET
          confirmed_merchant_name = $1,
          confirmed_receipt_date = $2,
          confirmed_total_amount = $3,
          confirmed_subtotal_amount = $4,
          confirmed_tax_amount = $5,
          confirmed_currency = $6,
          confirmed_receipt_number = $7,
          confirmed_category = $8,
          requested_amount = $9,
          reimbursement_description = $10,
          corrected_by = $11,
          corrected_at = CURRENT_TIMESTAMP,
          extraction_status = 'MANUALLY_CONFIRMED',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
        RETURNING *
      `;
      const res = await client.query(updateSql, [
        merchant,
        receiptDate,
        totalAmount,
        subtotalAmount,
        taxAmount,
        currency,
        receiptNumber,
        category,
        requestedAmount,
        reimbursementDescription,
        user.id,
        extraction.id,
      ]);
      updatedRows = res.rows;
    } else {
      const insertSql = `
        INSERT INTO receipt_extractions (
          receipt_id,
          tenant_id,
          extraction_status,
          confirmed_merchant_name,
          confirmed_receipt_date,
          confirmed_total_amount,
          confirmed_subtotal_amount,
          confirmed_tax_amount,
          confirmed_currency,
          confirmed_receipt_number,
          confirmed_category,
          requested_amount,
          reimbursement_description,
          corrected_by,
          corrected_at
        ) VALUES ($1, $2, 'MANUALLY_CONFIRMED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        RETURNING *
      `;
      const res = await client.query(insertSql, [
        receiptId,
        tenantId,
        merchant,
        receiptDate,
        totalAmount,
        subtotalAmount,
        taxAmount,
        currency,
        receiptNumber,
        category,
        requestedAmount,
        reimbursementDescription,
        user.id,
      ]);
      updatedRows = res.rows;
    }

    const extractionId = updatedRows[0].id;
    const { rows: lineItemRows } = await client.query(
      'SELECT * FROM receipt_line_items WHERE receipt_extraction_id = $1 ORDER BY line_number ASC',
      [extractionId]
    );

    return formatExtractionResponse(updatedRows[0], lineItemRows);

  });
}

module.exports = {
  triggerExtraction,
  getExtraction,
  updateExtraction,
  computeEffectiveValues,
  formatExtractionResponse,
};
