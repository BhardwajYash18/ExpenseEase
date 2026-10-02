const { detectDuplicates } = require('../src/services/duplicate/duplicateDetector');
const {
  tokenize,
  jaccardSimilarity,
  stringSimilarity,
  amountSimilarity,
  dateSimilarity,
} = require('../src/services/duplicate/similarityUtils');

describe('Checkpoint 5 — Multi-Signal Duplicate Detection Unit Tests', () => {
  const currentReceipt = {
    id: 'receipt-1111-1111',
    tenantId: 'tenant-aaaa',
    ocrRawText: 'STARBUCKS STORE #10423\nDate: 2026-05-12\nTotal: $14.50\nThank you for your visit!',
    effectiveValues: {
      merchantName: 'STARBUCKS STORE #10423',
      receiptDate: '2026-05-12',
      totalAmount: 14.50,
      receiptNumber: 'SB-9912',
      category: 'Meals',
    },
  };

  describe('1. Similarity Utilities', () => {
    it('tokenize should return set of alphanumeric words', () => {
      const tokens = tokenize('Coffee & Bakery, Total: $14.50');
      expect(tokens.has('coffee')).toBe(true);
      expect(tokens.has('bakery')).toBe(true);
      expect(tokens.has('total')).toBe(true);
      expect(tokens.has('14')).toBe(true);
      expect(tokens.has('50')).toBe(true);
    });

    it('jaccardSimilarity should compute word overlap accurately', () => {
      const simExact = jaccardSimilarity('Starbucks Coffee Seattle', 'Starbucks Coffee Seattle');
      expect(simExact).toBe(1.0);

      const simPartial = jaccardSimilarity('Starbucks Coffee Seattle', 'Starbucks Coffee Portland');
      expect(simPartial).toBeGreaterThan(0.4);
      expect(simPartial).toBeLessThan(1.0);

      const simNone = jaccardSimilarity('Apple Laptop Store', 'Shell Gas Station');
      expect(simNone).toBe(0.0);
    });

    it('stringSimilarity should compute Dice bigram similarity', () => {
      expect(stringSimilarity('Starbucks', 'Starbucks')).toBe(1.0);
      expect(stringSimilarity('Starbucks Coffee', 'Starbucks Coffe')).toBeGreaterThan(0.85);
      expect(stringSimilarity('Delta Airlines', 'Uber Technologies')).toBeLessThan(0.3);
    });

    it('amountSimilarity should score exact and close amounts', () => {
      expect(amountSimilarity(14.50, 14.50)).toBe(1.0);
      expect(amountSimilarity(100.00, 100.50)).toBe(0.8); // within 1%
      expect(amountSimilarity(100.00, 104.00)).toBe(0.5); // within 5%
      expect(amountSimilarity(100.00, 150.00)).toBe(0.0); // > 5%
    });

    it('dateSimilarity should score based on proximity', () => {
      expect(dateSimilarity('2026-05-12', '2026-05-12')).toBe(1.0);
      expect(dateSimilarity('2026-05-12', '2026-05-13')).toBe(0.8); // 1 day
      expect(dateSimilarity('2026-05-12', '2026-05-15')).toBe(0.5); // 3 days
      expect(dateSimilarity('2026-05-12', '2026-05-19')).toBe(0.2); // 7 days
      expect(dateSimilarity('2026-05-12', '2026-06-12')).toBe(0.0); // 31 days
    });
  });

  describe('2. Multi-Signal Duplicate Detection Logic', () => {
    it('should detect HIGH_SIMILARITY for exact duplicate receipt uploaded previously', () => {
      const candidates = [
        {
          id: 'receipt-2222-2222',
          ocrRawText: 'STARBUCKS STORE #10423\nDate: 2026-05-12\nTotal: $14.50\nThank you for your visit!',
          effectiveValues: {
            merchantName: 'STARBUCKS STORE #10423',
            receiptDate: '2026-05-12',
            totalAmount: 14.50,
            receiptNumber: 'SB-9912',
            category: 'Meals',
          },
        },
      ];

      const result = detectDuplicates(currentReceipt, candidates);

      expect(result.status).toBe('HIGH_SIMILARITY');
      expect(result.score).toBeGreaterThanOrEqual(0.85);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].candidateReceiptId).toBe('receipt-2222-2222');
      expect(result.candidates[0].matchingSignals.isExactAmount).toBe(true);
      expect(result.candidates[0].matchingSignals.isSameDate).toBe(true);
      expect(result.candidates[0].matchingSignals.isSameReceiptNumber).toBe(true);
    });

    it('should detect POSSIBLE_DUPLICATE for similar receipt (same merchant, within 3 days, same amount)', () => {
      const candidates = [
        {
          id: 'receipt-3333-3333',
          ocrRawText: 'STARBUCKS STORE #10423\nDate: 2026-05-15\nTotal: $14.50',
          effectiveValues: {
            merchantName: 'STARBUCKS STORE #10423',
            receiptDate: '2026-05-15', // 3 days difference (dateSim = 0.5)
            totalAmount: 14.50,
            receiptNumber: null,
            category: 'Meals',
          },
        },
      ];

      const result = detectDuplicates(currentReceipt, candidates);

      expect(result.status).toBe('POSSIBLE_DUPLICATE');
      expect(result.score).toBeGreaterThanOrEqual(0.65);
      expect(result.score).toBeLessThan(0.85);
      expect(result.candidates).toHaveLength(1);
    });

    it('should return NO_MATCH for completely unrelated receipts', () => {
      const candidates = [
        {
          id: 'receipt-4444-4444',
          ocrRawText: 'DELTA AIRLINES TICKET\nDate: 2026-01-20\nTotal: $450.00',
          effectiveValues: {
            merchantName: 'DELTA AIRLINES',
            receiptDate: '2026-01-20',
            totalAmount: 450.00,
            category: 'Travel',
          },
        },
      ];

      const result = detectDuplicates(currentReceipt, candidates);

      expect(result.status).toBe('NO_MATCH');
      expect(result.score).toBe(0.0);
      expect(result.candidates).toHaveLength(0);
    });

    it('should strictly exclude current receipt from candidate list (self-exclusion)', () => {
      const candidates = [
        {
          id: currentReceipt.id, // Current receipt itself
          ocrRawText: currentReceipt.ocrRawText,
          effectiveValues: currentReceipt.effectiveValues,
        },
      ];

      const result = detectDuplicates(currentReceipt, candidates);

      expect(result.status).toBe('NO_MATCH');
      expect(result.candidates).toHaveLength(0);
    });
  });
});
