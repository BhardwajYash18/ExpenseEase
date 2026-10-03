# EXPENSEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

ExpensEase is a B2B expense-management platform for small and mid-sized businesses (SMBs). The application is delivered as a single responsive Progressive Web Application (PWA) for desktop and mobile browsers, backed by a Node.js API orchestrator, a dedicated Python document processing service, and PostgreSQL.

> **Current Status**: `CHECKPOINT 10 — SECURITY HARDENING + COMPREHENSIVE TESTING COMPLETED`
>
> Checkpoints 0 through 10 are fully implemented, verified, and tested. The project foundation, deterministic database migrations, PostgreSQL Row-Level Security (RLS) multi-tenancy model, bcrypt password hashing, HS256-pinned JWT authentication, strict RBAC authorization, receipt capture & Tesseract OCR pipeline, AI receipt understanding with provider abstraction, immutable dual-field provenance, deterministic effective values, deterministic policy engine, decimal-safe monetary arithmetic, multi-signal tenant-scoped duplicate detection, server-enforced approval workflow state machine (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CORRECTION_REQUESTED`), manager decisions with mandatory reasons, separation of duties, pessimistic concurrency control, append-only workflow audit trail, atomic all-or-nothing Finance Batch creation, deterministic integer-cents batch totals, batch status management (`OPEN`, `REVIEWED`), expense addition/removal, finance review completion, append-only finance audit trail, dedicated PWA Finance Batch management, deterministic double-entry bookkeeping (`TOTAL DEBITS = TOTAL CREDITS`), category-to-GL account mappings, reviewable journal entries (`DRAFT`, `FINALIZED`), RFC 4180 CSV export with formula injection mitigation, QuickBooks Online and Xero provider integration point boundaries, append-only export audit logging, server-wide security hardening (strict UUID parameter & body validation, RLS boundary defense, file path traversal mitigation, magic byte validation, null-byte sanitization, database error masking, 1MB payload limits), a 50-test dedicated security suite, and a 13-test full-lifecycle end-to-end integration suite are complete.
>
> In accordance with `AGENTS.md`, the next phase is Checkpoint 11 (Final End-to-End Audit).

---

## Architecture Overview

ExpensEase utilizes a **four-service application architecture**:

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
        AI & OCR Service
```

- **Frontend (`frontend/`)**: React-based responsive Progressive Web Application (PWA) with Web App Manifest, Service Worker support, device camera capture, structured extraction inspection, and human confirmation form.
- **Primary Backend (`backend/`)**: Node.js + Express REST API orchestrator handling authentication, authorization (RBAC), receipt file validation, secure storage abstraction, multi-tenant context management, database access, AI extraction dispatch, and deterministic effective value calculation.
- **AI & OCR Service (`ai-service/`)**: Dedicated Python + FastAPI service for deterministic image preprocessing (OpenCV, Pillow), Tesseract OCR text extraction, and AI-assisted receipt understanding (Pydantic schema validation, mock/regex provider, configurable LLM provider, prompt-injection defense).
- **Database (`database/`)**: PostgreSQL relational database managed via Docker Compose with deterministic SQL migrations, non-privileged application role, and Row-Level Security (RLS).

---

## Technology Stack

- **Frontend**: React 18, Vite, Vanilla CSS, Web App Manifest, Service Worker, Concurrently.
- **Primary Backend**: Node.js (v18+), Express 4, `pg` (PostgreSQL client pool), `bcryptjs` (saltRounds=12), `jsonwebtoken` (HS256 pinned), `multer`, `form-data`, `axios`, `express-validator`, Helmet, CORS, Dotenv.
- **AI & OCR Service**: Python 3.11+, FastAPI, Uvicorn, Pillow, OpenCV (headless), Pytesseract (Tesseract OCR), Pydantic, HTTPX.
- **Database**: PostgreSQL 16 (Docker container), Row-Level Security (RLS), custom `expensease_app` unprivileged role.
- **Containerization & Orchestration**: Docker, Docker Compose.

---

## Completed Milestones & Tasks

### Checkpoint 0 — Project Foundation
- [x] Established the four-service repository structure adhering strictly to `AGENTS.md`.
- [x] Implemented React PWA shell with `manifest.json`, Service Worker registration, and responsive layout.
- [x] Implemented primary Node.js + Express backend service with security headers (`helmet`), CORS, and error handling.
- [x] Implemented Python + FastAPI service with health endpoints.
- [x] Set up Docker Compose local development environment for all four services with healthchecks.
- [x] Built foundational liveness checks (`GET /api/health`, `GET /health`) and dependency readiness check (`GET /api/health/ready`).

### Checkpoint 1 — Database & Multi-Tenancy
- [x] Built deterministic, idempotent SQL migration runner (`database/migrator.js`) using catalog table `schema_migrations`.
- [x] Created `tenants` table (`id` UUID PK, `name`, `slug` UNIQUE, `status`).
- [x] Created `users` table (`id` UUID PK, `tenant_id` FK ON DELETE RESTRICT, `email`, `password_hash`, `role`, `status`) with `UNIQUE(tenant_id, email)`.
- [x] Configured and forced PostgreSQL Row-Level Security (`ALTER TABLE users FORCE ROW LEVEL SECURITY`).
- [x] Implemented tenant isolation policy scoped to session variable `app.current_tenant_id`.
- [x] Created dedicated unprivileged role `expensease_app` (`NOSUPERUSER NOBYPASSRLS`) to prevent superuser RLS bypass.
- [x] Implemented connection pool leakage prevention via `withTenantContext(tenantId, callback)` utilizing transaction-local `SET LOCAL ROLE expensease_app` and `set_config('app.current_tenant_id', ..., true)`.

### Checkpoint 2 — Authentication & RBAC
- [x] Implemented secure password hashing via `bcrypt` (`saltRounds = 12`) with unique salts.
- [x] Configured JWT token generation and verification:
  - Algorithm strictly pinned to `HS256` (`{ algorithms: ['HS256'] }`) to prevent algorithm confusion attacks.
  - Startup fail-fast validation: server terminates immediately if `JWT_SECRET` is missing or empty; zero fallback/default secret.
  - Minimal claims payload: `{ sub: userId, tid: tenantId, role, iat, exp }`.
  - Type- and value-validated claims for all incoming tokens.
- [x] Designed pre-auth tenant lookup (`lookupTenantBySlug`):
  - Strictly queries only `id` and `status` from `tenants` to resolve tenant by `slug`.
  - Does NOT access `users` or business data outside RLS.
  - User credential lookups run strictly via `withTenantContext` under PostgreSQL RLS and the unprivileged `expensease_app` role.
- [x] Implemented `authenticate` middleware: extracts `Bearer` token, validates claims, populates `req.user` exclusively from verified JWT payload (ignoring client-supplied body/query/param values).
- [x] Implemented `requireRole(...roles)` middleware: enforces RBAC authorization for `EMPLOYEE`, `MANAGER`, and `FINANCE`.
- [x] Built endpoints:
  - `POST /api/auth/login`: Accepts `{ email, password, slug }`, emits generic `401 Invalid credentials` on any failure to prevent user/tenant enumeration.
  - `GET /api/auth/me`: Returns verified user identity from token.
- [x] Verified zero `password_hash` exposure in API responses and application logs.
- [x] Explicitly deferred production PWA token storage strategy (no implicit `localStorage` assumption).

### Checkpoint 3 — Receipt Capture + OCR
- [x] Applied deterministic SQL migration `003_create_receipts.sql`:
  - `receipts` table with UUIDv4 PKs, `uploaded_by`, `tenant_id`, `storage_key`, `upload_status`, `ocr_status`, `ocr_raw_text`.
  - Enabled and forced PostgreSQL RLS with `tenant_isolation_policy`.
  - Granted permissions on `receipts` to `expensease_app`.
- [x] Implemented filesystem storage abstraction (`storageService.js`) using server-controlled UUID paths (`{storageDir}/{tenantId}/{uuid}.{ext}`). Prevented path traversal by construction.
- [x] Implemented robust file validation (`fileValidation.js`):
  - Validates file size ($\le 10$ MB) and allowed MIME types (`image/jpeg`, `image/png`, `image/webp`).
  - **Magic bytes verification**: inspects actual binary headers (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF` + `WEBP`) to defeat MIME spoofing.
  - Explicitly deferred PDF support to avoid heavy external rasterization dependencies in Checkpoint 3; PDF uploads are deterministically rejected with `UNSUPPORTED_FORMAT`.
  - Sanitizes original filenames (stripping `..`, slashes, non-ASCII chars).
- [x] Implemented deterministic document processing & OCR service in Python FastAPI (`image_preprocessor.py`, `ocr_service.py`):
  - Image preprocessing: EXIF auto-rotation, grayscale conversion, CLAHE contrast enhancement, Gaussian blur, and Otsu binarization with safe Pillow fallback.
  - Plain raw text extraction using Tesseract OCR (PSM 6).
  - Explicit architectural boundary: zero AI/LLM/VLM dependencies in Checkpoint 3. OCR text is strictly treated as untrusted raw text.
  - Original receipt files are preserved unconditionally even when OCR processing fails.
- [x] Enforced strict RBAC on receipt endpoints (`routes/receipts.js`, `receiptController.js`):
  - `POST /api/receipts/upload`: Strictly restricted to **`EMPLOYEE`** role (`requireRole('EMPLOYEE')`).
  - `GET /api/receipts/:id` & `/file`: Role-scoped (EMPLOYEE can access only their own receipts; MANAGER/FINANCE can view receipts within their tenant).
  - `GET /api/receipts/:id/ocr`: Returns OCR extraction status and raw text.
- [x] Built responsive PWA components (`ReceiptCapture.jsx`, `ReceiptView.jsx`, `App.jsx`):
  - Dual capture: Desktop/gallery file picker and mobile camera capture (`capture="environment"`).
  - Instant image preview and raw OCR text viewer with untrusted data disclaimer.

### Checkpoint 4 — AI Receipt Understanding & Structured Extraction
- [x] Applied deterministic SQL migration `004_create_receipt_extractions.sql`:
  - `receipt_extractions` table with dual-field provenance (`ai_*` vs `confirmed_*`, `corrected_by`, `corrected_at`).
  - `receipt_line_items` table linked to `receipt_extractions` with `CASCADE` delete.
  - Enabled and forced PostgreSQL RLS with `tenant_isolation_policy` on both tables.
  - Explicitly granted permissions to `expensease_app`.
- [x] Implemented AI service schemas & provider abstraction (`ai-service/`):
  - Pydantic schema validation (`ReceiptExtractionResponse`, `ReceiptLineItemSchema`) enforcing 7 allowed categories (`Meals`, `Travel`, `Accommodation`, `Office Supplies`, `Software`, `Transportation`, `Other`).
  - Safety prompts with prompt injection protection treating OCR text as untrusted data.
  - Provider interface (`ReceiptUnderstandingProvider`), deterministic `MockReceiptProvider` for CI/tests, and `ConfigurableLLMProvider` using `httpx`.
  - Graceful fallback: if LLM provider fails, safely falls back to mock provider.
  - Mounted endpoint: `POST /receipt-understanding/extract`.
- [x] Implemented backend extraction service & APIs (`backend/`):
  - AI output schema validation and numeric sanitization (`aiOutputValidation.js`).
  - `triggerExtraction`: Calls AI service, persists `ai_*` fields, inserts line items, marks status.
  - `getExtraction`: Retrieves extraction and line items with deterministic effective values.
  - `updateExtraction`: Human confirmation endpoint. Modifies `confirmed_*` fields, sets `corrected_by` and `corrected_at`. **Never overwrites or destroys `ai_*` fields**.
  - Deterministic effective value computation:
    $$\text{effective\_value} = \text{confirmed\_value if confirmed\_value IS NOT NULL else ai\_value}$$
  - Strict RBAC: strictly `EMPLOYEE` (own receipts), `MANAGER` and `FINANCE` (tenant receipts). No invented reviewer role.
  - Mounted endpoints: `POST /:id/extraction`, `GET /:id/extraction`, `PUT /:id/extraction`.
- [x] Enhanced React PWA interface (`ReceiptView.jsx`):
  - Displays extraction results, visual indicators for AI vs confirmed fields, and line items.
  - Flagged for review alerts and confidence score.
  - In-place Edit / Confirm form with deterministic effective value calculation.
  - Clear assistive AI principle banner.

### Checkpoint 5 — Policy Validation + Duplicate Detection
- [x] Applied deterministic SQL migration `005_create_validation_results.sql`:
  - `tenant_policies` table (UUID PK, `tenant_id` UNIQUE FK, `max_amount`, `require_receipt_above`, `restricted_categories` JSONB, `policy_version`).
  - `receipt_validation_results` table (UUID PK, `receipt_id` FK, `tenant_id` FK, `validation_status`, `validation_version`, `policy_rules_result` JSONB, `duplicate_status`, `duplicate_score`, `validated_at`).
  - `receipt_duplicate_candidates` table (UUID PK, `validation_result_id` FK, `receipt_id` FK, `candidate_receipt_id` FK, `tenant_id` FK, `similarity_score`, `matching_signals` JSONB, `detection_method`, `model_version`).
  - Enabled and forced PostgreSQL RLS with `tenant_isolation_policy` on all three tables and granted least-privilege permissions to `expensease_app`.
- [x] Implemented dedicated deterministic policy engine (`backend/src/services/policy/`):
  - `decimalUtils.js`: Safe monetary comparisons via integer cents and precision validation without floating-point hazards.
  - `policyRules.js`: Strict, deterministic rules (`MAX_AMOUNT`, `AMOUNT_VALIDITY`, `REQUIRED_FIELDS`, `RESTRICTED_CATEGORY`, `RECEIPT_DATE_VALIDITY`, `RECEIPT_REQUIRED`).
  - `policyEngine.js`: Zero LLM involvement in compliance; strictly reproducible validation results returning `PASSED`, `FAILED`, or `REVIEW_REQUIRED`.
- [x] Implemented tenant-isolated duplicate detection (`backend/src/services/duplicate/`):
  - Multi-signal scoring engine combining merchant similarity (token Jaccard + Dice bigrams), total amount similarity (decimal cents delta), date proximity, and receipt number/text overlap.
  - Categorizes candidate risk into `NO_MATCH`, `POSSIBLE_DUPLICATE`, and `HIGH_SIMILARITY` ($\ge 0.85$).
  - Strict self-exclusion (`WHERE r.id != $1`) and strict tenant isolation via RLS.
  - Purely advisory signal: never independently approves or rejects an expense.
- [x] Validation service and controllers (`validationService.js`, `validationController.js`):
  - Mounted under `/api/receipts/:id/validation` (`POST`, `GET`).
  - Strict RBAC: `EMPLOYEE` (own receipt), `MANAGER` and `FINANCE` (tenant receipts).
  - Validation operates strictly on deterministic effective values while preserving raw AI extraction and human confirmation values.
- [x] Enhanced React PWA interface (`ReceiptView.jsx`, `index.css`):
  - Interactive Policy & Duplicate Validation card.
  - Visual badges for policy status (`Policy passed`, `Policy violation`, `Review required`) and duplicate risk (`No duplicate candidate`, `Possible duplicate`, `High similarity`).
  - Detailed rule results table with actual vs expected values and candidate similarity signal breakdowns.
  - Clear AI principles and review signal disclaimers (no approval/rejection buttons in CP5).

### Checkpoint 6 — Approval Workflow
- [x] Applied deterministic SQL migration `006_create_approval_workflows.sql`:
  - `expense_workflows` table (UUID PK, `receipt_id` UNIQUE FK, `tenant_id` FK, `current_state` with strict `CHECK` constraint: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CORRECTION_REQUESTED`).
  - `expense_workflow_actions` table (UUID PK, `workflow_id` FK, `receipt_id` FK, `tenant_id` FK, `actor_user_id` FK, `actor_role`, `action` with strict `CHECK` constraint: `SUBMIT`, `APPROVE`, `REJECT`, `REQUEST_CORRECTION`, `reason`, `metadata`, `created_at`).
  - Forced PostgreSQL RLS with `tenant_isolation_policy` on both tables using `app.current_tenant_id`.
  - Granted least-privilege permissions to `expensease_app`: CRUD on `expense_workflows`, append-only (`SELECT, INSERT`) on `expense_workflow_actions`.
- [x] Implemented robust workflow service (`backend/src/services/workflowService.js`):
  - Strict 5-state state machine: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CORRECTION_REQUESTED`.
  - Zero ghost/pipeline states (`PROCESSING`, `VALIDATION`, or `FINANCE`).
  - Strict transition controls:
    - `SUBMIT`: `DRAFT` / `CORRECTION_REQUESTED` → `PENDING_APPROVAL`. Enforces that the employee is the expense owner, OCR/extraction is completed/confirmed, and CP5 validation has run.
    - `APPROVE`: `PENDING_APPROVAL` → `APPROVED`. Manager role only; separation of duties enforces managers cannot approve their own submissions; row-level locking (`SELECT ... FOR UPDATE OF w`).
    - `REJECT`: `PENDING_APPROVAL` → `REJECTED`. Manager role only; enforces mandatory non-empty rejection reason.
    - `REQUEST_CORRECTION`: `PENDING_APPROVAL` → `CORRECTION_REQUESTED`. Manager role only; enforces mandatory non-empty correction reason.
  - Audit logging: Every transition persists an immutable record in `expense_workflow_actions`.
- [x] Mounted workflow API routes (`backend/src/routes/receipts.js` & `backend/src/controllers/workflowController.js`):
  - `GET /api/receipts/:id/workflow`
  - `POST /api/receipts/:id/workflow/submit`
  - `POST /api/receipts/:id/workflow/approve`
  - `POST /api/receipts/:id/workflow/reject`
  - `POST /api/receipts/:id/workflow/request-correction`
  - Server-side RBAC and tenant authorization on all endpoints.
- [x] Enhanced React PWA interface (`ReceiptView.jsx`, `App.jsx`, `index.css`):
  - Interactive Workflow status card displaying authoritative status badges.
  - Dynamic employee action buttons: Submit for Approval / Resubmit after Correction.
  - Manager decision modal with mandatory reason prompt for rejection and correction requests.
  - Complete, chronological audit trail timeline showing who, what, when, and reasons.
  - Reviewer workspace switcher in `App.jsx` allowing Managers and Finance to easily browse and review tenant receipts.
  - Clear guidance for Finance users that approved expenses are ready for CP7 Finance Batches.

### Checkpoint 7 — Finance Batches
- [x] Applied deterministic SQL migration `007_create_finance_batches.sql`:
  - `finance_batches` table (UUID PK `id`, `tenant_id` FK, `created_by` FK, `status` with strict `CHECK (status IN ('OPEN', 'REVIEWED'))`, `total_amount NUMERIC(12, 2)`, `expense_count INTEGER`, `reviewed_by` FK, `reviewed_at`, timestamps). Identified solely by UUID `id`; no `batch_name` or `notes` fields.
  - `finance_batch_items` table (UUID PK, `batch_id` FK, `receipt_id` FK, `tenant_id` FK, `amount NUMERIC(12, 2)`, timestamps, `CONSTRAINT uq_batch_receipt UNIQUE (batch_id, receipt_id)`).
  - `finance_batch_actions` table for append-only audit trail (UUID PK, `batch_id` FK, `tenant_id` FK, `actor_id` FK, `actor_role`, `action` with strict `CHECK (action IN ('CREATE', 'ADD_ITEM', 'REMOVE_ITEM', 'REVIEW'))`, `affected_receipt_id`, `details`, `created_at`).
  - Forced PostgreSQL RLS with `tenant_isolation_policy` on all three tables using `app.current_tenant_id`.
  - Granted least-privilege permissions to `expensease_app`: CRUD on `finance_batches` & `finance_batch_items`; append-only `SELECT, INSERT` on `finance_batch_actions`.
- [x] Implemented robust Finance Batch service (`backend/src/services/financeBatchService.js`):
  - Strict eligibility: Only receipts with `expense_workflows.current_state = 'APPROVED'` are eligible to enter a batch (PRD FR-09.2, AGENTS.md Sec 14).
  - Duplicate prevention within batch: Enforces `UNIQUE(batch_id, receipt_id)`. The same expense must not be included multiple times within the same Finance Batch. No cross-batch exclusivity rule is enforced across the tenant.
  - Transactional creation semantics: Finance Batch creation is transactional. If the submitted request is invalid (e.g. contains unapproved, cross-tenant, or duplicate items), the transaction rolls back rather than leaving a partially created batch (API and data-integrity behavior, not an authoritative business requirement).
  - Deterministic arithmetic: Batch total is summed via integer cents using `decimalUtils` without floating-point hazards.
  - Batch status representation: A batch status is required; the exact literals `OPEN` (batch created / open for Finance review) and `REVIEWED` (finance review completed) are implementation representations of the lifecycle, not literal requirements from AGENTS.md/PRD.md. No other statuses exist.
  - Expense removal: Removing an expense from an `OPEN` batch leaves the expense strictly in `APPROVED` workflow state and recalculates batch totals deterministically.
  - Batch review locking: Once `REVIEWED`, further additions and removals are rejected.
  - Audit logging: Every action (`CREATE`, `ADD_ITEM`, `REMOVE_ITEM`, `REVIEW`) persists an immutable record in `finance_batch_actions`.
- [x] Mounted Finance Batch API routes (`backend/src/routes/financeBatches.js` & `backend/src/controllers/financeBatchController.js`):
  - `GET /api/finance-batches/eligible-expenses`
  - `GET /api/finance-batches`
  - `POST /api/finance-batches`
  - `GET /api/finance-batches/:id`
  - `POST /api/finance-batches/:id/items`
  - `DELETE /api/finance-batches/:id/items/:receiptId`
  - `POST /api/finance-batches/:id/review`
  - Strict server-side RBAC: restricted exclusively to `FINANCE` role (`EMPLOYEE` and `MANAGER` receive 403 Forbidden).
- [x] Enhanced React PWA interface (`FinanceBatchView.jsx`, `App.jsx`):
  - Dedicated Finance Batches view for `FINANCE` users.
  - Batches identified clearly by UUID ID.
  - Interactive approved expense selection table with live total calculator for batch creation.
  - Batch details inspector with status badges, included items table, and action bar.
  - "Add Expense" and "Remove Expense" controls for `OPEN` batches.
  - "Complete Finance Review" action for `OPEN` batches.
  - Chronological audit trail timeline displaying actor, role, action, and timestamp.

### Checkpoint 8 — Journal Entries / Deterministic Accounting
- [x] Applied deterministic SQL migration `008_create_journal_entries.sql`:
  - `account_mappings` table (`id` UUID PK, `tenant_id` FK, `category VARCHAR(64)`, `debit_account VARCHAR(128)`, `credit_account VARCHAR(128)`, `CONSTRAINT uq_tenant_category UNIQUE (tenant_id, category)`, timestamps).
  - `journal_entries` table (`id` UUID PK, `tenant_id` FK, `batch_id` FK, `created_by` FK, `status VARCHAR(32)` with strict `CHECK (status IN ('DRAFT', 'FINALIZED'))`, `total_debit NUMERIC(12, 2)`, `total_credit NUMERIC(12, 2)`, `line_count INTEGER`, `finalized_by` FK, `finalized_at`, `CONSTRAINT uq_batch_journal_entry UNIQUE (batch_id)`, timestamps).
  - `journal_entry_lines` table (`id` UUID PK, `journal_entry_id` FK, `tenant_id` FK, `receipt_id` FK, `line_order INTEGER`, `account VARCHAR(128)`, `debit_amount NUMERIC(12, 2)`, `credit_amount NUMERIC(12, 2)`, `description TEXT`, `created_at`).
  - `journal_entry_actions` table for append-only audit trail (`id` UUID PK, `journal_entry_id` FK, `tenant_id` FK, `actor_id` FK, `actor_role`, `action` with strict `CHECK (action IN ('GENERATE', 'FINALIZE'))`, `details TEXT`, `created_at`).
  - Forced PostgreSQL RLS with `tenant_isolation_policy` on all four tables using `app.current_tenant_id`.
  - Least-privilege permissions granted to `expensease_app`: CRUD on `account_mappings`, `journal_entries`, and `journal_entry_lines`; append-only `SELECT, INSERT` on `journal_entry_actions`.
- [x] Implemented robust Account Mapping & Journal Entry services (`backend/src/services/`):
  - Deterministic account mapping: `Expense Category → Configured Account Mapping → Accounting Account → Journal Entry Line` (AGENTS.md Sec 15; PRD FR-10.2).
  - Zero AI decision-making: LLM does not invent accounting accounts or decide debit/credit balances (AGENTS.md Sec 7, 15; PRD FR-10.3).
  - Missing account mappings produce explicit errors, halting generation until configured (AGENTS.md Sec 15; PRD FR-10.6).
  - Strict double-entry balance validation: `TOTAL DEBITS = TOTAL CREDITS` (AGENTS.md Sec 15; PRD FR-10.4). Unbalanced journal entries cannot be finalized (PRD FR-10.5).
  - Deterministic arithmetic: Integer cents summation using `decimalUtils.parseToCents` with zero floating-point math (AGENTS.md Sec 16; PRD Sec 12.3).
  - Source integrity: Generated exclusively from Finance Batches that have completed Finance Review (`status = 'REVIEWED'`) (AGENTS.md Sec 6, 14, 28; PRD FR-10.1).
  - Journal entry lifecycle: `DRAFT` (reviewable prior to finalization) and `FINALIZED` (finalized by Finance). These literals are implementation representations of the review/finalization progression.
  - Duplicate generation prevention: Enforces `UNIQUE(batch_id)` on `journal_entries` to prevent double-counting.
  - Audit logging: Append-only audit entries in `journal_entry_actions` for `GENERATE` and `FINALIZE`.
- [x] Mounted Journal Entry & Account Mapping API routes (`backend/src/routes/`):
  - `GET /api/account-mappings`
  - `POST /api/account-mappings`
  - `GET /api/journal-entries`
  - `POST /api/journal-entries/generate`
  - `GET /api/journal-entries/:id`
  - `POST /api/journal-entries/:id/finalize`
  - `POST /api/finance-batches/:batchId/journal-entry`
  - `GET /api/finance-batches/:batchId/journal-entry`
  - Strict server-side RBAC: restricted exclusively to `FINANCE` role (`EMPLOYEE` and `MANAGER` receive 403 Forbidden).
- [x] Enhanced React PWA interface (`JournalEntryView.jsx`, `FinanceBatchView.jsx`, `App.jsx`):
  - Finance workspace tab switcher: "Finance Batches" & "Journal Entries & Accounting".
  - Journal Entries list displaying ID, Batch ID, status badge, total debit, total credit, and balance status.
  - Journal Entry details inspector with double-entry balance card, ordered lines table (#, Account, Description, Debit, Credit), and action bar.
  - "Finalize Journal Entry" action for `DRAFT` entries with balance validation.
  - Account Mappings configuration manager allowing Finance users to view and add/update category-to-GL account mappings.
  - "Generate Journal Entry" one-click action directly on `REVIEWED` Finance Batches.

### Checkpoint 9 — CSV Export + QuickBooks/Xero Integration Points
- [x] Applied deterministic SQL migration `009_create_export_audit.sql`:
  - `export_audit_logs` table (`id` UUID PK, `tenant_id` FK, `actor_id` FK, `actor_role VARCHAR(32)`, `export_type VARCHAR(32)` with check `('CSV', 'QUICKBOOKS', 'XERO')`, `resource_type VARCHAR(32)` with check `('JOURNAL_ENTRY', 'FINANCE_BATCH', 'ALL_JOURNAL_ENTRIES')`, `resource_id UUID`, `record_count INTEGER`, `details TEXT`, `created_at TIMESTAMPTZ`).
  - Performance indexes on `tenant_id`, `actor_id`, `export_type`, `resource_id`, and `created_at`.
  - Forced PostgreSQL RLS with `tenant_isolation_policy` using `app.current_tenant_id`.
  - Least-privilege permissions granted to `expensease_app`: append-only `SELECT, INSERT`.
- [x] Implemented robust CSV Export service (`backend/src/services/csvExportService.js`):
  - Strictly exports already-validated, deterministic CP8 `FINALIZED` journal entries. Unfinalized `DRAFT` entries are rejected with HTTP 400 (AGENTS.md Sec 15; PRD FR-10.7).
  - Deterministic CSV column structure: `journal_entry_id,finance_batch_id,line_order,account,debit_amount,credit_amount,description,receipt_id,entry_date` (implementation choice derived directly from CP8 double-entry models).
  - Proper RFC 4180 serialization: escaping of commas, double quotes (`""`), and newlines.
  - Formula injection mitigation: text fields starting with formula operators (`=`, `+`, `-`, `@`) prepended with `'` while keeping numerical debit/credit values as valid decimals.
  - Read-only export safety: zero mutation to journal entries, lines, batches, or workflows.
  - Empty dataset handling: returns valid CSV with header row and records audit log count of 0.
- [x] Implemented clean provider adapter boundaries for external accounting integrations (`backend/src/services/integrations/`):
  - `AccountingIntegrationAdapter`: Base abstract contract requiring finalized status and integer-cent balance before transformation.
  - `QuickBooksAdapter`: Transforms finalized journal entries into QuickBooks Online `JournalEntry` entity schema (`DocNumber`, `TxnDate`, `Line` array with `JournalEntryLineDetail`, `PostingType`, `AccountRef`).
  - `XeroAdapter`: Transforms finalized journal entries into Xero `ManualJournals` entity schema (`ManualJournalID`, `Date`, `Status: POSTED`, `JournalLines` array with positive debits and negative credits balancing to 0.00).
  - `integrationService.js`: Orchestrates providers, verifies server-side `FINANCE` authorization and RLS, returns `INTEGRATION_POINT_READY` status, and logs audit events.
  - No real QuickBooks/Xero credentials required, no fake tokens stored, and zero external network calls made.
- [x] Mounted Export & Integration API routes (`backend/src/routes/export.js` & `backend/src/controllers/exportController.js`):
  - `GET /api/export/csv`
  - `GET /api/export/journal-entries/:id/csv`
  - `GET /api/export/finance-batches/:id/csv`
  - `GET /api/export/integrations`
  - `POST /api/export/integrations/quickbooks/:id`
  - `POST /api/export/integrations/xero/:id`
  - `GET /api/export/audit-logs`
  - Server-side RBAC: restricted exclusively to `FINANCE` role (`EMPLOYEE` and `MANAGER` receive 403 Forbidden).
- [x] Enhanced React PWA interface (`JournalEntryView.jsx`, `App.jsx`):
  - Added "CSV" export action button on finalized journal entry rows.
  - Added "Export All Finalized CSV" button for tenant-wide export.
  - Added "Export CSV", "QuickBooks", and "Xero" actions in the Journal Entry Detail view.
  - Integrated interactive Integration Payload Modal showing transformed JSON with copy-to-clipboard functionality and provider status.
  - Added "Integrations & Audit" tab with real-time audit trail and provider status disclosures.

### Checkpoint 10 — Security Hardening & Comprehensive Testing
- [x] Comprehensive Security & Threat Model Audit:
  - Audited against OWASP Top 10, broken authentication, IDOR, tenant isolation bypass, role escalation, mass assignment, path traversal, magic byte spoofing, prompt injection, CSV formula injection, floating-point arithmetic errors, and database error leakage.
- [x] Multi-Layer Server Hardening:
  - **Strict Input Validation**: Implemented `validateUuidParam` and `isValidUuid` middleware across all routes (`receipts`, `financeBatches`, `journalEntries`, `export`, `accountMappings`), query parameters, request bodies (`receiptIds`), and DB tenant context (`withTenantContext`).
  - **Database Error Classification & Masking**: Extended `errorHandler.js` to catch PostgreSQL error codes (`22P02` invalid text representation, `22001` value too long, `23505` unique violation, `23503` foreign key violation, `22021` character not in repertoire) returning client-safe 400/409 responses, and masking internal server errors and stack traces in production.
  - **Payload Size & CORS Protections**: Enforced 1MB request body limits in Express and environment-configurable CORS origins.
  - **Storage Path Traversal Protection**: Implemented canonical path boundary verification in `storageService.js` (`resolveSafePath`).
  - **File Upload Hardening**: Detected null bytes (`\0`) and path separators in uploaded filenames, sanitized filenames, and mapped busboy multipart parsing errors to clean HTTP 400 responses.
- [x] Dedicated Security Test Suite (`backend/tests/security.test.js` — 50 tests):
  - **AUTH**: Missing token, malformed header, invalid JWT, expired JWT, tampered signature, algorithm confusion (`none`), generic credentials error, zero password hash exposure.
  - **RBAC**: EMPLOYEE restricted from workflow approval/rejection, finance batches, journal entries, CSV exports; MANAGER restricted from finance operations; role spoofing via body/query/headers ignored.
  - **TENANT / RLS**: Cross-tenant isolation across receipts, files, OCR, extractions, batches, journal entries, and exports (all return 404/400 with zero cross-tenant leakage).
  - **INPUT**: Malformed UUIDs in URL params, request bodies, and query params return 400 Bad Request; oversized payloads (>1MB) rejected.
  - **FILE**: MIME spoofing, magic byte validation, storage path traversal defense, null-byte uploads, empty uploads rejected.
  - **WORKFLOW**: Invalid transitions (draft approval rejected), separation of duties (submitter cannot self-approve), mandatory rejection/correction reasons enforced.
  - **ACCOUNTING**: Imbalanced journal entries rejected (debits != credits), duplicate journal entry generation prevented, finalized entries locked from refinalization.
  - **EXPORT**: Formula injection trigger characters (`=`, `+`, `-`, `@`) prepended with `'`, unfinalized drafts rejected from export.
  - **AI / OCR**: Prompt injection payload in OCR does not alter workflow state or escalate role.
- [x] Full-Lifecycle End-to-End Integration Suite (`backend/tests/e2e.test.js` — 13 tests):
  - Validates end-to-end golden path: Auth → Upload → OCR → AI Extraction → Human Confirmation → Policy Check → Submission → Manager Approval → Finance Batch → Finance Review → Journal Entry Generation & Balance Validation → Finalize → CSV Export → QuickBooks & Xero Integration Points.
  - Validates cross-tenant isolation at every stage of the lifecycle.

## Repository Structure

```
ExpensEase/
│
├── frontend/                     # React Responsive PWA
│   ├── public/                   # Static assets, manifest.json, sw.js
│   ├── src/
│   │   ├── components/           # ReceiptCapture.jsx, ReceiptView.jsx, FinanceBatchView.jsx, JournalEntryView.jsx
│   │   ├── App.jsx               # Main application shell with auth & role workflows
│   │   ├── index.css             # Design system, responsive layout & button styling
│   │   └── main.jsx              # PWA mount & service worker registration
│   ├── scripts/
│   │   └── start-ai.cjs          # Cross-platform Python/uvicorn runner for AI service
│   ├── vite.config.js            # Vite configuration with /api development proxy
│   ├── Dockerfile
│   └── package.json              # Orchestrates dev environment via concurrently
│
├── backend/                      # Node.js + Express REST API
│   ├── src/
│   │   ├── config/               # env.js (fail-fast validation) & db.js (RLS context)
│   │   ├── controllers/          # auth, receipt, financeBatch, journalEntry, accountMapping, export
│   │   ├── middleware/           # authenticate.js, requireRole.js, errorHandler.js
│   │   ├── routes/               # health, auth, receipts, financeBatches, journalEntries, accountMappings, export
│   │   ├── services/             # auth, storage, receipt, extraction, validation, workflow, financeBatch,
│   │   │                         # journalEntry, accountMapping, csvExportService, integrations/
│   │   │   └── integrations/     # accountingIntegrationAdapter, quickBooksAdapter, xeroAdapter, integrationService
│   │   ├── utils/                # fileValidation.js (magic bytes & sanitization)
│   │   └── app.js                # Express app setup and route mounting
│   ├── tests/                    # Jest test suites (auth, database, duplicate, extraction, financeBatch,
│   │                             # health, journalEntry, multiTenancy, policy, readiness, receipts, validation,
│   │                             # workflow, export)
│   ├── Dockerfile
│   └── package.json
│
├── ai-service/                   # Python + FastAPI Document & OCR Service
│   ├── app/
│   │   ├── api/                  # health.py, ocr.py, receipt_understanding.py
│   │   ├── core/                 # config.py (Pydantic settings)
│   │   ├── processors/           # image_preprocessor.py (OpenCV / Pillow)
│   │   ├── services/             # ocr_service.py (Tesseract OCR), receipt_understanding_service.py
│   │   └── main.py               # FastAPI application entry point
│   ├── tests/                    # Pytest test suite (test_ocr.py, test_health.py, test_receipt_understanding.py)
│   ├── Dockerfile                # Installs tesseract-ocr system packages
│   └── requirements.txt
│
├── database/                     # Database scripts & schema
│   ├── migrations/               # Deterministic SQL migrations (001 through 009):
│   │   ├── 001_create_tenants_and_users.sql
│   │   ├── 002_create_app_role.sql
│   │   ├── 003_create_receipts.sql
│   │   ├── 004_create_extractions.sql
│   │   ├── 005_create_policies.sql
│   │   ├── 006_create_workflows.sql
│   │   ├── 007_create_finance_batches.sql
│   │   ├── 008_create_journal_entries.sql
│   │   └── 009_create_export_audit.sql
│   └── migrator.js               # SQL migration runner
│
├── docs/                         # Documentation
│   ├── PRD.md                    # Product Requirements Document
│   └── architecture/             # System architecture & multi-tenancy specifications
│
├── docker-compose.yml            # Local development multi-container stack
├── .env.example                  # Environment configuration template
├── .gitignore                    # Git ignore specifications
├── README.md                     # Project documentation
└── AGENTS.md                     # Rules of engagement and project specification
```

---

## Prerequisites

- **Node.js** >= 18.0.0 and **npm** >= 9.0.0
- **Python** >= 3.11 and **pip**
- **Docker** and **Docker Compose**
- **Tesseract OCR** (installed in Docker container or locally for direct OCR execution)

---

## Environment Configuration

Copy the example environment files:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp ai-service/.env.example ai-service/.env
```

Ensure `JWT_SECRET` is set in your environment or `backend/.env` file with a strong random secret (minimum 64 characters in production).

Default local ports:
- **Frontend (PWA)**: `http://localhost:3000`
- **Backend API**: `http://localhost:5000`
- **Document/OCR Service**: `http://localhost:8000`
- **PostgreSQL**: `localhost:5432`

---

## Running the Application

### Option 1: Unified One-Command Development Setup (Recommended)

You can run the entire development environment (Frontend, Backend, and AI Service) concurrently using a single command:

1. Ensure PostgreSQL is running:
   ```bash
   docker compose up -d postgres
   ```
2. Run database migrations:
   ```bash
   cd backend && npm run migrate && cd ..
   ```
3. Start all services concurrently from `frontend/`:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

This single command launches:
- **`[frontend]`**: Vite dev server on `http://localhost:3000` with HMR and an active `/api` proxy.
- **`[backend]`**: Node.js Express server on `http://localhost:5000` with `node --watch`.
- **`[ai]`**: FastAPI Uvicorn server on `http://localhost:8000` using the local Python `.venv`.

Pressing `Ctrl+C` cleanly shuts down all child services simultaneously (`-k` / `--kill-others`), leaving zero orphaned processes.

---

### Option 2: Docker Compose Stack

To build and run all four services in isolated containers:

```bash
docker compose up --build
```

To shut down:

```bash
docker compose down
```

---

### Option 3: Manual Step-by-Step Local Setup

#### 1. Start PostgreSQL
```bash
docker compose up -d postgres
```

#### 2. Run Database Migrations
```bash
cd backend
npm run migrate
```

#### 3. Start Backend
```bash
cd backend
npm install
npm run dev
```

#### 4. Start AI Document Service
```bash
cd ai-service
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 5. Start Frontend
```bash
cd frontend
npm install
npm run dev:frontend
```

---

## Active API Endpoints

| Service | Method | Endpoint | Auth Required | Role Required | Description |
|---|---|---|---|---|---|
| **Backend** | `GET` | `/api/health` | No | Any | Liveness health check |
| **Backend** | `GET` | `/api/health/ready` | No | Any | Readiness check (verifies PostgreSQL & AI service) |
| **Backend** | `POST` | `/api/auth/login` | No | Any | Login endpoint: `{ email, password, slug }` → `{ token, user }` |
| **Backend** | `GET` | `/api/auth/me` | Bearer Token | Any | Authenticated user profile from verified JWT |
| **Backend** | `POST` | `/api/receipts/upload` | Bearer Token | `EMPLOYEE` | Upload receipt image (JPEG, PNG, WebP $\le 10$MB) with OCR processing |
| **Backend** | `GET` | `/api/receipts` | Bearer Token | Any | List receipts (EMPLOYEE sees own; MANAGER/FINANCE sees tenant receipts) |
| **Backend** | `GET` | `/api/receipts/:id` | Bearer Token | Any | Get single receipt metadata |
| **Backend** | `GET` | `/api/receipts/:id/file` | Bearer Token | Any | Stream original stored receipt image |
| **Backend** | `GET` | `/api/receipts/:id/ocr` | Bearer Token | Any | Get OCR status and raw extracted text |
| **Backend** | `POST` | `/api/receipts/:id/extraction` | Bearer Token | `EMPLOYEE`, `MANAGER`, `FINANCE` | Trigger AI receipt understanding and structured field extraction |
| **Backend** | `GET` | `/api/receipts/:id/extraction` | Bearer Token | `EMPLOYEE`, `MANAGER`, `FINANCE` | Get structured extraction, line items, and deterministic effective values |
| **Backend** | `PUT` | `/api/receipts/:id/extraction` | Bearer Token | `EMPLOYEE`, `MANAGER`, `FINANCE` | Human confirmation of values (preserves immutable AI extraction) |
| **Backend** | `POST` | `/api/receipts/:id/validate` | Bearer Token | Any | Deterministic policy validation & duplicate similarity check |
| **Backend** | `POST` | `/api/receipts/:id/submit` | Bearer Token | `EMPLOYEE` | Submit expense into approval workflow (`PENDING_APPROVAL`) |
| **Backend** | `POST` | `/api/receipts/:id/approve` | Bearer Token | `MANAGER` | Approve expense (`APPROVED`) |
| **Backend** | `POST` | `/api/receipts/:id/reject` | Bearer Token | `MANAGER` | Reject expense (`REJECTED`) with mandatory reason |
| **Backend** | `POST` | `/api/receipts/:id/request-correction` | Bearer Token | `MANAGER` | Request correction (`CORRECTION_REQUESTED`) with mandatory reason |
| **Backend** | `GET` | `/api/finance-batches/eligible-expenses`| Bearer Token | `FINANCE` | List approved expenses eligible for batching |
| **Backend** | `GET` | `/api/finance-batches` | Bearer Token | `FINANCE` | List all Finance Batches for tenant |
| **Backend** | `POST` | `/api/finance-batches` | Bearer Token | `FINANCE` | Atomically create Finance Batch with approved expenses |
| **Backend** | `GET` | `/api/finance-batches/:id` | Bearer Token | `FINANCE` | Get batch details, included expenses, and audit history |
| **Backend** | `POST` | `/api/finance-batches/:id/items` | Bearer Token | `FINANCE` | Add approved expense to OPEN batch |
| **Backend** | `DELETE`| `/api/finance-batches/:id/items/:receiptId` | Bearer Token | `FINANCE` | Remove expense from OPEN batch (leaves expense approved) |
| **Backend** | `POST` | `/api/finance-batches/:id/review` | Bearer Token | `FINANCE` | Mark Finance Batch as REVIEWED |
| **Backend** | `GET` | `/api/account-mappings` | Bearer Token | `FINANCE` | List all category-to-GL account mappings |
| **Backend** | `POST` | `/api/account-mappings` | Bearer Token | `FINANCE` | Create or update category-to-GL account mapping |
| **Backend** | `GET` | `/api/journal-entries` | Bearer Token | `FINANCE` | List all journal entries for tenant |
| **Backend** | `POST` | `/api/journal-entries/generate` | Bearer Token | `FINANCE` | Generate balanced journal entry from reviewed Finance Batch |
| **Backend** | `GET` | `/api/journal-entries/:id` | Bearer Token | `FINANCE` | Get journal entry with ordered lines and audit history |
| **Backend** | `POST` | `/api/journal-entries/:id/finalize` | Bearer Token | `FINANCE` | Finalize journal entry (validates TOTAL DEBITS = TOTAL CREDITS) |
| **Backend** | `GET` | `/api/export/csv` | Bearer Token | `FINANCE` | Export CSV for tenant, batch, or entry |
| **Backend** | `GET` | `/api/export/journal-entries/:id/csv` | Bearer Token | `FINANCE` | Export CSV for specific finalized journal entry |
| **Backend** | `GET` | `/api/export/finance-batches/:id/csv` | Bearer Token | `FINANCE` | Export CSV for Finance Batch finalized journal entry |
| **Backend** | `GET` | `/api/export/integrations` | Bearer Token | `FINANCE` | List available accounting integration providers and status |
| **Backend** | `POST` | `/api/export/integrations/quickbooks/:id` | Bearer Token | `FINANCE` | Transform finalized entry into QuickBooks Online payload |
| **Backend** | `POST` | `/api/export/integrations/xero/:id` | Bearer Token | `FINANCE` | Transform finalized entry into Xero ManualJournals payload |
| **Backend** | `GET` | `/api/export/audit-logs` | Bearer Token | `FINANCE` | List export and integration audit trail |
| **AI Service** | `GET` | `/health` | No | Any | AI service liveness check |
| **AI Service** | `POST` | `/ocr/extract` | No (Internal) | Any | Accepts multipart image, runs preprocessing & Tesseract OCR |
| **AI Service** | `POST` | `/receipt-understanding/extract` | No (Internal) | Any | Accepts OCR text, extracts structured fields using configured provider |
| **Frontend** | `GET` | `/` | No | Any | Responsive PWA shell with capture, review, batching, accounting & export |

---

## Testing

All test suites run in automated CI-ready test runners:

### Backend Tests (268 tests across 16 suites)
```bash
cd backend
npm test
```
Tests cover:
- Health and readiness endpoints (`health.test.js`, `readiness.test.js`)
- Database connectivity and schema verification (`database.test.js`)
- Multi-tenancy RLS isolation, constraint violations, and pool context isolation (`multiTenancy.test.js`)
- Password hashing, JWT signing, HS256 pinning, tampering/expiration rejection, and RBAC (`auth.test.js`)
- Receipt file validation, magic byte verification, PDF rejection, strict EMPLOYEE upload RBAC, RLS receipt isolation, file streaming, OCR text retrieval, and failure resilience (`receipts.test.js`)
- Checkpoint 4 AI structured extraction: trigger extraction, schema validation, immutable AI provenance, human confirmation, deterministic effective values calculation, and failure resilience (`extraction.test.js`)
- Checkpoint 5 Policy & Duplicate Detection: deterministic limits, category restrictions, missing receipt checks, similarity duplicate scoring, and human review flags (`policy.test.js`, `validation.test.js`, `duplicate.test.js`)
- Checkpoint 6 Approval Workflow: state transitions (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CORRECTION_REQUESTED`), mandatory manager reasons, separation of duties, pessimistic concurrency control, and append-only audit trail (`workflow.test.js`)
- Checkpoint 7 Finance Batches: atomic all-or-nothing batch creation, approved-only inclusion, duplicate prevention, item addition/removal, integer-cent arithmetic, review completion, and audit logging (`financeBatch.test.js`)
- Checkpoint 8 Journal Entries & Accounting: deterministic category mapping, integer-cent double-entry line calculation, balance validation (`TOTAL DEBITS = TOTAL CREDITS`), reviewable draft state, finalization, duplicate generation prevention, and append-only audit trail (`journalEntry.test.js`)
- Checkpoint 9 CSV Export & Accounting Integrations: finalized-only eligibility, RFC 4180 CSV serialization, formula injection mitigation, read-only safety, tenant isolation (404), empty dataset handling, QuickBooks Online payload transformation, Xero ManualJournals payload transformation, provider status, and append-only export audit logging (`export.test.js`)
- Checkpoint 10 Security Hardening & Vulnerability Defenses (`security.test.js` — 50 tests): JWT tampering, algorithm confusion, expired tokens, missing auth, RBAC authorization boundaries, multi-tenant RLS isolation across all entities, UUID and payload input validation, file upload magic bytes and traversal defenses, workflow state machine security and separation of duties, double-entry accounting balance enforcement, CSV formula injection neutralization, and OCR prompt injection resilience.
- Checkpoint 10 Full-Lifecycle End-to-End Integration (`e2e.test.js` — 13 tests): Complete lifecycle validation from authentication to receipt capture, OCR, AI extraction, confirmation, policy check, submission, manager approval, finance batching, review, balanced journal entry generation, finalization, CSV export, accounting integration payload generation, and cross-tenant isolation at every step.

### AI / Document Service Tests (12 tests across 3 modules)
```bash
cd ai-service
pytest
```
Tests cover:
- Service liveness (`test_health.py`)
- Image preprocessing with valid and corrupted images (`test_ocr.py`)
- Tesseract OCR extraction resilience and structured response schema
- OCR API endpoint file upload validation and empty file rejection
- Receipt understanding: valid structured receipt extraction, empty text handling, missing field handling without hallucination, prompt injection defense, category suggestions heuristic, and HTTP API endpoint (`test_receipt_understanding.py`)

### Frontend Production Build
```bash
cd frontend
npm run build
```
Verifies clean compilation of the PWA bundle via Vite (built in ~700ms with zero errors).

### Database Migration Idempotency
```bash
cd backend
npm run migrate
```
Verifies migration runner detects zero pending migrations on already-migrated databases.

---

## Next Steps

Following the incremental development process in `AGENTS.md`, work will proceed to:

- **Checkpoint 11 — Final End-to-End Audit**: Comprehensive verification of the complete ExpensEase workflow across all stages and compilation of the final traceability and audit report.
