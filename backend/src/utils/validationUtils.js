/**
 * Input validation utilities for UUIDs and request parameters.
 * Checkpoint 10 — Security Hardening
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks whether a given value is a valid canonical UUID string.
 * @param {any} val
 * @returns {boolean}
 */
function isValidUuid(val) {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

/**
 * Express router parameter validation middleware factory for UUID parameters.
 * Rejects malformed UUIDs with HTTP 400 Bad Request before database queries execute.
 *
 * @param {string} paramName
 * @returns {import('express').RequestParamHandler}
 */
function validateUuidParam(paramName) {
  return (req, res, next, val) => {
    if (!isValidUuid(val)) {
      return res.status(400).json({
        error: { message: `Invalid identifier syntax: parameter '${paramName}' must be a valid UUID` },
      });
    }
    next();
  };
}

module.exports = {
  isValidUuid,
  validateUuidParam,
  UUID_REGEX,
};
