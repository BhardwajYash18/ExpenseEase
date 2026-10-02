/**
 * Decimal Utilities for Authoritative Monetary Arithmetic
 *
 * Prevents floating-point rounding errors by parsing currency values
 * into integer cents (or BigInt) for all comparisons and policy validation.
 */

/**
 * Checks if a monetary value has more than 2 decimal digits.
 * @param {number|string} val
 * @returns {boolean} true if precision is excessive (>2 decimal places)
 */
function hasExcessivePrecision(val) {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  const decimalPart = str.split('.')[1];
  return Boolean(decimalPart && decimalPart.length > 2);
}

/**
 * Converts a monetary amount to integer cents.
 * Handles strings, numbers, nulls, and non-numeric inputs cleanly.
 *
 * @param {number|string|null} val
 * @returns {{ valid: boolean, cents: number|null, formatted: string|null, error?: string }}
 */
function parseToCents(val) {
  if (val === null || val === undefined || val === '') {
    return { valid: false, cents: null, formatted: null, error: 'Amount is missing' };
  }

  const str = String(val).trim();

  // Validate format: optional sign, digits, optional decimal with up to 2 digits
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    return { valid: false, cents: null, formatted: str, error: 'Amount is malformed' };
  }

  if (hasExcessivePrecision(str)) {
    return { valid: false, cents: null, formatted: str, error: 'Excessive decimal precision' };
  }

  const [integerPart, decimalPart = ''] = str.split('.');
  const isNegative = integerPart.startsWith('-');
  const absInteger = isNegative ? integerPart.slice(1) : integerPart;
  const paddedDecimal = (decimalPart + '00').slice(0, 2);

  const rawCents = parseInt(absInteger, 10) * 100 + parseInt(paddedDecimal, 10);
  const cents = isNegative ? -rawCents : rawCents;

  const formatted = `${isNegative ? '-' : ''}${absInteger}.${paddedDecimal}`;
  return { valid: true, cents, formatted };
}

/**
 * Compares two amounts decimal-safely.
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 *
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
function compareAmounts(a, b) {
  const parsedA = parseToCents(a);
  const parsedB = parseToCents(b);

  if (!parsedA.valid || !parsedB.valid) {
    throw new Error(`Cannot compare invalid amounts: '${a}' vs '${b}'`);
  }

  if (parsedA.cents < parsedB.cents) return -1;
  if (parsedA.cents > parsedB.cents) return 1;
  return 0;
}

module.exports = {
  hasExcessivePrecision,
  parseToCents,
  compareAmounts,
};
