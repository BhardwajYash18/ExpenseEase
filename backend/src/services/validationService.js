const { withTenantContext } = require('../config/db');
const { evaluatePolicy } = require('./policy/policyEngine');
const { detectDuplicates } = require('./duplicate/duplicateDetector');
const { computeEffectiveValues } = require('./extractionService');

/**
 * Validation Service (Checkpoint 5)
 *
 * Implements deterministic policy validation and multi-signal duplicate detection.
 * Adheres strictly to AGENTS.md Section 10 & 11:
 * - Policy validation is strictly deterministic.
 * - Operates on deterministic effective values from CP4.
 * - AI data and human-confirmed data provenance are preserved.
 * - Duplicate candidates are tenant-isolated and advisory only (never approve/reject).
 * - RBAC: EMPLOYEE (own receipts only), MANAGER and FINANCE (tenant receipts).
 */

async function getTenantPolicy(client, tenantId) {
  const { rows } = await client.query(
    'SELECT * FROM tenant_policies WHERE tenant_id = $1',
    [tenantId]
  );

  if (rows[0]) {
    return rows[0];
  }

  // Create initial unconfigured tenant policy record if not yet initialized
  const insertSql = `
    INSERT INTO tenant_policies (
      tenant_id, max_amount, require_receipt_above, restricted_categories,
      policy_version, is_active
    ) VALUES ($1, NULL, NULL, '[]'::jsonb, 'v1', TRUE)
    RETURNING *
  `;
  const { rows: inserted } = await client.query(insertSql, [tenantId]);
  return inserted[0];
}

function formatValidationResponse(resultRow, candidateRows = []) {
  if (!resultRow) return null;

  const policyRules = resultRow.policy_rules_result || [];
  const violations = policyRules.filter((r) => r.status === 'FAILED').map((r) => r.message);
  const warnings = policyRules.filter((r) => r.status === 'REVIEW_REQUIRED').map((r) => r.message);

  return {
    id: resultRow.id,
    receiptId: resultRow.receipt_id,
    tenantId: resultRow.tenant_id,
    policy: {
      status: resultRow.validation_status,
      version: resultRow.validation_version,
      rules: policyRules,
      violations,
      warnings,
    },
    duplicate: {
      status: resultRow.duplicate_status,
      score: Number(resultRow.duplicate_score),
      candidates: candidateRows.map((c) => ({
        id: c.id,
        candidateReceiptId: c.candidate_receipt_id,
        similarityScore: Number(c.similarity_score),
        matchingSignals: c.matching_signals,
        detectionMethod: c.detection_method,
        modelVersion: c.model_version,
        createdAt: c.created_at,
      })),
    },
    metadata: {
      validationVersion: resultRow.validation_version,
      validatedAt: resultRow.validated_at,
      createdAt: resultRow.created_at,
    },
  };
}

/**
 * Execute CP5 validation for an authorized receipt.
 */
async function runValidation(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Verify receipt existence and enforce role authorization
    let receiptQuery = 'SELECT id, uploaded_by, ocr_raw_text FROM receipts WHERE id = $1';
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

    // 2. Fetch extraction record to obtain deterministic effective values
    const { rows: extRows } = await client.query(
      'SELECT * FROM receipt_extractions WHERE receipt_id = $1',
      [receiptId]
    );

    if (!extRows[0]) {
      const err = new Error('Extraction not found. Receipt must be extracted before running policy validation.');
      err.status = 400;
      throw err;
    }

    const extraction = extRows[0];
    const effectiveValues = computeEffectiveValues(extraction);

    // 3. Load tenant policy configuration
    const policy = await getTenantPolicy(client, tenantId);

    // 4. Run deterministic policy engine
    const policyResult = evaluatePolicy(effectiveValues, policy, {
      hasReceipt: true,
      evaluatedAt: new Date().toISOString(),
    });

    // 5. Run duplicate detection against other tenant receipts
    let duplicateResult = { status: 'NO_MATCH', score: 0.0, candidates: [] };
    try {
      const otherReceiptsSql = `
        SELECT r.id AS receipt_id, r.ocr_raw_text, e.*
        FROM receipts r
        JOIN receipt_extractions e ON r.id = e.receipt_id
        WHERE r.id != $1
      `;
      const { rows: otherReceipts } = await client.query(otherReceiptsSql, [receiptId]);

      const candidates = otherReceipts.map((row) => ({
        id: row.receipt_id,
        ocrRawText: row.ocr_raw_text || '',
        effectiveValues: computeEffectiveValues(row),
      }));

      const currentReceiptObj = {
        id: receipt.id,
        tenantId,
        ocrRawText: receipt.ocr_raw_text || '',
        effectiveValues,
      };

      duplicateResult = detectDuplicates(currentReceiptObj, candidates);
    } catch (dupErr) {
      console.warn('[Validation] Duplicate detection encountered an issue, recording as unavailable:', dupErr.message);
      duplicateResult = {
        status: 'DETECTION_UNAVAILABLE',
        score: 0.0,
        candidates: [],
      };
    }

    // 6. Delete previous validation results for this receipt (if any) to keep single active validation
    await client.query('DELETE FROM receipt_validation_results WHERE receipt_id = $1', [receiptId]);

    // 7. Persist validation results under RLS
    const insertValSql = `
      INSERT INTO receipt_validation_results (
        receipt_id, tenant_id, validation_status, validation_version,
        policy_rules_result, duplicate_status, duplicate_score, validated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const { rows: valRows } = await client.query(insertValSql, [
      receiptId,
      tenantId,
      policyResult.status,
      policy.policy_version || 'v1',
      JSON.stringify(policyResult.rules),
      duplicateResult.status,
      duplicateResult.score,
    ]);

    const valResult = valRows[0];
    const insertedCandidates = [];

    // 8. Persist duplicate candidates (if any)
    for (const cand of duplicateResult.candidates) {
      const insertCandSql = `
        INSERT INTO receipt_duplicate_candidates (
          validation_result_id, receipt_id, candidate_receipt_id, tenant_id,
          similarity_score, matching_signals, detection_method, model_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      const { rows: cRows } = await client.query(insertCandSql, [
        valResult.id,
        receiptId,
        cand.candidateReceiptId,
        tenantId,
        cand.similarityScore,
        JSON.stringify(cand.matchingSignals),
        cand.detectionMethod || 'multi_signal_heuristics',
        cand.modelVersion || 'v1',
      ]);
      insertedCandidates.push(cRows[0]);
    }

    return formatValidationResponse(valResult, insertedCandidates);
  });
}

/**
 * Retrieve latest validation result for an authorized receipt.
 */
async function getValidation(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
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

    const { rows: valRows } = await client.query(
      'SELECT * FROM receipt_validation_results WHERE receipt_id = $1 ORDER BY validated_at DESC LIMIT 1',
      [receiptId]
    );

    if (!valRows[0]) {
      return null;
    }

    const valResult = valRows[0];
    const { rows: candRows } = await client.query(
      'SELECT * FROM receipt_duplicate_candidates WHERE validation_result_id = $1 ORDER BY similarity_score DESC',
      [valResult.id]
    );

    return formatValidationResponse(valResult, candRows);
  });
}

module.exports = {
  runValidation,
  getValidation,
  getTenantPolicy,
  formatValidationResponse,
};
