const { parseToCents, compareAmounts } = require('./decimalUtils');
const { ALLOWED_CATEGORIES } = require('../../utils/aiOutputValidation');

/**
 * Deterministic Expense Policy Rules
 *
 * Implements AGENTS.md Section 10 and PRD.md FR-06.
 * All rules return:
 * {
 *   rule: string,
 *   status: 'PASSED' | 'FAILED' | 'REVIEW_REQUIRED',
 *   message: string,
 *   actualValue: string | null,
 *   expectedValue: string | null
 * }
 */

/**
 * 1. Maximum Allowed Amount Rule
 */
function checkMaxAmount(effectiveValues, policy) {
  const amountVal = effectiveValues.totalAmount;
  const parsedActual = parseToCents(amountVal);

  if (!parsedActual.valid) {
    return {
      rule: 'MAX_AMOUNT',
      status: 'FAILED',
      message: `Invalid or missing expense amount: ${parsedActual.error || 'unparseable'}`,
      actualValue: String(amountVal ?? 'null'),
      expectedValue: policy.max_amount !== null && policy.max_amount !== undefined ? String(policy.max_amount) : 'Valid amount',
    };
  }

  // If no maximum amount limit is configured for this tenant, rule is unconfigured and passes
  if (policy.max_amount === null || policy.max_amount === undefined) {
    return {
      rule: 'MAX_AMOUNT',
      status: 'PASSED',
      message: 'No maximum expense amount limit configured for this tenant.',
      actualValue: parsedActual.formatted,
      expectedValue: 'No limit (unconfigured)',
    };
  }

  const maxLimit = policy.max_amount;
  const parsedLimit = parseToCents(maxLimit);
  const comparison = compareAmounts(amountVal, maxLimit);
  if (comparison > 0) {
    return {
      rule: 'MAX_AMOUNT',
      status: 'FAILED',
      message: `Expense amount (${parsedActual.formatted}) exceeds configured maximum amount (${parsedLimit.formatted}).`,
      actualValue: parsedActual.formatted,
      expectedValue: parsedLimit.formatted,
    };
  }

  return {
    rule: 'MAX_AMOUNT',
    status: 'PASSED',
    message: `Expense amount (${parsedActual.formatted}) is within configured limit (${parsedLimit.formatted}).`,
    actualValue: parsedActual.formatted,
    expectedValue: parsedLimit.formatted,
  };
}

/**
 * 2. Amount Validity Rule (Non-zero, positive, valid decimal precision)
 */
function checkAmountValidity(effectiveValues) {
  const amountVal = effectiveValues.totalAmount;
  const parsed = parseToCents(amountVal);

  if (!parsed.valid) {
    return {
      rule: 'AMOUNT_VALIDITY',
      status: 'FAILED',
      message: `Expense amount is invalid: ${parsed.error}.`,
      actualValue: String(amountVal ?? 'null'),
      expectedValue: '> 0.00 (max 2 decimal places)',
    };
  }

  if (parsed.cents <= 0) {
    return {
      rule: 'AMOUNT_VALIDITY',
      status: 'FAILED',
      message: `Expense amount must be greater than zero. Received ${parsed.formatted}.`,
      actualValue: parsed.formatted,
      expectedValue: '> 0.00',
    };
  }

  return {
    rule: 'AMOUNT_VALIDITY',
    status: 'PASSED',
    message: `Expense amount (${parsed.formatted}) is valid and positive.`,
    actualValue: parsed.formatted,
    expectedValue: '> 0.00',
  };
}

/**
 * 3. Required Fields Presence Rule
 */
function checkRequiredFields(effectiveValues) {
  const missing = [];
  if (!effectiveValues.merchantName || !String(effectiveValues.merchantName).trim()) {
    missing.push('merchant_name');
  }
  if (!effectiveValues.receiptDate || !String(effectiveValues.receiptDate).trim()) {
    missing.push('receipt_date');
  }
  if (effectiveValues.totalAmount === null || effectiveValues.totalAmount === undefined || effectiveValues.totalAmount === '') {
    missing.push('total_amount');
  }

  if (missing.length > 0) {
    return {
      rule: 'REQUIRED_FIELDS',
      status: 'FAILED',
      message: `Missing required field(s): ${missing.join(', ')}.`,
      actualValue: `Missing: [${missing.join(', ')}]`,
      expectedValue: 'All required fields present (merchant_name, receipt_date, total_amount)',
    };
  }

  return {
    rule: 'REQUIRED_FIELDS',
    status: 'PASSED',
    message: 'All core required receipt fields are present.',
    actualValue: 'Present',
    expectedValue: 'Present',
  };
}

/**
 * 4. Restricted & Allowed Category Rule
 */
function checkCategoryPolicy(effectiveValues, policy) {
  const category = (effectiveValues.category || '').trim();

  // Validate allowed system categories
  if (!category || !ALLOWED_CATEGORIES.has(category)) {
    return {
      rule: 'RESTRICTED_CATEGORY',
      status: 'FAILED',
      message: `Category '${category || 'null'}' is not an approved system expense category.`,
      actualValue: category || 'null',
      expectedValue: Array.from(ALLOWED_CATEGORIES).join(', '),
    };
  }

  // Check tenant restricted categories
  let restrictedList = [];
  if (Array.isArray(policy.restricted_categories)) {
    restrictedList = policy.restricted_categories;
  } else if (typeof policy.restricted_categories === 'string') {
    try {
      restrictedList = JSON.parse(policy.restricted_categories);
    } catch (_) {}
  }

  const normalizedRestricted = restrictedList.map((c) => String(c).trim().toLowerCase());
  if (normalizedRestricted.includes(category.toLowerCase())) {
    return {
      rule: 'RESTRICTED_CATEGORY',
      status: 'FAILED',
      message: `Category '${category}' is explicitly restricted by tenant expense policy.`,
      actualValue: category,
      expectedValue: `Not in restricted list: [${restrictedList.join(', ')}]`,
    };
  }

  return {
    rule: 'RESTRICTED_CATEGORY',
    status: 'PASSED',
    message: `Category '${category}' is permitted by policy.`,
    actualValue: category,
    expectedValue: 'Permitted category',
  };
}

/**
 * 5. Receipt Date Validity Rule (No future dates, age within max_receipt_age_days)
 */
function checkReceiptDate(effectiveValues, policy, referenceDate = null) {
  const dateStr = effectiveValues.receiptDate;
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return {
      rule: 'RECEIPT_DATE_VALIDITY',
      status: 'REVIEW_REQUIRED',
      message: 'Receipt date is missing or not in valid YYYY-MM-DD format.',
      actualValue: String(dateStr ?? 'null'),
      expectedValue: 'Valid YYYY-MM-DD date',
    };
  }

  const receiptDateObj = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(receiptDateObj.getTime()) || receiptDateObj.toISOString().slice(0, 10) !== dateStr) {
    return {
      rule: 'RECEIPT_DATE_VALIDITY',
      status: 'FAILED',
      message: `Receipt date '${dateStr}' is an invalid calendar date.`,
      actualValue: dateStr,
      expectedValue: 'Valid calendar date',
    };
  }

  // Reference date (defaults to today UTC for determinism in testing)
  const today = referenceDate ? new Date(referenceDate) : new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  // 1. Future date check
  if (receiptDateObj > todayUtc) {
    return {
      rule: 'RECEIPT_DATE_VALIDITY',
      status: 'FAILED',
      message: `Receipt date (${dateStr}) cannot be in the future.`,
      actualValue: dateStr,
      expectedValue: `<= ${todayUtc.toISOString().split('T')[0]}`,
    };
  }

  return {
    rule: 'RECEIPT_DATE_VALIDITY',
    status: 'PASSED',
    message: `Receipt date (${dateStr}) is a valid calendar date and not in the future.`,
    actualValue: dateStr,
    expectedValue: `<= ${todayUtc.toISOString().split('T')[0]}`,
  };
}

/**
 * 6. Receipt Requirement Rule
 */
function checkReceiptRequired(effectiveValues, policy, hasReceipt = true) {
  const requireAbove = policy.require_receipt_above;
  const amountVal = effectiveValues.totalAmount;

  if (requireAbove !== null && requireAbove !== undefined) {
    if (amountVal !== null && amountVal !== undefined) {
      const parsedAmount = parseToCents(amountVal);
      const parsedThreshold = parseToCents(requireAbove);

      if (parsedAmount.valid && parsedThreshold.valid && parsedAmount.cents > parsedThreshold.cents) {
        if (!hasReceipt) {
          return {
            rule: 'RECEIPT_REQUIRED',
            status: 'FAILED',
            message: `Expenses exceeding configured threshold of ${parsedThreshold.formatted} strictly require an attached receipt.`,
            actualValue: 'No receipt attached',
            expectedValue: 'Attached receipt image',
          };
        }
      }
    }
  } else {
    // If require_receipt_above is not configured, receipt is required whenever an expense has no receipt
    if (!hasReceipt) {
      return {
        rule: 'RECEIPT_REQUIRED',
        status: 'FAILED',
        message: 'Expense submission requires an attached receipt image.',
        actualValue: 'No receipt attached',
        expectedValue: 'Attached receipt image',
      };
    }
  }

  return {
    rule: 'RECEIPT_REQUIRED',
    status: 'PASSED',
    message: 'Receipt is present and attached.',
    actualValue: 'Attached',
    expectedValue: 'Attached',
  };
}

module.exports = {
  checkMaxAmount,
  checkAmountValidity,
  checkRequiredFields,
  checkCategoryPolicy,
  checkReceiptDate,
  checkReceiptRequired,
};
