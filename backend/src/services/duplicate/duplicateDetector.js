const {
  stringSimilarity,
  amountSimilarity,
  dateSimilarity,
  jaccardSimilarity,
} = require('./similarityUtils');

/**
 * Multi-Signal Duplicate Detection Engine
 *
 * Implements AGENTS.md Section 11 & PRD.md FR-07:
 * - Detects potential duplicate expenses using multi-signal similarity analysis.
 * - Signals: Merchant, transaction date, total amount, receipt text, receipt number.
 * - Duplicate candidates are advisory and review-oriented; never independently approve or reject an expense.
 * - Cross-tenant comparison is strictly prohibited; self is strictly excluded.
 */

function detectDuplicates(currentReceipt, candidateReceipts = []) {
  if (!currentReceipt || !currentReceipt.id) {
    throw new Error('Current receipt with valid ID is required for duplicate detection');
  }

  const currentEff = currentReceipt.effectiveValues || {};
  const currentOcr = currentReceipt.ocrRawText || '';
  const currentMerchant = currentEff.merchantName || '';
  const currentDate = currentEff.receiptDate || '';
  const currentAmount = currentEff.totalAmount;
  const currentRcptNum = currentEff.receiptNumber || '';

  const candidates = [];

  for (const candidate of candidateReceipts) {
    // 1. Strict self-exclusion
    if (candidate.id === currentReceipt.id) {
      continue;
    }

    const candEff = candidate.effectiveValues || {};
    const candOcr = candidate.ocrRawText || '';
    const candMerchant = candEff.merchantName || '';
    const candDate = candEff.receiptDate || '';
    const candAmount = candEff.totalAmount;
    const candRcptNum = candEff.receiptNumber || '';

    // Calculate component similarities
    const merchantSim = stringSimilarity(currentMerchant, candMerchant);
    const amountSim = amountSimilarity(currentAmount, candAmount);
    const dateSim = dateSimilarity(currentDate, candDate);
    const textSim = jaccardSimilarity(currentOcr, candOcr);

    const isExactAmount = amountSim === 1.0;
    const isSameDate = dateSim === 1.0;
    const isSameRcptNum = Boolean(
      currentRcptNum &&
      candRcptNum &&
      currentRcptNum.trim().toLowerCase() === candRcptNum.trim().toLowerCase()
    );

    let compositeScore = 0.0;

    // Rule A: Identical receipt number + matching merchant -> near certain duplicate
    if (isSameRcptNum && merchantSim >= 0.70) {
      compositeScore = 0.98;
    }
    // Rule B: Identical amount + identical date + high merchant similarity -> high probability duplicate
    else if (isExactAmount && isSameDate && merchantSim >= 0.80) {
      compositeScore = 0.95;
    }
    // Rule C: Identical amount + identical date + identical OCR text -> high probability
    else if (isExactAmount && isSameDate && textSim >= 0.75) {
      compositeScore = 0.92;
    }
    // Rule D: Weighted composite score
    else {
      compositeScore = Number(
        (0.35 * amountSim + 0.25 * merchantSim + 0.25 * dateSim + 0.15 * textSim).toFixed(2)
      );
    }

    // Include candidate if similarity meets minimum threshold (>= 0.60)
    if (compositeScore >= 0.60) {
      candidates.push({
        candidateReceiptId: candidate.id,
        similarityScore: compositeScore,
        detectionMethod: 'multi_signal_heuristics',
        modelVersion: 'v1',
        matchingSignals: {
          merchantSimilarity: merchantSim,
          amountSimilarity: amountSim,
          dateSimilarity: dateSim,
          textSimilarity: textSim,
          isExactAmount,
          isSameDate,
          isSameReceiptNumber: isSameRcptNum,
        },
      });
    }
  }

  // Sort descending by similarity score
  candidates.sort((a, b) => b.similarityScore - a.similarityScore);

  const highestScore = candidates.length > 0 ? candidates[0].similarityScore : 0.0;

  let duplicateStatus = 'NO_MATCH';
  if (highestScore >= 0.85) {
    duplicateStatus = 'HIGH_SIMILARITY';
  } else if (highestScore >= 0.65) {
    duplicateStatus = 'POSSIBLE_DUPLICATE';
  }

  return {
    status: duplicateStatus,
    score: highestScore,
    candidates,
  };
}

module.exports = {
  detectDuplicates,
};
