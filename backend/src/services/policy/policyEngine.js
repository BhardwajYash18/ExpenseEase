const policyRules = require('./policyRules');

/**
 * Deterministic Expense Policy Engine
 *
 * Implements AGENTS.md Section 10:
 * "Policy validation must primarily be deterministic.
 * Do NOT use an LLM as the final policy decision-maker.
 * The same inputs must produce the same result."
 */

function evaluatePolicy(effectiveValues, policyConfig = {}, options = {}) {
  const policyVersion = policyConfig.policy_version || 'v1';
  const referenceDate = options.referenceDate || null;
  const hasReceipt = options.hasReceipt !== undefined ? options.hasReceipt : true;

  const rules = [
    policyRules.checkAmountValidity(effectiveValues),
    policyRules.checkMaxAmount(effectiveValues, policyConfig),
    policyRules.checkRequiredFields(effectiveValues),
    policyRules.checkCategoryPolicy(effectiveValues, policyConfig),
    policyRules.checkReceiptDate(effectiveValues, policyConfig, referenceDate),
    policyRules.checkReceiptRequired(effectiveValues, policyConfig, hasReceipt),
  ];

  const failedRules = rules.filter((r) => r.status === 'FAILED');
  const reviewRules = rules.filter((r) => r.status === 'REVIEW_REQUIRED');

  let overallStatus = 'PASSED';
  if (failedRules.length > 0) {
    overallStatus = 'FAILED';
  } else if (reviewRules.length > 0) {
    overallStatus = 'REVIEW_REQUIRED';
  }

  const violations = failedRules.map((r) => r.message);
  const warnings = reviewRules.map((r) => r.message);

  return {
    status: overallStatus,
    policyVersion,
    rules,
    violations,
    warnings,
    evaluatedAt: options.evaluatedAt || new Date().toISOString(),
  };
}

module.exports = {
  evaluatePolicy,
};
