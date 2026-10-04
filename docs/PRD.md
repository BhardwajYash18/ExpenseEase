# Product Requirements Document (PRD)

## EXPENSEEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

| Field | Value |
|---|---|
| **Document Version** | 1.0 |
| **Date** | September 2026 |
| **Product Name** | ExpenseEase |
| **Product Type** | Responsive Progressive Web Application (PWA) |
| **Target Market** | Small and Mid-Sized Businesses (SMBs) |
| **Delivery Model** | B2B Multi-Tenant SaaS |

---

## Table of Contents

1. [Product Vision & Purpose](#1-product-vision--purpose)
2. [Problem Statement](#2-problem-statement)
3. [Target Users & Personas](#3-target-users--personas)
4. [Product Scope](#4-product-scope)
5. [Functional Requirements](#5-functional-requirements)
6. [System Architecture](#6-system-architecture)
7. [Technology Stack](#7-technology-stack)
8. [Core Expense Workflow](#8-core-expense-workflow)
9. [Role-Based Access Control](#9-role-based-access-control)
10. [Multi-Tenancy & Data Isolation](#10-multi-tenancy--data-isolation)
11. [AI & Document Processing](#11-ai--document-processing)
12. [Finance & Accounting](#12-finance--accounting)
13. [Security Requirements](#13-security-requirements)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [API Design](#15-api-design)
16. [Database Design](#16-database-design)
17. [Testing Strategy](#17-testing-strategy)
18. [Out of Scope](#18-out-of-scope)
19. [Implementation Roadmap](#19-implementation-roadmap)
20. [Current Implementation Status](#20-current-implementation-status)

---

## 1. Product Vision & Purpose

ExpenseEase is a **smart employee expense management platform** designed to eliminate manual, error-prone expense reporting processes for small and mid-sized businesses. The platform streamlines the complete lifecycle of employee expenses — from receipt capture through AI-assisted data extraction to manager approval, finance review, and accounting-ready export.

### Core Value Proposition

- **For Employees**: Submit expenses quickly by capturing or uploading receipts. AI extracts receipt fields automatically; employees simply confirm and submit.
- **For Managers**: Review submitted expenses with full context — original receipt, extracted data, and policy validation results — to approve, reject, or request corrections.
- **For Finance Teams**: Batch approved expenses, generate balanced journal entries using deterministic account mappings, and export accounting-ready data to CSV, QuickBooks, or Xero.
- **For the Business**: Enforce configurable expense policies deterministically, detect potential duplicate submissions, maintain a complete audit trail, and isolate every tenant's data securely.

---

## 2. Problem Statement

Small and mid-sized businesses face significant challenges managing employee expenses:

1. **Manual Data Entry**: Employees manually key in receipt details, leading to errors and delays.
2. **Lost or Illegible Receipts**: Paper receipts fade, get lost, or are difficult to read.
3. **Inconsistent Policy Enforcement**: Expense policies are applied inconsistently when checked manually.
4. **Duplicate Claims**: Without systematic checks, the same expense can be submitted multiple times.
5. **Slow Approval Cycles**: Email-based or spreadsheet-based approval workflows create bottlenecks.
6. **Accounting Friction**: Approved expenses must be manually re-entered into accounting systems.
7. **Lack of Audit Trail**: Without centralized records, tracking who did what and when is difficult.

ExpenseEase addresses each of these by combining OCR-based receipt extraction, AI-assisted understanding, deterministic policy validation, structured approval workflows, and accounting-ready export in a single multi-tenant platform.

---

## 3. Target Users & Personas

### 3.1 Employee (EMPLOYEE Role)

- **Who**: Any employee in an SMB who incurs business expenses (meals, travel, supplies, subscriptions, etc.).
- **Goals**: Submit expense claims quickly, with minimal manual entry, and track claim status.
- **Key Interactions**: Capture/upload receipts, confirm AI-extracted data, correct returned expenses, submit for approval.

### 3.2 Manager (MANAGER Role)

- **Who**: Department heads, team leads, or designated approvers responsible for reviewing team expenses.
- **Goals**: Efficiently review submitted expenses, validate legitimacy, and make approval decisions.
- **Key Interactions**: Review submitted expenses with attached receipts, view extracted data and policy flags, approve, reject, or request corrections.

### 3.3 Finance Team Member (FINANCE Role)

- **Who**: Accountants, bookkeepers, or finance staff responsible for processing approved expenses.
- **Goals**: Batch approved expenses for efficient processing, generate journal entries, and export data to accounting systems.
- **Key Interactions**: Create and review Finance Batches, generate and validate journal entries, export to CSV/QuickBooks/Xero.

---

## 4. Product Scope

### 4.1 In Scope (Current MVP)

| Category | Features |
|---|---|
| **Platform** | Responsive Progressive Web Application (PWA) for desktop and mobile browsers |
| **Expense Submission** | Employee expense creation, receipt upload, receipt capture via device camera |
| **Document Processing** | OCR-based receipt text extraction (Tesseract), image preprocessing (OpenCV, Pillow) |
| **AI Assistance** | Receipt understanding, structured field extraction, expense categorization, similarity-based duplicate detection |
| **Policy Engine** | Deterministic policy validation (amount limits, restricted categories, missing receipts, configurable rules) |
| **Approval Workflow** | Employee → Manager review → Approve / Reject / Request Correction |
| **Finance Operations** | Finance Batches, finance review, journal entry generation, balanced journal-entry validation |
| **Accounting Integration** | CSV export, QuickBooks integration points, Xero integration points |
| **Multi-Tenancy** | Strict tenant data isolation, PostgreSQL Row-Level Security (RLS) |
| **Security** | JWT authentication (HS256 pinned), RBAC (Employee/Manager/Finance), bcrypt password hashing |
| **Auditability** | Audit trail for all significant actions |
| **Infrastructure** | Docker, Docker Compose, Git/GitHub |
| **Testing** | Automated and manual testing |

### 4.2 Explicitly Out of Scope

The following are NOT part of the current MVP and must not be implemented without explicit approval:

- Native mobile applications (Android, iOS, React Native, Flutter)
- Banking infrastructure or guaranteed payment settlement
- Automated employee payouts
- Tax filing
- Custom enterprise ERP
- Corporate card feeds
- Advanced analytics platform
- Multi-currency support
- Kubernetes, Kafka, Redis, RabbitMQ
- Unnecessary microservices or cloud infrastructure

---

## 5. Functional Requirements

### FR-01: User Authentication

| ID | Requirement |
|---|---|
| FR-01.1 | Users authenticate via email, password, and company tenant slug |
| FR-01.2 | Passwords are hashed using bcrypt with salt rounds ≥ 12 |
| FR-01.3 | Authentication issues JWTs signed with HS256 using a server-side secret |
| FR-01.4 | JWT payload contains only: `sub` (user ID), `tid` (tenant ID), `role`, `iat`, `exp` |
| FR-01.5 | Server refuses to start if `JWT_SECRET` is missing or empty (no default fallback) |
| FR-01.6 | JWT algorithm is strictly pinned to HS256 during verification |
| FR-01.7 | Failed authentication returns generic "Invalid credentials" to prevent enumeration |
| FR-01.8 | Inactive or suspended users/tenants cannot authenticate |

### FR-02: Role-Based Access Control

| ID | Requirement |
|---|---|
| FR-02.1 | Three business roles: `EMPLOYEE`, `MANAGER`, `FINANCE` |
| FR-02.2 | Authorization is enforced on the backend, not via UI-only hiding |
| FR-02.3 | User identity (tenant ID, role) is derived exclusively from the verified JWT |
| FR-02.4 | Client-supplied tenant IDs and roles in request body/query/params are ignored |

### FR-03: Expense Submission

| ID | Requirement |
|---|---|
| FR-03.1 | Employees can create new expense claims |
| FR-03.2 | Employees can upload receipt images (file selection) |
| FR-03.3 | Employees can capture receipts using the device camera where browser-supported |
| FR-03.4 | Original receipts are preserved; never silently overwritten |
| FR-03.5 | Employees can view their own expenses and track claim status |
| FR-03.6 | Employees can confirm or correct AI-extracted information before submission |
| FR-03.7 | Employees can correct and resubmit expenses returned by managers |

### FR-04: Receipt Processing & OCR

| ID | Requirement |
|---|---|
| FR-04.1 | Uploaded receipt images undergo OCR text extraction (Tesseract) |
| FR-04.2 | Image preprocessing (OpenCV/Pillow) is applied to improve OCR quality |
| FR-04.3 | OCR output is treated as untrusted extracted data |
| FR-04.4 | The system gracefully handles blurry, rotated, partial, poorly-lit, handwritten, corrupt, or unsupported-format receipts |
| FR-04.5 | Receipt file uploads are validated for type, size, and content |
| FR-04.6 | The data pipeline distinguishes: Original Receipt → OCR Output → AI Extraction → User-Confirmed Data |

### FR-05: AI-Assisted Extraction & Categorization

| ID | Requirement |
|---|---|
| FR-05.1 | AI/LLM/VLM extracts structured fields from receipt text (merchant, amount, date, items, etc.) |
| FR-05.2 | AI assists with expense categorization |
| FR-05.3 | All AI output includes confidence indicators |
| FR-05.4 | Low-confidence fields are flagged for manual review (not fabricated) |
| FR-05.5 | AI output is parsed, schema-validated, type-validated, and sanitized before use |
| FR-05.6 | AI is strictly assistive — it does not approve, reject, or make final decisions |

### FR-06: Policy Validation

| ID | Requirement |
|---|---|
| FR-06.1 | Policy validation is primarily deterministic (code-based, not AI-based) |
| FR-06.2 | Configurable expense amount limits |
| FR-06.3 | Restricted expense categories enforcement |
| FR-06.4 | Missing receipt checks |
| FR-06.5 | Policy values come from approved configuration/database, not hardcoded or AI-invented |
| FR-06.6 | AI may suggest relevant information, but deterministic rules make the final validation decision |
| FR-06.7 | Configured exceptions to policy rules |
| FR-06.8 | Other explicitly configured policy rules as defined in the database or configuration |

### FR-07: Duplicate Detection

| ID | Requirement |
|---|---|
| FR-07.1 | System detects potential duplicate expenses using similarity-based analysis |
| FR-07.2 | Signals include: employee, merchant, amount, date, receipt text, description, similarity score |
| FR-07.3 | Potential duplicates are flagged for human review, not automatically rejected |
| FR-07.4 | Automatic rejection occurs only if an explicit deterministic business rule requires it |

### FR-08: Manager Approval Workflow

| ID | Requirement |
|---|---|
| FR-08.1 | Managers can review submitted expenses assigned to them |
| FR-08.2 | Managers can view the original receipt and extracted/confirmed data |
| FR-08.3 | Managers can **approve** expenses |
| FR-08.4 | Managers can **reject** expenses (with reason) |
| FR-08.5 | Managers can **request corrections** from the employee |
| FR-08.6 | All workflow transitions are recorded in the audit history |

### FR-09: Finance Batches

| ID | Requirement |
|---|---|
| FR-09.1 | Finance users can create Finance Batches to group approved expenses |
| FR-09.2 | A batch must not contain rejected, unapproved, or cross-tenant expenses |
| FR-09.3 | Duplicate inclusion of the same expense in a batch is prevented |
| FR-09.4 | Finance Batches remain usable even if journal-entry generation fails |
| FR-09.5 | Finance Batches are a distinct entity; they are NOT replaced by Journal Entries |

### FR-10: Journal Entries

| ID | Requirement |
|---|---|
| FR-10.1 | Journal entries are generated from Finance Batches using deterministic account mappings |
| FR-10.2 | Account mapping: Expense Category → Configured Account → Journal Entry Line |
| FR-10.3 | AI/LLM must not invent accounting accounts or decide debit/credit balances |
| FR-10.4 | Every finalized journal entry must satisfy: `TOTAL DEBITS = TOTAL CREDITS` |
| FR-10.5 | Unbalanced journal entries must not be finalized |
| FR-10.6 | Missing account mappings result in an explicit error or review state |
| FR-10.7 | Journal entries are reviewable before finalization/export |

### FR-11: Export & Integrations

| ID | Requirement |
|---|---|
| FR-11.1 | Finance users can export accounting-ready data as CSV |
| FR-11.2 | QuickBooks integration point is available |
| FR-11.3 | Xero integration point is available |
| FR-11.4 | External integrations may depend on provider sandbox credentials and should not block the MVP |

### FR-12: Auditability

| ID | Requirement |
|---|---|
| FR-12.1 | All significant actions are recorded in an audit log |
| FR-12.2 | Auditable actions include: expense creation, receipt upload, extraction changes, user confirmation, policy validation, duplicate flags, manager decisions, correction requests, batch creation, finance review, journal entry generation/finalization, export/integration actions |
| FR-12.3 | Each audit record captures: WHO, WHAT, WHEN, and WHICH RESOURCE |
| FR-12.4 | Historical audit records cannot be silently rewritten |

---

## 6. System Architecture

ExpenseEase uses a **four-service application architecture**:

```
                    ExpenseEase PWA
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

| Service | Responsibility |
|---|---|
| **React Frontend (PWA)** | Responsive UI for desktop and mobile browsers; installable with Web App Manifest and Service Worker |
| **Node.js + Express (Primary Backend)** | Authentication, authorization, expense management, workflow orchestration, policy validation, finance operations, audit logging, inter-service communication |
| **Python + FastAPI (AI Service)** | Image preprocessing, OCR orchestration, receipt understanding, structured extraction, categorization assistance, similarity-based duplicate detection |
| **PostgreSQL (Database)** | Persistent transactional data store with Row-Level Security (RLS) for tenant isolation |

> [!NOTE]
> The Node.js backend **orchestrates** duplicate detection; the Python AI service **performs** the underlying similarity analysis.

### Inter-Service Communication

- All communication uses **REST APIs with JSON payloads**.
- Frontend → Backend: REST/JSON over HTTP.
- Backend → AI Service: REST/JSON over HTTP.
- Backend → PostgreSQL: Direct connection via `pg` client pool with transaction-scoped tenant context.

---

## 7. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| **Frontend** | React 18, Vite, Vanilla CSS | PWA with Web App Manifest & Service Worker |
| **Primary Backend** | Node.js (≥18), Express 4 | `pg`, `bcryptjs`, `jsonwebtoken`, `express-validator`, `helmet`, `cors`, `dotenv` |
| **AI Service** | Python 3.11+, FastAPI, Uvicorn | Pydantic for data validation |
| **OCR** | Tesseract OCR | Or an approved cloud OCR provider (with documented dependency) |
| **Image Processing** | OpenCV, Pillow | Additional libraries only when technically necessary |
| **AI / LLM / VLM** | Configurable | For receipt understanding, structured extraction, categorization assistance |
| **Database** | PostgreSQL 16 | Row-Level Security (RLS), UUIDv4 primary keys |
| **Infrastructure** | Docker, Docker Compose | Reproducible development and deployment environments |
| **Version Control** | Git, GitHub | Small, meaningful commits |

---

## 8. Core Expense Workflow

The end-to-end expense workflow proceeds through the following stages:

```
Employee
    ↓
Receipt Capture (camera or file upload)
    ↓
Receipt Upload (validated for type/size)
    ↓
OCR (Tesseract text extraction)
    ↓
AI Understanding (structured field extraction + categorization)
    ↓
Employee Confirmation (review & correct extracted data)
    ↓
Policy Validation (deterministic rule checks)
    ↓
Duplicate / Similarity Check (flagged for human review)
    ↓
Manager Review
    ↓
Approve / Reject / Request Correction
    ↓
Finance Batch (group approved expenses)
    ↓
Finance Review
    ↓
Journal Entry Generation (deterministic account mapping)
    ↓
Balance Validation (TOTAL DEBITS = TOTAL CREDITS)
    ↓
CSV Export / QuickBooks / Xero
```

### Expense State Machine

```
DRAFT → SUBMITTED → PROCESSING → VALIDATION → PENDING_APPROVAL
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    ▼                 ▼                 ▼
                              APPROVED           REJECTED     CORRECTION_REQUESTED
                                    │                                   │
                                    ▼                                   │
                               FINANCE ◄────────────────────────────────┘
                                                            (Employee corrects → re-submit)
```

---

## 9. Role-Based Access Control

### 9.1 EMPLOYEE

| Permission | Description |
|---|---|
| Create expenses | Submit new expense claims |
| Upload receipts | Attach receipt images to expenses |
| View own expenses | See only their own expense history and status |
| Confirm extracted info | Review and approve AI-extracted data |
| Correct returned expenses | Fix and re-submit expenses returned by managers |
| Submit expenses | Send expenses for manager approval |

### 9.2 MANAGER

| Permission | Description |
|---|---|
| Review submitted expenses | View expenses submitted by their team |
| View supporting receipts | See original receipt images and extracted data |
| Approve expenses | Approve an expense for finance processing |
| Reject expenses | Reject an expense with a reason |
| Request corrections | Send an expense back to the employee for correction |

### 9.3 FINANCE

| Permission | Description |
|---|---|
| Review approved expenses | See all approved expenses ready for processing |
| Create/review Finance Batches | Group approved expenses into batches |
| Generate Journal Entries | Create accounting entries from batches |
| Export accounting data | Export to CSV |
| Use accounting integrations | QuickBooks/Xero integration points |

### 9.4 Enforcement Principle

- Authorization is enforced on the **backend** via middleware.
- Frontend UI may hide/show elements based on role, but this is **never the sole enforcement mechanism**.
- `req.user.tenantId` and `req.user.role` are derived exclusively from the cryptographically verified JWT, never from client-supplied request data.

---

## 10. Multi-Tenancy & Data Isolation

### 10.1 Tenant Model

- Each subscribing company is a **tenant** with a unique `slug` identifier.
- Every user belongs to exactly one tenant.
- Email uniqueness is enforced per-tenant: `UNIQUE(tenant_id, email)`.

### 10.2 Isolation Requirements

A user from Tenant A must **never** be able to:
- Read, modify, or delete Tenant B data
- Access Tenant B receipts, finance batches, journal entries, or audit logs

### 10.3 Enforcement Mechanism

- **PostgreSQL Row-Level Security (RLS)** on all tenant-scoped tables.
- Tenant context is established by the backend from the authenticated JWT — never from client input.

**Approved Technical Decisions (CP1):**

- `FORCE ROW LEVEL SECURITY` ensures policies apply even to table owners.
- Dedicated unprivileged database role (`expensease_app`, `NOSUPERUSER NOBYPASSRLS`) for application queries.
- Transaction-scoped tenant context via `SET LOCAL ROLE` and `set_config('app.current_tenant_id', ..., true)` prevents connection pool leakage.

---

## 11. AI & Document Processing

### 11.1 AI Safety Principle

```
AI UNDERSTANDS AND SUGGESTS.
DETERMINISTIC CODE VALIDATES.
AUTHORIZED HUMANS DECIDE.
ACCOUNTING LOGIC RECORDS.
```

### 11.2 AI Boundaries

AI must **NOT** independently:
- Approve or reject an expense
- Make final policy-violation decisions
- Invent accounting accounts or debit/credit entries
- Modify accounting balances
- Bypass authorization or access cross-tenant data
- Directly perform financial settlement
- Override deterministic business rules

### 11.3 AI Output Validation

Every AI response must be:
1. Parsed
2. Schema validated
3. Type validated
4. Sanitized
5. Checked for missing or invalid fields
6. Checked against business constraints

Low-confidence results must return `null`, `unknown`, or a `low-confidence` flag rather than fabricated data.

Never instruct an AI model to "guess" missing receipt information.

### 11.4 Data Pipeline Integrity

```
Original Receipt (preserved, never overwritten)
         ↓
OCR Output (untrusted extracted text)
         ↓
AI Extraction (structured fields with confidence)
         ↓
User-Confirmed Data (trusted application state)
```

---

## 12. Finance & Accounting

### 12.1 Finance Batches

- Finance Batches group approved expenses for review and audit.
- Required entity in the workflow — not replaceable by Journal Entries.
- Must not contain rejected, unapproved, cross-tenant, or duplicate expenses.
- Remain functional even if journal entry generation fails.

### 12.2 Journal Entries

- Generated via deterministic account mappings:
  ```
  Expense Category → Configured Account Mapping → Accounting Account → Journal Entry Line
  ```
- AI/LLM must not invent accounts or determine debit/credit balances.
- Balance validation: `TOTAL DEBITS = TOTAL CREDITS` (unbalanced entries cannot be finalized).
- Missing account mappings produce explicit errors, not silent defaults.

### 12.3 Accounting Integrity

- All monetary calculations use deterministic application logic.
- No reliance on LLM arithmetic, AI-generated totals, or unvalidated floating-point.
- Appropriate numeric/decimal handling for monetary values.
- No silent rounding that could create imbalances.

---

## 13. Security Requirements

### 13.1 Authentication & Session Security

| Requirement | Detail |
|---|---|
| Password hashing | bcrypt, unique salt per hash |
| JWT signing | Server-side secret from environment |
| Secret management | `JWT_SECRET` required at startup; no default/fallback |
| Credential exposure | `password_hash` never returned in API responses or logged |

**Approved Technical Decisions (CP2):**

| Decision | Detail |
|---|---|
| bcrypt cost factor | saltRounds = 12 |
| JWT algorithm | HS256, verification pinned to `{ algorithms: ['HS256'] }` |
| JWT claims payload | `sub` (user ID), `tid` (tenant ID), `role`, `iat`, `exp` |

### 13.2 Input & Upload Security

| Threat | Mitigation |
|---|---|
| SQL Injection | Parameterized queries exclusively |
| IDOR | Resource authorization enforced after authentication + tenant + role checks |
| File upload attacks | Type validation, size limits, content validation |
| Path traversal | Strict file path handling |
| XSS / Injection | Input sanitization, Helmet security headers |
| CORS | Configured CORS middleware |
| Rate limiting | Applied where appropriate to prevent abuse |
| Error-information leakage | Error responses do not expose internal details, stack traces, or sensitive data |

### 13.3 AI-Specific Security

| Threat | Mitigation |
|---|---|
| Prompt injection | AI input sanitization |
| OCR-generated malicious input | Treat OCR output as untrusted |
| Cross-tenant AI context leakage | Tenant-scoped AI requests |

### 13.4 Secret Management

- Never hardcode API keys, passwords, database credentials, tokens, or secrets.
- Use environment variables or secret-management mechanisms.
- Provide `.env.example` files with placeholders only.

---

## 14. Non-Functional Requirements

### 14.1 Progressive Web Application

| Requirement | Detail |
|---|---|
| Web App Manifest | Present for installability |
| Service Worker | Registered for caching and offline shell |
| Responsive layout | Desktop and mobile browser adaptation |
| Receipt capture | File selection + camera capture (where browser-supported) |
| Offline claims | Core workflow requires backend connectivity; no complex offline sync |

### 14.2 Error Handling

| Scenario | Behavior |
|---|---|
| OCR failure | Inform user, preserve receipt, allow retry/manual correction |
| AI service unavailable | Graceful fallback, do not fabricate data |
| Missing account mapping | Flag for finance review, do not invent an account |
| Unbalanced journal entry | Reject finalization, show validation error |
| Unauthorized request | Reject, do not leak protected information |

### 14.3 Performance & Scalability

- Docker Compose for reproducible environments.
- PostgreSQL connection pooling with leakage prevention.
- No unnecessary infrastructure services (no Kubernetes, Kafka, Redis, RabbitMQ unless approved).

---

## 15. API Design

### 15.1 REST Conventions

All APIs use REST with JSON payloads. Example endpoint structure:

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | Authentication (login, identity) |
| `/api/users/*` | User management |
| `/api/expenses/*` | Expense CRUD and workflow |
| `/api/receipts/*` | Receipt upload and retrieval |
| `/api/policies/*` | Policy configuration and validation |
| `/api/approvals/*` | Manager approval actions |
| `/api/finance-batches/*` | Finance batch operations |
| `/api/journal-entries/*` | Journal entry generation and review |
| `/api/export/*` | Data export (CSV, integrations) |

### 15.2 Authorization Chain

Every protected endpoint enforces:

```
Authentication → Tenant Authorization → Role Authorization → Resource Authorization
```

---

## 16. Database Design

### 16.1 Core Entities

| Entity | Purpose |
|---|---|
| `tenants` | Subscribing companies |
| `users` | User accounts belonging to tenants |
| `expenses` | Employee expense claims |
| `receipts` | Uploaded receipt images and metadata |
| `policies` | Configurable expense policy rules |
| `approvals` | Manager approval decisions |
| `audit_logs` | Immutable action audit trail |
| `finance_batches` | Grouped approved expenses for finance review |
| `journal_entries` | Accounting journal entries |
| `journal_entry_lines` | Individual debit/credit lines |
| `account_mappings` | Expense category → accounting account mappings |

### 16.2 Design Principles

- Referential integrity with appropriate foreign keys.
- Appropriate indexes for query performance.
- Tenant ownership enforced on every business entity.
- UUIDv4 primary keys (via `gen_random_uuid()`) to prevent sequential enumeration.
- Deterministic SQL migrations managed by `schema_migrations` catalog.
- Every important field has a clear, documented purpose.

---

## 17. Testing Strategy

### 17.1 Test Coverage Areas

| Area | Tests |
|---|---|
| **PWA** | Responsive layout, installability, receipt upload, mobile-browser behavior |
| **Authentication** | Login, invalid credentials, protected routes, session/token handling |
| **RBAC** | Employee/Manager/Finance restrictions verified on the backend |
| **Multi-Tenancy** | Tenant isolation, cross-tenant access attempts, cross-tenant modification |
| **OCR** | Valid receipt, poor-quality receipt, missing fields, invalid file, unsupported format |
| **AI** | Valid structured output, invalid AI output, missing fields, low confidence, service failure |
| **Policy** | Valid expense, amount-limit violation, restricted category, missing receipt |
| **Duplicate Detection** | Exact duplicate, similar receipt, legitimate repeated expense |
| **Approval** | Approve, reject, request correction, invalid state transitions |
| **Finance Batches** | Approved inclusion, rejected exclusion, duplicate prevention, tenant isolation |
| **Journal Entries** | Balanced entry, unbalanced entry, missing mapping, duplicate generation |
| **Export** | Empty dataset, single/multiple expenses, large dataset, unauthorized/cross-tenant export |

---

## 18. Out of Scope

The following are explicitly **out of scope** for the current MVP and must not be implemented without explicit project-owner approval:

- Native Android, iOS, React Native, or Flutter applications
- Banking infrastructure or guaranteed payment settlement
- Automated employee payouts
- Tax filing functionality
- Custom enterprise ERP features
- Corporate card feeds
- Advanced analytics platform
- Multi-currency support
- Kubernetes, Kafka, Redis, or RabbitMQ infrastructure
- Unnecessary microservices or cloud infrastructure
- Complex offline synchronization

Future extensions mentioned in the project synopsis must not automatically be implemented in the current MVP.

---

## 19. Implementation Roadmap

Development follows an incremental checkpoint process. Each checkpoint must be completed, tested, and verified before proceeding.

| Checkpoint | Scope | Status |
|---|---|---|
| **CP-0** | Repository & Project Foundation (React PWA, Node/Express, FastAPI, PostgreSQL, Docker Compose, health endpoints) | ✅ Complete |
| **CP-1** | Database + Multi-Tenancy (schema, RLS, migrations, tenant isolation, unprivileged app role) | ✅ Complete |
| **CP-2** | Authentication + RBAC (bcrypt, JWT HS256, authenticate/requireRole middleware, login/me endpoints) | ✅ Complete |
| **CP-3** | Receipt Capture + OCR (file upload, camera capture, file validation, image preprocessing, Tesseract OCR) | 🔲 Pending |
| **CP-4** | AI Receipt Understanding (structured extraction, categorization, confidence, similarity) | 🔲 Pending |
| **CP-5** | Policy + Duplicate Validation (deterministic policies, configurable limits, duplicate/similarity detection) | 🔲 Pending |
| **CP-6** | Approval Workflow (SUBMITTED → PROCESSING → VALIDATION → PENDING_APPROVAL → APPROVED/REJECTED/CORRECTION_REQUESTED → FINANCE) | 🔲 Pending |
| **CP-7** | Finance Batches (batch creation, approved-expense grouping, finance review, audit) | 🔲 Pending |
| **CP-8** | Journal Entries (account mapping, journal entry generation, balance validation, finalization) | 🔲 Pending |
| **CP-9** | CSV + Accounting Integration (CSV export, QuickBooks/Xero integration points) | 🔲 Pending |
| **CP-10** | Security + Testing Audit (comprehensive security review, vulnerability testing, regression) | 🔲 Pending |
| **CP-11** | Final End-to-End Audit (full workflow verification, gap analysis, final report) | 🔲 Pending |

---

## 20. Current Implementation Status

As of the latest verified checkpoint (Checkpoint 2), the following is implemented and tested:

### Implemented & Verified

- **Four-service architecture**: React PWA, Node.js + Express backend, Python + FastAPI AI service, PostgreSQL — all running via Docker Compose.
- **Deterministic migration system**: `database/migrator.js` with `schema_migrations` catalog.
- **Multi-tenant schema**: `tenants` and `users` tables with UUIDv4 PKs, foreign keys, and constraints.
- **PostgreSQL RLS**: Forced on tenant-scoped tables, with `tenant_isolation_policy` using transaction-local session variables.
- **Unprivileged application role**: `expensease_app` (`NOSUPERUSER NOBYPASSRLS`) for realistic RLS enforcement.
- **Connection pool safety**: `withTenantContext(tenantId, callback)` with `SET LOCAL ROLE` and `set_config` for zero-leakage.
- **Authentication**: bcrypt password hashing (saltRounds=12), JWT (HS256 pinned, fail-fast secret), `POST /api/auth/login`, `GET /api/auth/me`.
- **RBAC middleware**: `authenticate.js` (JWT-only identity), `requireRole.js` (EMPLOYEE, MANAGER, FINANCE).
- **Automated tests**: 42 tests across 5 suites (auth, multiTenancy, health, readiness, database).

### Pending (Checkpoints 3–11)

- Receipt capture, upload, and OCR processing
- AI-assisted extraction, categorization, and duplicate detection
- Deterministic policy validation engine
- Manager approval workflow with state transitions
- Finance Batch creation, review, and management
- Journal entry generation, balance validation, and finalization
- CSV export and accounting system integration points
- Comprehensive security and end-to-end audits
