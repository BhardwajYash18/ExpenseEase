const { withTenantContext } = require('../config/db');
const { hashPassword } = require('./authService');

/**
 * Manager Service
 *
 * Provides tenant-isolated manager directory inspection and provisioning.
 * Strictly enforces PostgreSQL Row-Level Security (RLS) via withTenantContext.
 */

/**
 * List all managers for the authenticated tenant with optional search and sort.
 *
 * @param {string} tenantId - Authenticated tenant ID from JWT
 * @param {object} options - Query options { search, sortBy, sortOrder }
 * @returns {Promise<Array<object>>} List of managers (passwords excluded)
 */
async function listManagers(tenantId, options = {}) {
  const { search, sortBy = 'createdAt', sortOrder = 'DESC' } = options;

  return withTenantContext(tenantId, async (client) => {
    let query = `
      SELECT id, tenant_id, email, first_name, last_name, role, status, created_at, updated_at
      FROM users
      WHERE role = 'MANAGER'
    `;
    const params = [];

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term);
      query += ` AND (
        LOWER(first_name) LIKE $${params.length} OR
        LOWER(last_name) LIKE $${params.length} OR
        LOWER(CONCAT(first_name, ' ', last_name)) LIKE $${params.length} OR
        LOWER(email) LIKE $${params.length}
      )`;
    }

    // Determine deterministic SQL sorting
    let sortColumn = 'created_at';
    if (sortBy === 'name') {
      sortColumn = 'first_name';
    } else if (sortBy === 'email') {
      sortColumn = 'email';
    } else if (sortBy === 'status') {
      sortColumn = 'status';
    }

    const direction = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${direction}, id ASC`;

    const { rows } = await client.query(query, params);

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      fullName: `${r.first_name} ${r.last_name}`.trim(),
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

/**
 * Provision a new manager within the authenticated tenant.
 *
 * @param {string} tenantId - Authenticated tenant ID from JWT
 * @param {object} managerData - { firstName, lastName, email, password }
 * @returns {Promise<object>} Created manager record (password excluded)
 */
async function createManager(tenantId, managerData) {
  const { firstName, lastName, email, password } = managerData;
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanFirstName = String(firstName).trim();
  const cleanLastName = String(lastName).trim();

  return withTenantContext(tenantId, async (client) => {
    // 1. Check if user with same email exists in this tenant
    const existingRes = await client.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [cleanEmail]
    );

    if (existingRes.rows.length > 0) {
      const err = new Error('A user with this email address already exists in your organization');
      err.status = 409;
      throw err;
    }

    // 2. Hash password securely using standard project bcrypt configuration
    const passwordHash = await hashPassword(password);

    // 3. Insert new manager into users table under RLS
    const insertSql = `
      INSERT INTO users (
        tenant_id, email, password_hash, first_name, last_name, role, status
      ) VALUES ($1, $2, $3, $4, $5, 'MANAGER', 'ACTIVE')
      RETURNING id, tenant_id, email, first_name, last_name, role, status, created_at, updated_at
    `;

    const { rows } = await client.query(insertSql, [
      tenantId,
      cleanEmail,
      passwordHash,
      cleanFirstName,
      cleanLastName,
    ]);

    const created = rows[0];

    return {
      id: created.id,
      tenantId: created.tenant_id,
      email: created.email,
      firstName: created.first_name,
      lastName: created.last_name,
      fullName: `${created.first_name} ${created.last_name}`.trim(),
      role: created.role,
      status: created.status,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
    };
  });
}

module.exports = {
  listManagers,
  createManager,
};
