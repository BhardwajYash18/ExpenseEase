const AccountingIntegrationAdapter = require('./accountingIntegrationAdapter');

/**
 * QuickBooks Integration Adapter (Checkpoint 9)
 *
 * Implements the integration boundary for QuickBooks Online JournalEntry format
 * (PRD FR-11.2; AGENTS.md Sec 14, 18, 28).
 *
 * Boundaries:
 * - Consumes finalized CP8 Journal Entry data strictly.
 * - Deterministically maps to QuickBooks Online JournalEntry entity schema.
 * - Does NOT recalculate debits/credits or mutate accounting data.
 * - Does NOT require real production credentials (mock/integration point boundary).
 */
class QuickBooksAdapter extends AccountingIntegrationAdapter {
  constructor() {
    super('QuickBooks');
  }

  /**
   * Deterministically transform a finalized journal entry into QuickBooks JournalEntry payload.
   *
   * QuickBooks Online API Schema:
   * - DocNumber: Reference identifier (e.g. JE-<id>)
   * - TxnDate: Date of the transaction (YYYY-MM-DD)
   * - PrivateNote: Memo / audit note
   * - Line: Array of JournalEntryLineDetail objects
   *   - Amount: Line amount (positive number)
   *   - DetailType: 'JournalEntryLineDetail'
   *   - JournalEntryLineDetail:
   *     - PostingType: 'Debit' | 'Credit'
   *     - AccountRef: { name: account_identifier }
   *
   * @param {object} journalEntry - Finalized journal entry
   * @returns {object} QuickBooks JournalEntry payload
   */
  transform(journalEntry) {
    const txnDate = journalEntry.finalizedAt
      ? new Date(journalEntry.finalizedAt).toISOString().split('T')[0]
      : new Date(journalEntry.createdAt).toISOString().split('T')[0];

    const lines = (journalEntry.lines || []).map((line, index) => {
      const isDebit = Number(line.debitAmount) > 0;
      const amount = isDebit ? Number(line.debitAmount) : Number(line.creditAmount);
      const postingType = isDebit ? 'Debit' : 'Credit';

      return {
        Id: String(line.lineOrder || index + 1),
        Description: line.description || `ExpensEase Line ${line.lineOrder || index + 1}`,
        Amount: Number(amount.toFixed(2)),
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: {
          PostingType: postingType,
          AccountRef: {
            name: line.account,
            value: line.account.split(' ')[0] || line.account,
          },
        },
      };
    });

    return {
      SyncToken: '1',
      DocNumber: `JE-${journalEntry.id.substring(0, 8).toUpperCase()}`,
      TxnDate: txnDate,
      PrivateNote: `ExpensEase Journal Entry ${journalEntry.id} from Batch ${journalEntry.batchId}`,
      TotalAmt: Number(journalEntry.totalDebit.toFixed(2)),
      Line: lines,
    };
  }
}

module.exports = QuickBooksAdapter;
