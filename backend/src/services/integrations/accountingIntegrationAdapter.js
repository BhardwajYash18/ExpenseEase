/**
 * Base Accounting Integration Adapter (Checkpoint 9)
 *
 * Provides a clean provider boundary / adapter abstraction for external
 * accounting integrations (PRD FR-11.2, FR-11.3; AGENTS.md Sec 18, 28).
 *
 * Rules & Boundaries:
 * - Consumes finalized CP8 Journal Entry data strictly.
 * - Does NOT recalculate accounting or decide debits/credits.
 * - Does NOT mutate Journal Entries, Finance Batches, or receipts.
 * - Does NOT perform banking, payment settlements, or payouts.
 * - Fails safely if journal entry is unfinalized or imbalanced.
 */

class AccountingIntegrationAdapter {
  constructor(providerName) {
    if (!providerName) {
      throw new Error('Adapter must specify a providerName');
    }
    this.providerName = providerName;
  }

  /**
   * Validate that the journal entry is eligible for integration.
   * Must be strictly FINALIZED and balanced.
   *
   * @param {object} journalEntry - Finalized journal entry object
   */
  validate(journalEntry) {
    if (!journalEntry || typeof journalEntry !== 'object') {
      const error = new Error('Invalid journal entry data provided');
      error.status = 400;
      throw error;
    }

    if (journalEntry.status !== 'FINALIZED') {
      const error = new Error(
        `Cannot export unfinalized journal entry to ${this.providerName}. Status is '${journalEntry.status}'. Finalize the journal entry before export.`
      );
      error.status = 400;
      throw error;
    }

    if (!journalEntry.lines || !Array.isArray(journalEntry.lines) || journalEntry.lines.length === 0) {
      const error = new Error(`Cannot export journal entry without lines to ${this.providerName}`);
      error.status = 400;
      throw error;
    }

    if (journalEntry.totalDebit !== journalEntry.totalCredit || journalEntry.totalDebit <= 0) {
      const error = new Error(
        `Cannot export imbalanced journal entry to ${this.providerName}. Total debits ($${journalEntry.totalDebit}) must equal total credits ($${journalEntry.totalCredit}).`
      );
      error.status = 400;
      throw error;
    }
  }

  /**
   * Transform the CP8 journal entry into the provider-specific payload format.
   * Must be implemented by concrete provider subclasses.
   *
   * @param {object} journalEntry - Finalized journal entry
   * @returns {object} Provider-specific payload
   */
  transform(journalEntry) {
    throw new Error(`transform() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Execute the integration point transformation and validate readiness.
   *
   * @param {object} journalEntry - Finalized journal entry
   * @returns {object} Integration result
   */
  execute(journalEntry) {
    this.validate(journalEntry);
    const payload = this.transform(journalEntry);

    return {
      success: true,
      provider: this.providerName,
      status: 'INTEGRATION_POINT_READY',
      journalEntryId: journalEntry.id,
      batchId: journalEntry.batchId,
      totalAmount: journalEntry.totalDebit,
      lineCount: journalEntry.lines.length,
      payload,
      message: `${this.providerName} integration point ready. Payload transformed deterministically from finalized journal entry.`,
    };
  }
}

module.exports = AccountingIntegrationAdapter;
