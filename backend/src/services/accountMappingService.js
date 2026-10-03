const { withTenantContext } = require('../config/db');

/**
 * Account Mapping Service (Checkpoint 8)
 *
 * Implements deterministic account mappings connecting expense categories
 * to general ledger debit and credit accounts (PRD FR-10.2, AGENTS.md Sec 15).
 *
 * Traceability:
 * - AGENTS.md Sec 15: "Expense Category → Configured Account Mapping → Accounting Account → Journal Entry Line"
 * - AGENTS.md Sec 15: "The LLM MUST NOT invent accounting accounts. The LLM MUST NOT decide debit/credit balances."
 * - PRD FR-10.6: "Missing account mappings result in an explicit error or review state"
 */

const DEFAULT_MAPPINGS = [
  { category: 'Meals', debitAccount: '6100 - Meals & Entertainment', creditAccount: '2000 - Accounts Payable' },
  { category: 'Travel', debitAccount: '6200 - Travel & Lodging', creditAccount: '2000 - Accounts Payable' },
  { category: 'Supplies', debitAccount: '6300 - Office Supplies', creditAccount: '2000 - Accounts Payable' },
  { category: 'Software', debitAccount: '6400 - Software & Subscriptions', creditAccount: '2000 - Accounts Payable' },
  { category: 'Transportation', debitAccount: '6250 - Local Transportation', creditAccount: '2000 - Accounts Payable' },
  { category: 'Lodging', debitAccount: '6210 - Hotel & Accommodation', creditAccount: '2000 - Accounts Payable' },
  { category: 'Uncategorized', debitAccount: '6900 - General Expense', creditAccount: '2000 - Accounts Payable' },
];

/**
 * Format account mapping database row for API responses.
 */
function formatAccountMapping(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    category: row.category,
    debitAccount: row.debit_account,
    creditAccount: row.credit_account,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all account mappings for the tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} List of account mappings
 */
async function getAccountMappings(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM account_mappings ORDER BY category ASC'
    );
    return rows.map(formatAccountMapping);
  });
}

/**
 * Get account mapping for a specific category.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} category - Expense category name
 * @returns {Promise<object|null>} Account mapping or null
 */
async function getAccountMappingByCategory(tenantId, category) {
  if (!category) return null;

  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM account_mappings WHERE LOWER(TRIM(category)) = LOWER(TRIM($1))',
      [category]
    );
    return rows[0] ? formatAccountMapping(rows[0]) : null;
  });
}

/**
 * Create or update an account mapping.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} userId - User UUID (Finance)
 * @param {object} param2 - { category, debitAccount, creditAccount }
 * @returns {Promise<object>} Saved account mapping
 */
async function createOrUpdateAccountMapping(tenantId, userId, { category, debitAccount, creditAccount }) {
  if (!category || typeof category !== 'string' || !category.trim()) {
    const error = new Error('category is required and must be a non-empty string');
    error.status = 400;
    throw error;
  }

  if (!debitAccount || typeof debitAccount !== 'string' || !debitAccount.trim()) {
    const error = new Error('debitAccount is required and must be a non-empty string');
    error.status = 400;
    throw error;
  }

  if (!creditAccount || typeof creditAccount !== 'string' || !creditAccount.trim()) {
    const error = new Error('creditAccount is required and must be a non-empty string');
    error.status = 400;
    throw error;
  }

  const cleanCategory = category.trim();
  const cleanDebit = debitAccount.trim();
  const cleanCredit = creditAccount.trim();

  return withTenantContext(tenantId, async (client) => {
    const query = `
      INSERT INTO account_mappings (tenant_id, category, debit_account, credit_account)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, category)
      DO UPDATE SET
        debit_account = EXCLUDED.debit_account,
        credit_account = EXCLUDED.credit_account,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const { rows } = await client.query(query, [
      tenantId,
      cleanCategory,
      cleanDebit,
      cleanCredit,
    ]);

    return formatAccountMapping(rows[0]);
  });
}

/**
 * Seed default account mappings for a tenant if none exist.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} List of account mappings
 */
async function seedDefaultAccountMappings(tenantId) {
  return withTenantContext(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      'SELECT count(*) as count FROM account_mappings'
    );

    if (parseInt(existing[0].count, 10) === 0) {
      for (const def of DEFAULT_MAPPINGS) {
        await client.query(
          `INSERT INTO account_mappings (tenant_id, category, debit_account, credit_account)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, category) DO NOTHING`,
          [tenantId, def.category, def.debitAccount, def.creditAccount]
        );
      }
    }

    const { rows } = await client.query(
      'SELECT * FROM account_mappings ORDER BY category ASC'
    );
    return rows.map(formatAccountMapping);
  });
}

module.exports = {
  getAccountMappings,
  getAccountMappingByCategory,
  createOrUpdateAccountMapping,
  seedDefaultAccountMappings,
  DEFAULT_MAPPINGS,
};
