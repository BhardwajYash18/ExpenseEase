const { evaluatePolicy } = require('../src/services/policy/policyEngine');
const { parseToCents, compareAmounts, hasExcessivePrecision } = require('../src/services/policy/decimalUtils');

describe('Checkpoint 5 — Deterministic Policy Engine Unit Tests', () => {
  const fixedReferenceDate = '2026-06-01';

  const defaultPolicy = {
    policy_version: 'v1',
    max_amount: 500.00,
    require_receipt_above: 0.00,
    restricted_categories: ['Alcohol', 'Entertainment'],
    max_receipt_age_days: 90,
  };

  const validEffectiveValues = {
    merchantName: 'Acme Supplies',
    receiptDate: '2026-05-15',
    totalAmount: 150.00,
    category: 'Office Supplies',
  };

  describe('1. Decimal-Safe Monetary Arithmetic', () => {
    it('should correctly parse valid amounts to cents', () => {
      expect(parseToCents(12.34)).toEqual({ valid: true, cents: 1234, formatted: '12.34' });
      expect(parseToCents('12.34')).toEqual({ valid: true, cents: 1234, formatted: '12.34' });
      expect(parseToCents('0.05')).toEqual({ valid: true, cents: 5, formatted: '0.05' });
      expect(parseToCents(500)).toEqual({ valid: true, cents: 50000, formatted: '500.00' });
    });

    it('should detect excessive decimal precision', () => {
      expect(hasExcessivePrecision(12.345)).toBe(true);
      expect(hasExcessivePrecision('12.345')).toBe(true);
      expect(hasExcessivePrecision('12.34')).toBe(false);
      expect(parseToCents('12.345').valid).toBe(false);
      expect(parseToCents('12.345').error).toMatch(/Excessive decimal precision/);
    });

    it('should correctly compare decimal amounts without floating point errors', () => {
      // Classic 0.1 + 0.2 float error in JS (0.30000000000000004)
      expect(compareAmounts(500.00, 500.00)).toBe(0);
      expect(compareAmounts(499.99, 500.00)).toBe(-1);
      expect(compareAmounts(500.01, 500.00)).toBe(1);
      expect(compareAmounts('10000.00', '10000.00')).toBe(0);
    });

    it('should handle zero, negative, and malformed amounts', () => {
      expect(parseToCents(0).cents).toBe(0);
      expect(parseToCents(-10.50).cents).toBe(-1050);
      expect(parseToCents('abc').valid).toBe(false);
      expect(parseToCents(null).valid).toBe(false);
      expect(parseToCents(undefined).valid).toBe(false);
    });
  });

  describe('2. Max Amount Policy Rule', () => {
    it('should PASS when amount is strictly below limit', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: 499.99 }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const maxRule = res.rules.find((r) => r.rule === 'MAX_AMOUNT');
      expect(maxRule.status).toBe('PASSED');
      expect(res.status).toBe('PASSED');
    });

    it('should PASS when amount is exactly at limit (boundary condition)', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: 500.00 }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const maxRule = res.rules.find((r) => r.rule === 'MAX_AMOUNT');
      expect(maxRule.status).toBe('PASSED');
      expect(res.status).toBe('PASSED');
    });

    it('should FAIL when amount is above limit by even one cent', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: 500.01 }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const maxRule = res.rules.find((r) => r.rule === 'MAX_AMOUNT');
      expect(maxRule.status).toBe('FAILED');
      expect(res.status).toBe('FAILED');
      expect(res.violations).toContainEqual(expect.stringContaining('exceeds configured maximum amount'));
    });
  });

  describe('3. Amount Validity Rule', () => {
    it('should FAIL for zero amount', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: 0 }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'AMOUNT_VALIDITY');
      expect(rule.status).toBe('FAILED');
      expect(res.status).toBe('FAILED');
    });

    it('should FAIL for negative amount', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: -25.00 }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'AMOUNT_VALIDITY');
      expect(rule.status).toBe('FAILED');
      expect(res.status).toBe('FAILED');
    });

    it('should FAIL for excessive decimal precision', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: '12.345' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'AMOUNT_VALIDITY');
      expect(rule.status).toBe('FAILED');
      expect(res.status).toBe('FAILED');
    });
  });

  describe('4. Required Fields Rule', () => {
    it('should FAIL if merchant is missing or empty', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, merchantName: '' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'REQUIRED_FIELDS');
      expect(rule.status).toBe('FAILED');
      expect(res.violations).toContainEqual(expect.stringContaining('merchant_name'));
    });

    it('should FAIL if date is missing', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, receiptDate: null }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'REQUIRED_FIELDS');
      expect(rule.status).toBe('FAILED');
      expect(res.violations).toContainEqual(expect.stringContaining('receipt_date'));
    });

    it('should FAIL if amount is missing', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, totalAmount: null }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'REQUIRED_FIELDS');
      expect(rule.status).toBe('FAILED');
      expect(res.violations).toContainEqual(expect.stringContaining('total_amount'));
    });
  });

  describe('5. Category Restrictions Rule', () => {
    it('should PASS for approved allowed category', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, category: 'Meals' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RESTRICTED_CATEGORY');
      expect(rule.status).toBe('PASSED');
    });

    it('should FAIL for category restricted by tenant policy', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, category: 'Travel' }, { ...defaultPolicy, restricted_categories: ['Travel'] }, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RESTRICTED_CATEGORY');
      expect(rule.status).toBe('FAILED');
      expect(res.status).toBe('FAILED');
      expect(rule.message).toMatch(/explicitly restricted/);
    });

    it('should FAIL for unknown / unapproved system category', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, category: 'Cryptocurrency' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RESTRICTED_CATEGORY');
      expect(rule.status).toBe('FAILED');
      expect(rule.message).toMatch(/not an approved system expense category/);
    });
  });

  describe('6. Date Validity Rule', () => {
    it('should PASS for recent valid past date', () => {
      // 17 days old relative to reference date 2026-06-01
      const res = evaluatePolicy({ ...validEffectiveValues, receiptDate: '2026-05-15' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RECEIPT_DATE_VALIDITY');
      expect(rule.status).toBe('PASSED');
    });

    it('should FAIL for future receipt date', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, receiptDate: '2026-06-02' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RECEIPT_DATE_VALIDITY');
      expect(rule.status).toBe('FAILED');
      expect(rule.message).toMatch(/cannot be in the future/);
    });

    it('should FAIL for invalid calendar date', () => {
      const res = evaluatePolicy({ ...validEffectiveValues, receiptDate: '2026-02-31' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RECEIPT_DATE_VALIDITY');
      expect(rule.status).toBe('FAILED');
      expect(rule.message).toMatch(/invalid calendar date/);
    });

    it('should PASS for valid past date without invented age limit', () => {
      // 150 days in the past: passes because there is no invented age limit in AGENTS.md/PRD.md
      const res = evaluatePolicy({ ...validEffectiveValues, receiptDate: '2026-01-01' }, defaultPolicy, { referenceDate: fixedReferenceDate });
      const rule = res.rules.find((r) => r.rule === 'RECEIPT_DATE_VALIDITY');
      expect(rule.status).toBe('PASSED');
    });
  });

  describe('7. Determinism Guarantee', () => {
    it('should produce identical results given identical inputs across multiple runs', () => {
      const run1 = evaluatePolicy(validEffectiveValues, defaultPolicy, { referenceDate: fixedReferenceDate, evaluatedAt: '2026-06-01T12:00:00Z' });
      const run2 = evaluatePolicy(validEffectiveValues, defaultPolicy, { referenceDate: fixedReferenceDate, evaluatedAt: '2026-06-01T12:00:00Z' });

      expect(run1).toEqual(run2);
    });
  });
});
