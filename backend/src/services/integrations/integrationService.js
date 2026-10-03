const { withTenantContext } = require('../../config/db');
const journalEntryService = require('../journalEntryService');
const QuickBooksAdapter = require('./quickBooksAdapter');
const XeroAdapter = require('./xeroAdapter');

/**
 * Accounting Integration Orchestrator Service (Checkpoint 9)
 *
 * Coordinates external accounting integration points (QuickBooks & Xero)
 * adhering strictly to AGENTS.md (Sections 6, 12, 13, 14, 15, 17, 18, 28)
 * and docs/PRD.md (FR-11.2, FR-11.3, FR-11.4, FR-12.2).
 *
 * Core Boundaries:
 * - Operates exclusively on FINALIZED CP8 Journal Entries.
 * - Does NOT recalculate accounting or mutate accounting records.
 * - Does NOT require real production credentials (integration point/adapter boundary).
 * - Records append-only audit log in export_audit_logs.
 * - Fully isolated by tenant context and PostgreSQL RLS.
 */
class IntegrationService {
  constructor() {
    this.adapters = {
      quickbooks: new QuickBooksAdapter(),
      xero: new XeroAdapter(),
    };
  }

  /**
   * Get supported integration providers and their status.
   *
   * @returns {Array<object>} List of integration providers
   */
  getAvailableProviders() {
    return [
      {
        id: 'quickbooks',
        name: 'QuickBooks Online',
        type: 'QUICKBOOKS',
        status: 'INTEGRATION_POINT_READY',
        description: 'Transforms finalized double-entry journal entries into QuickBooks Online JournalEntry format.',
        liveCredentialsConfigured: false,
      },
      {
        id: 'xero',
        name: 'Xero',
        type: 'XERO',
        status: 'INTEGRATION_POINT_READY',
        description: 'Transforms finalized double-entry journal entries into Xero ManualJournals format.',
        liveCredentialsConfigured: false,
      },
    ];
  }

  /**
   * Execute an accounting integration for a finalized journal entry.
   *
   * @param {string} tenantId - Tenant UUID
   * @param {string} userId - User UUID (Finance)
   * @param {string} userRole - User role ('FINANCE')
   * @param {string} providerKey - 'quickbooks' | 'xero'
   * @param {string} journalEntryId - Journal entry UUID
   * @returns {Promise<object>} Integration result payload
   */
  async executeIntegration(tenantId, userId, userRole, providerKey, journalEntryId) {
    if (userRole !== 'FINANCE') {
      const error = new Error('Forbidden: Only FINANCE role can execute accounting integrations');
      error.status = 403;
      throw error;
    }

    const adapter = this.adapters[providerKey.toLowerCase()];
    if (!adapter) {
      const error = new Error(`Unsupported integration provider: '${providerKey}'. Supported providers: quickbooks, xero`);
      error.status = 400;
      throw error;
    }

    // 1. Fetch journal entry with lines using tenant context (enforces RLS)
    const journalEntry = await journalEntryService.getJournalEntryById(tenantId, journalEntryId);

    // 2. Validate and execute deterministic transformation
    const result = adapter.execute(journalEntry);

    // 3. Record append-only audit trail in export_audit_logs
    await withTenantContext(tenantId, async (client) => {
      const auditQuery = `
        INSERT INTO export_audit_logs (
          tenant_id, actor_id, actor_role, export_type,
          resource_type, resource_id, record_count, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      await client.query(auditQuery, [
        tenantId,
        userId,
        userRole,
        adapter.providerName.toUpperCase(),
        'JOURNAL_ENTRY',
        journalEntry.id,
        journalEntry.lines ? journalEntry.lines.length : 0,
        `Transformed finalized journal entry ${journalEntry.id} for ${adapter.providerName} integration point (${journalEntry.lines.length} lines, total: $${journalEntry.totalDebit.toFixed(2)})`,
      ]);
    });

    return result;
  }
}

module.exports = new IntegrationService();
