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

### 6. Verification
- Verified cross-tenant isolation where tenant context is established with `withTenantContext(tenantId)`.
- Verified RLS blocks cross-tenant access and unauthorized inserts/reads/updates.

---

## Authentication & Role-Based Access Control (Checkpoint 2)

### 1. Password Hashing
- ExpensEase uses **bcrypt** (`bcryptjs`) with a cost factor of `saltRounds = 12`.
- Every password hash incorporates a cryptographically secure, unique per-hash salt.
- Plaintext passwords and `password_hash` values are never returned by API endpoints or written to application logs.

### 2. JWT Strategy & Algorithm Pinning
- **Signed Tokens**: JWTs are signed with the `HS256` HMAC algorithm using a server-side secret loaded from the `JWT_SECRET` environment variable.
- **Fail-Fast Secret Requirement**: The application explicitly validates `JWT_SECRET` at startup and terminates immediately if it is absent or empty. No default fallback secret is permitted in production environments.
- **Strict Algorithm Pinning**: Token verification explicitly specifies `{ algorithms: ['HS256'] }`, strictly preventing algorithm confusion or downgrade attacks (e.g. `none` algorithm).
- **Minimal Claims Payload**:
  - `sub`: User ID (UUID)
  - `tid`: Tenant ID (UUID)
  - `role`: User role (`EMPLOYEE`, `MANAGER`, `FINANCE`)
  - `iat`, `exp`: Issued-at and expiration timestamps (configured via `JWT_EXPIRES_IN`, default 24h)
- No user credentials, password hashes, or extraneous PII are placed in the JWT.

### 3. Pre-Authentication Tenant Lookup Security Rationale
- **Tenant Isolation Context**: In ExpensEase, user email uniqueness is tenant-scoped (`UNIQUE(tenant_id, email)`). Multiple independent tenants may legitimately employ users with identical emails (e.g. `admin@company.com`).
- **Scoped Pre-Auth Query**: To resolve which tenant space the user belongs to, the login endpoint accepts `{ email, password, slug }`.
- **Why Pre-Auth Access is Permitted & Safe**:
  - The `tenants` table contains corporate entity metadata (`id`, `name`, `slug`, `status`), not tenant business or expense records.
  - Pre-auth resolution calls `lookupTenantBySlug(slug)` which strictly queries `SELECT id, status FROM tenants WHERE slug = $1`. It retrieves only identity metadata.
  - The tenant lookup does NOT access the `users` table or any business tables, and runs outside `withTenantContext`.
- **RLS Boundary Preserved**:
  - The actual user authentication query (`SELECT id, email, password_hash, role, status...`) is executed strictly within `withTenantContext(tenant.id, ...)` under the unprivileged `expensease_app` role with PostgreSQL Row-Level Security active.
  - RLS cannot be bypassed during authentication; non-existent users, wrong passwords, or inactive accounts yield identical generic `401 Invalid credentials` responses to prevent user or tenant enumeration.

### 4. Authentication Middleware (`authenticate.js`)
- Inspects the incoming `Authorization: Bearer <token>` header.
- Verifies the signature, expiration, algorithm, and presence/types of required claims (`sub`, `tid`, `role`).
- Sets `req.user = { id: decoded.sub, tenantId: decoded.tid, role: decoded.role }`.
- **Identity Isolation**: `req.user.tenantId` and `req.user.role` are derived exclusively from the cryptographically verified JWT. Any client-supplied `tenant_id`, `user_id`, or `role` in request bodies, query strings, or URL parameters is ignored.

### 5. RBAC Authorization Middleware (`requireRole.js`)
- Factory function `requireRole(...roles)` checking `req.user.role` against authorized roles (`EMPLOYEE`, `MANAGER`, `FINANCE`).
- Returns `401 Unauthorized` if authentication has not occurred, and `403 Forbidden` if the authenticated role is insufficient.

### 6. Production Token Storage Decision
- **Status: Explicitly Deferred**.
- For API testing in Checkpoint 2, the backend returns `{ token, user }` in the login JSON response.
- The production PWA token storage strategy (e.g., `httpOnly` secure cookies with CSRF defense vs. in-memory access tokens with refresh token rotation) is explicitly deferred to be decided prior to frontend authentication implementation in subsequent checkpoints.
- No `localStorage` or client-side storage assumptions are made as an implicit default.

---

## Receipt Capture & OCR Pipeline (Checkpoint 3)

### 1. Storage Architecture & Path Traversal Prevention
- **Storage Service Abstraction (`storageService.js`)**: Encapsulates file persistence behind a clean interface (`generateStorageKey`, `storeFile`, `readFile`, `deleteFile`), allowing seamless transition to object storage in future deployments.
- **Server-Controlled File Paths**: Files are stored under server-controlled paths: `{storageDir}/{tenantId}/{uuid}.{ext}`.
- **Path Traversal Prevention**: Original filenames are never used in filesystem paths. Original filenames are sanitized (stripping `..`, `/`, `\`, control chars) and stored solely as database metadata (`original_filename`).
- **Opaque Storage Keys**: Storage keys are generated server-side using cryptographically secure UUIDv4 identifiers.

### 2. File Validation & Magic Byte Verification (`fileValidation.js`)
- **Content Validation**: File validation does not rely solely on client-provided `Content-Type` headers or file extensions.
- **Magic Bytes Verification**:
  - `image/jpeg`: Checks for JFIF/EXIF header `FF D8 FF`.
  - `image/png`: Checks for PNG signature `89 50 4E 47 0D 0A 1A 0A`.
  - `image/webp`: Checks for RIFF header `52 49 46 46` and `WEBP` chunk marker at offset 8.
- **Rejection of Spoofed Files**: Files with spoofed MIME types (e.g. text or executable disguised with a `.png` extension) are rejected with `400 Bad Request`.
- **Size Limits**: Configurable file size limits (default: 10 MB, enforced at both multer middleware and service layers).

### 3. PDF Deferral Rationale
- Supported formats for Checkpoint 3 are restricted to standard images: `image/jpeg`, `image/png`, and `image/webp`.
- PDF processing (`application/pdf`) requires dedicated rendering runtimes (Poppler/Ghostscript) to rasterize PDF pages prior to OCR. To prevent introducing complex external system dependencies and maintain determinism in Checkpoint 3, PDF uploads are explicitly deferred and rejected deterministically with an `UNSUPPORTED_FORMAT` error.

### 4. Deterministic Preprocessing & OCR Service (FastAPI)
- **Deterministic Pipeline**: The Python service acts strictly as a deterministic image processing and OCR extraction service (`Pillow`, `OpenCV`, `Tesseract`).
- **NO AI/LLM/VLM**: Zero LLM SDKs, zero vision-language models, zero embeddings, and zero AI categorization are used in Checkpoint 3.
- **Image Preprocessing (`image_preprocessor.py`)**:
  - EXIF orientation auto-rotation (`ImageOps.exif_transpose`).
  - Grayscale conversion.
  - CLAHE (Contrast Limited Adaptive Histogram Equalization) for uneven receipt lighting.
  - Gaussian blur and Otsu adaptive thresholding for binarization.
  - Safe fallback to Pillow-only processing if OpenCV is unavailable.
- **Tesseract OCR Extraction (`ocr_service.py`)**:
  - Tesseract configured with Page Segmentation Mode 6 (`--psm 6`).
  - Returns raw text string and extraction status.
  - **Untrusted Output Principle**: OCR text is stored strictly as untrusted raw text; original files are preserved intact and never overwritten.

### 5. Strict Role Scope (RBAC) Enforcement
Per [AGENTS.md](file:///d:/Codes/College/ExpenseEase/AGENTS.md) Section 13:
- **`POST /api/receipts/upload`**: Restricted strictly to the **`EMPLOYEE`** role (`requireRole('EMPLOYEE')`). Receipts are submitted by employees. Managers and Finance roles cannot upload receipts through this endpoint.
- **`GET /api/receipts/:id` & `GET /api/receipts/:id/file`**:
  - `EMPLOYEE`: Access restricted strictly to **their own** receipts (`receipt.user_id === req.user.id`).
  - `MANAGER`: Can view supporting receipts within their authenticated tenant (`receipt.tenant_id === req.user.tenantId`) for approval review.
  - `FINANCE`: Can view supporting receipts within their authenticated tenant for audit/batching review.
  - All access is strictly constrained by tenant isolation and PostgreSQL RLS.

### 6. Multi-Tenancy & Row-Level Security
- Migration `003_create_receipts.sql` enables and forces PostgreSQL RLS on the `receipts` table.
- Enforces `tenant_isolation_policy` matching the pattern established in Checkpoint 1.
- All database operations are executed under the unprivileged `expensease_app` role inside `withTenantContext(tenantId)`.

### 7. Intentionally Deferred to Checkpoint 4
- AI/VLM receipt understanding and reasoning.
- Structured receipt field extraction (merchant, transaction date, amount, taxes, line items).
- Semantic expense categorization assistance.
- Confidence scoring and review flags.
