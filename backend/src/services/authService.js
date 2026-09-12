const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { pool, withTenantContext } = require('../config/db');

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password using bcrypt.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 * @param {string} plaintext
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Sign a JWT with minimal claims.
 * Payload is restricted to: sub (userId), tid (tenantId), role.
 * Algorithm is HS256. Secret is required and loaded from environment.
 *
 * @param {{ sub: string, tid: string, role: string }} payload
 * @returns {string} signed JWT
 */
function signToken(payload) {
  const { sub, tid, role } = payload;
  return jwt.sign(
    { sub, tid, role },
    config.auth.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.auth.jwtExpiresIn,
    }
  );
}

/**
 * Verify a JWT and validate required claims.
 * Algorithm is pinned to HS256 only — no attacker-selectable algorithm.
 *
 * @param {string} token
 * @returns {{ sub: string, tid: string, role: string, iat: number, exp: number }}
 * @throws {Error} on invalid signature, expiry, algorithm mismatch, or missing claims
 */
function verifyToken(token) {
  // Algorithm pinned: only HS256 is accepted. Prevents algorithm-confusion attacks.
  const decoded = jwt.verify(token, config.auth.jwtSecret, { algorithms: ['HS256'] });

  // Explicitly validate required claims for presence and type
  if (
    typeof decoded.sub !== 'string' || decoded.sub.trim() === '' ||
    typeof decoded.tid !== 'string' || decoded.tid.trim() === '' ||
    typeof decoded.role !== 'string' || decoded.role.trim() === ''
  ) {
    throw new Error('JWT is missing required claims');
  }

  const validRoles = ['EMPLOYEE', 'MANAGER', 'FINANCE'];
  if (!validRoles.includes(decoded.role)) {
    throw new Error('JWT contains an unrecognized role claim');
  }

  return decoded;
}

/**
 * Pre-authentication tenant identity lookup.
 *
 * SECURITY RATIONALE:
 * The `tenants` table has no RLS (by design — it contains only tenant identity
 * metadata: id, name, slug, status, timestamps). Tenant slugs are company
 * identifiers, not secrets. They must be resolvable before authentication
 * because email uniqueness is tenant-scoped (UNIQUE(tenant_id, email)), and
 * authentication cannot proceed without first identifying which tenant space to
 * look up the user in.
 *
 * This function is intentionally minimal:
 * - It only queries the `tenants` table.
 * - It only retrieves `id` and `status`.
 * - It does NOT access `users` or any tenant-scoped business tables.
 * - It uses a direct pool query (not withTransaction, not withTenantContext).
 * - User credential lookup is performed SEPARATELY via withTenantContext() with
 *   RLS enforced, using the tenant.id returned by this function.
 *
 * @param {string} slug - Company tenant slug
 * @returns {Promise<{ id: string, status: string } | null>}
 */
async function lookupTenantBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT id, status FROM tenants WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

/**
 * Full login flow for multi-tenant authentication.
 *
 * @param {{ email: string, password: string, tenantSlug: string }} credentials
 * @returns {Promise<{ token: string, user: object }>}
 * @throws {Error} on invalid credentials (generic error — prevents enumeration)
 */
async function login({ email, password, tenantSlug }) {
  // Step 1: Resolve tenant from slug (pre-auth tenant identity lookup)
  const tenant = await lookupTenantBySlug(tenantSlug);

  // Return generic error — do not reveal whether slug, email, or password is wrong
  if (!tenant) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }
  if (tenant.status !== 'ACTIVE') {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  // Step 2: Look up user within the resolved tenant scope, with RLS enforced
  // withTenantContext sets SET LOCAL ROLE expensease_app + app.current_tenant_id
  // RLS policy on `users` enforces tenant isolation at the database level
  let user;
  try {
    user = await withTenantContext(tenant.id, async (client) => {
      const { rows } = await client.query(
        // Only fetch the minimum fields required for authentication.
        // password_hash is fetched for verification ONLY — never returned.
        `SELECT id, tenant_id, email, password_hash, role, status, first_name, last_name
         FROM users
         WHERE email = $1`,
        [email]
      );
      return rows[0] || null;
    });
  } catch (_) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  // Generic error — do not distinguish between "user not found" and "wrong password"
  if (!user) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  // Step 3: Verify password against stored hash (timing-safe bcrypt compare)
  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  // Step 4: Verify account is active
  if (user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  // Step 5: Sign token with minimal claims — password_hash is never included
  const token = signToken({ sub: user.id, tid: tenant.id, role: user.role });

  // Step 6: Return token and safe user info — password_hash explicitly excluded
  return {
    token,
    user: {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
    },
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  lookupTenantBySlug,
  login,
};
