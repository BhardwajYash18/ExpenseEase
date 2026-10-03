const AccountingIntegrationAdapter = require('./accountingIntegrationAdapter');

/**
 * Xero Integration Adapter (Checkpoint 9)
 *
 * Implements the integration boundary for Xero ManualJournals format
 * (PRD FR-11.3; AGENTS.md Sec 16, 18, 28).
 *
 * Boundaries:
 * - Consumes finalized CP8 Journal Entry data strictly.
 * - Deterministically maps to Xero ManualJournals entity schema.
 * - In Xero ManualJournals: Debits are positive amounts, Credits are negative amounts.
 * - Does NOT recalculate debits/credits or mutate accounting data.
 * - Does NOT require real production credentials (mock/integration point boundary).
 */
class XeroAdapter extends AccountingIntegrationAdapter {
  constructor() {
    super('Xero');
  }

  /**
   * Deterministically transform a finalized journal entry into Xero ManualJournal payload.
   *
   * Xero API Schema (ManualJournals):
   * - Narration: Journal description / reference
   * - Date: Date of journal (YYYY-MM-DD)
   * - Status: 'POSTED'
   * - LineAmountTypes: 'NoTax'
   * - JournalLines: Array of line objects
   *   - LineAmount: Positive for Debit, Negative for Credit
   *   - AccountCode: Nominal account code
   *   - Description: Line memo
   *   - TaxType: 'NONE'
   *
   * @param {object} journalEntry - Finalized journal entry
   * @returns {object} Xero ManualJournal payload
   */
  transform(journalEntry) {
    const journalDate = journalEntry.finalizedAt
      ? new Date(journalEntry.finalizedAt).toISOString().split('T')[0]
      : new Date(journalEntry.createdAt).toISOString().split('T')[0];

    const journalLines = (journalEntry.lines || []).map((line, index) => {
      const isDebit = Number(line.debitAmount) > 0;
      const amount = isDebit ? Number(line.debitAmount) : -Number(line.creditAmount);
      // Extract account code if format is "6000 - Meals" -> "6000", else full name
      const accountCode = line.account.split(' ')[0] || line.account;

      return {
        LineAmount: Number(amount.toFixed(2)),
        AccountCode: accountCode,
        AccountName: line.account,
        Description: line.description || `ExpensEase Line ${line.lineOrder || index + 1}`,
        TaxType: 'NONE',
      };
    });

    return {
      ManualJournalID: `XERO-JE-${journalEntry.id.substring(0, 8).toUpperCase()}`,
      Narration: `ExpensEase Journal Entry ${journalEntry.id} (Batch ${journalEntry.batchId})`,
      Date: journalDate,
      Status: 'POSTED',
      LineAmountTypes: 'NoTax',
      JournalLines: journalLines,
    };
  }
}

module.exports = XeroAdapter;
