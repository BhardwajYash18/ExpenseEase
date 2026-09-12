# ExpensEase — System Architecture

## Architecture Overview

ExpensEase is structured as a **four-service application architecture**:

```
                    ExpensEase PWA
                         │
                         ▼
                  React Frontend
                         │
                      REST/JSON
                         │
                         ▼
                Node.js + Express
                    /         \
                   /           \
                  ▼             ▼
        Python + FastAPI    PostgreSQL
             AI Service
```

## Component Roles

1. **React Frontend (Progressive Web Application)**
   - Single React-based PWA for both desktop and mobile browsers.
   - Provides Web App Manifest and Service Worker foundation for installability and responsive layout.
   - Communicates with the primary backend exclusively over REST/JSON.

2. **Primary Backend (Node.js + Express)**
   - Primary application server orchestrating business APIs, database access, and inter-service communication.
   - Exposes standard REST endpoints including health and readiness checks.
   - Establishes and manages tenant context on PostgreSQL connections.

3. **AI Service (Python + FastAPI)**
   - Dedicated service for AI and document processing workloads.
   - Exposes RESTful endpoints for OCR and machine learning tasks.
   - AI output is strictly assistive.

4. **Database (PostgreSQL)**
   - Relational database for persistent transactional data.
   - Enforces strict tenant data isolation at the database engine level via PostgreSQL Row-Level Security (RLS).

---

## Multi-Tenancy & Data Isolation (Checkpoint 1)

### 1. Tenant/Company Model
- The **`tenants`** table represents corporate entities (companies) subscribing to ExpensEase.
- Key attributes include `id` (UUIDv4 primary key), `name` (company display name), `slug` (unique company identifier), and `status` (`ACTIVE`, `SUSPENDED`, `ARCHIVED`).
- The `tenants` table serves as the root tenant record; administrative provisioning happens via transactions outside the tenant RLS scope.

### 2. User-to-Tenant Relationship
- The **`users`** table represents user accounts.
- **Strict 1:N Relationship**: Every user belongs to exactly one tenant (`tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`).
- Uniqueness constraint: `(tenant_id, email)` ensures email uniqueness within a tenant while allowing clean corporate boundary enforcement.
- Foreign key deletion behavior is set to `ON DELETE RESTRICT` to prevent accidental cascading deletion of active tenant users.
- Role definition: The `role` column exists in the schema (`EMPLOYEE`, `MANAGER`, `FINANCE`) as foundational data definition, but RBAC authorization logic is strictly deferred to Checkpoint 2.

### 3. PostgreSQL Row-Level Security (RLS)
- RLS is explicitly enabled and forced on tenant-scoped tables:
  ```sql
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE users FORCE ROW LEVEL SECURITY;
  ```
- **Why `FORCE ROW LEVEL SECURITY`?**
  By default in PostgreSQL, table owners bypass RLS. Applying `FORCE ROW LEVEL SECURITY` instructs PostgreSQL to apply RLS policies even to table owners.
- **Tenant Isolation Policy**:
  ```sql
  CREATE POLICY tenant_isolation_policy ON users
      AS PERMISSIVE
      FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  ```
  - `USING` expression controls read, update, and delete access. If `app.current_tenant_id` is unset or empty, the expression evaluates to `NULL` (falsy), blocking all reads, updates, and deletes.
  - `WITH CHECK` expression controls insert and update operations. Ensures rows can only be created or modified for the currently authenticated tenant.

### 4. Tenant Context Flow & Connection Pool Leakage Prevention
To prevent connection-pool context leakage when connections return to the pool, tenant context is strictly scoped to the database transaction using `SET LOCAL`:

```
Client Request (with secure tenant identity)
                    │
                    ▼
     Backend: withTenantContext(tenantId)
                    │
                    ├─► 1. Client checked out from pool
                    ├─► 2. BEGIN Transaction
                    ├─► 3. SET LOCAL ROLE expensease_app (unprivileged role)
                    ├─► 4. SELECT set_config('app.current_tenant_id', tenantId, true)
                    │      (3rd param `true` scopes parameter locally to transaction)
                    ├─► 5. Execute queries / business logic (RLS enforced by PostgreSQL)
                    ├─► 6. COMMIT (or ROLLBACK upon error)
                    ├─► 7. Transaction ends -> 'app.current_tenant_id' and ROLE revert automatically
                    ├─► 8. Defense in depth: Explicit RESET ROLE and clear parameter
                    └─► 9. Client returned safely to connection pool
```

### 5. Implementation Choices & Assumptions
1. **Unprivileged Application Role (`expensease_app`)**:
   In Docker Compose, `POSTGRES_USER` is automatically assigned `SUPERUSER` privileges by the official PostgreSQL image. Because PostgreSQL superusers bypass all RLS policies unconditionally (even with `FORCE ROW LEVEL SECURITY`), migration `002_create_app_role.sql` provisions a dedicated `expensease_app` role (`NOSUPERUSER NOBYPASSRLS`). The backend executes tenant transactions under this role via `SET LOCAL ROLE expensease_app`, ensuring realistic and verifiable RLS enforcement.
2. **UUIDv4 Primary Keys**:
   UUIDv4 generated via PostgreSQL's built-in `gen_random_uuid()` is used for primary keys (`tenants.id`, `users.id`) to prevent sequential enumeration attacks across tenants.
3. **Deterministic SQL Migrations**:
   Managed via a lightweight, deterministic runner (`database/migrator.js`) using a dedicated `schema_migrations` catalog table to guarantee idempotency and linear ordering.

### 6. Intentionally Deferred to Checkpoint 2
- User authentication workflows (password hashing/verification, login, logout).
- Session and JWT token generation/verification.
- Backend RBAC authorization middleware (restricting routes based on `EMPLOYEE`, `MANAGER`, `FINANCE`).
- Tenant resolution middleware from authenticated request tokens.
