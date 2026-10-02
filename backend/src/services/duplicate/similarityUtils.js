const { parseToCents } = require('../policy/decimalUtils');

/**
 * Text, Token, and Numeric Similarity Utilities for Duplicate Detection
 *
 * Implements AGENTS.md Section 11 & PRD.md FR-07:
 * Signals: Merchant similarity, date proximity, amount equivalence, OCR text similarity.
 */

/**
 * Normalizes text and extracts word tokens (alphanumeric words only).
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return new Set();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return new Set(words);
}

/**
 * Calculates Jaccard similarity coefficient between two texts.
 * |A ∩ B| / |A ∪ B|
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} between 0.0 and 1.0
 */
function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 0.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize > 0 ? Number((intersectionCount / unionSize).toFixed(2)) : 0.0;
}

/**
 * Calculates string similarity using normalized character bigrams (Dice coefficient).
 * @param {string} strA
 * @param {string} strB
 * @returns {number} between 0.0 and 1.0
 */
function stringSimilarity(strA, strB) {
  if (!strA || !strB) return 0.0;
  const s1 = String(strA).trim().toLowerCase();
  const s2 = String(strB).trim().toLowerCase();

  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 1.0 : 0.0;
  }

  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substr(i, 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substr(i, 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      matches++;
    }
  }

  const totalBigrams = s1.length - 1 + s2.length - 1;
  return totalBigrams > 0 ? Number(((2.0 * matches) / totalBigrams).toFixed(2)) : 0.0;
}

/**
 * Compares two monetary amounts decimal-safely.
 * @param {number|string} amountA
 * @param {number|string} amountB
 * @returns {number} 1.0 for exact match, 0.8 for within 1%, 0.5 for within 5%, 0.0 otherwise
 */
function amountSimilarity(amountA, amountB) {
  const parsedA = parseToCents(amountA);
  const parsedB = parseToCents(amountB);

  if (!parsedA.valid || !parsedB.valid) return 0.0;
  if (parsedA.cents === parsedB.cents) return 1.0;

  const diff = Math.abs(parsedA.cents - parsedB.cents);
  const base = Math.max(Math.abs(parsedA.cents), Math.abs(parsedB.cents));
  if (base === 0) return 0.0;

  const ratio = diff / base;
  if (ratio <= 0.01) return 0.8;
  if (ratio <= 0.05) return 0.5;
  return 0.0;
}

/**
 * Calculates date proximity similarity.
 * @param {string} dateA - 'YYYY-MM-DD'
 * @param {string} dateB - 'YYYY-MM-DD'
 * @returns {number} 1.0 (same day), 0.8 (±1 day), 0.5 (±3 days), 0.2 (±7 days), 0.0 otherwise
 */
function dateSimilarity(dateA, dateB) {
  if (!dateA || !dateB) return 0.0;
  if (dateA === dateB) return 1.0;

  const d1 = new Date(dateA + 'T00:00:00Z');
  const d2 = new Date(dateB + 'T00:00:00Z');

  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0.0;

  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 1.0;
  if (diffDays === 1) return 0.8;
  if (diffDays <= 3) return 0.5;
  if (diffDays <= 7) return 0.2;
  return 0.0;
}

module.exports = {
  tokenize,
  jaccardSimilarity,
  stringSimilarity,
  amountSimilarity,
  dateSimilarity,
};
