/**
 * AI Output Validation and Sanitization Utility (Checkpoint 4)
 *
 * Implements AGENTS.md Section 8 (AI Output Validation):
 * 1. Parsed
 * 2. Schema validated
 * 3. Type validated
 * 4. Sanitized
 * 5. Checked for missing or invalid fields
 * 6. Checked against application/business constraints
 */

const ALLOWED_CATEGORIES = new Set([
  'Meals',
  'Travel',
  'Accommodation',
  'Office Supplies',
  'Software',
  'Transportation',
  'Other',
]);

function parseDecimal(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num) || !isFinite(num) || num < 0) return null;
  return Number(num.toFixed(2));
}

function parseDate(val) {
  if (!val || typeof val !== 'string') return null;
  const isoMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : val;
}

function sanitizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return 'Other';
  const trimmed = cat.trim();
  return ALLOWED_CATEGORIES.has(trimmed) ? trimmed : 'Other';
}

function sanitizeCurrency(curr) {
  if (!curr || typeof curr !== 'string') return 'USD';
  const cleaned = curr.trim().toUpperCase().slice(0, 3);
  return cleaned || 'USD';
}

function validateAndSanitizeAiOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      error: 'AI output must be an object',
      data: null,
    };
  }

  const sanitized = {
    merchantName: typeof raw.merchant_name === 'string' ? raw.merchant_name.trim().slice(0, 255) || null : null,
    receiptDate: parseDate(raw.receipt_date),
    totalAmount: parseDecimal(raw.total_amount),
    subtotalAmount: parseDecimal(raw.subtotal_amount),
    taxAmount: parseDecimal(raw.tax_amount),
    currency: sanitizeCurrency(raw.currency),
    receiptNumber: typeof raw.receipt_number === 'string' ? raw.receipt_number.trim().slice(0, 100) || null : null,
    suggestedCategory: sanitizeCategory(raw.suggested_category),
    confidenceScore: typeof raw.confidence_score === 'number' && !isNaN(raw.confidence_score)
      ? Math.max(0, Math.min(1, Number(raw.confidence_score.toFixed(2))))
      : 0.0,
    isFlaggedForReview: Boolean(raw.is_flagged_for_review),
    reviewReasons: Array.isArray(raw.review_reasons)
      ? raw.review_reasons.filter((r) => typeof r === 'string').map((r) => r.slice(0, 255))
      : [],
    fieldConfidences: raw.field_confidences && typeof raw.field_confidences === 'object'
      ? raw.field_confidences
      : {},
    rawModelResponse: typeof raw.raw_model_response === 'string' ? raw.raw_model_response : JSON.stringify(raw),
    modelProvider: typeof raw.model_provider === 'string' ? raw.model_provider.slice(0, 64) : 'unknown',
    modelName: typeof raw.model_name === 'string' ? raw.model_name.slice(0, 128) : 'unknown',
    lineItems: [],
  };

  // Validate line items
  if (Array.isArray(raw.line_items)) {
    sanitized.lineItems = raw.line_items
      .filter((item) => item && typeof item === 'object' && typeof item.description === 'string' && item.description.trim())
      .map((item, idx) => ({
        lineNumber: typeof item.line_number === 'number' ? item.line_number : idx + 1,
        description: item.description.trim().slice(0, 512),
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? Number(item.quantity.toFixed(3)) : 1.0,
        unitPrice: parseDecimal(item.unit_price),
        totalPrice: parseDecimal(item.total_price),
      }));
  }

  // Automatic flagging if core fields are missing
  if (!sanitized.receiptDate && !sanitized.reviewReasons.includes('Missing receipt date')) {
    sanitized.reviewReasons.push('Missing receipt date');
    sanitized.isFlaggedForReview = true;
  }
  if (sanitized.totalAmount === null && !sanitized.reviewReasons.includes('Missing total amount')) {
    sanitized.reviewReasons.push('Missing total amount');
    sanitized.isFlaggedForReview = true;
  }
  if (!sanitized.merchantName && !sanitized.reviewReasons.includes('Missing merchant name')) {
    sanitized.reviewReasons.push('Missing merchant name');
    sanitized.isFlaggedForReview = true;
  }

  return {
    valid: true,
    data: sanitized,
  };
}

module.exports = {
  validateAndSanitizeAiOutput,
  ALLOWED_CATEGORIES,
};
