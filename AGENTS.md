# AGENTS.md — ExpenseEase Project Instructions

## 1. PROJECT IDENTITY

Project Name:

EXPENSEEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

The project name MUST NEVER be changed, abbreviated, renamed, or replaced.

ExpenseEase is a B2B expense-management platform for small and mid-sized businesses.

The current application is a RESPONSIVE PROGRESSIVE WEB APPLICATION (PWA).

It is NOT a native Android application, native iOS application, React Native application, or Flutter application.

The current scope uses a single React-based PWA frontend for desktop and mobile browsers.

---

# 2. SOURCE OF TRUTH

The primary sources of truth are:

1. The approved ExpenseEase project synopsis.
2. Explicit instructions provided by the project owner.
3. Existing approved implementation in the repository.
4. Approved architectural decisions documented in this file.

Do NOT invent requirements.

Do NOT assume that a feature should exist simply because it is common in expense-management software.

Do NOT add functionality merely because it would be "useful", "modern", "enterprise-grade", or "best practice".

If a requirement is not specified:

- Identify the ambiguity.
- Explain why a decision is required.
- Propose the smallest reasonable implementation.
- Clearly label it as an ASSUMPTION or PROPOSED DECISION.
- Ask for approval when the decision materially affects architecture, security, accounting, data models, or user-facing behavior.

Do not silently convert assumptions into requirements.

---

# 3. CURRENT PROJECT SCOPE

The current ExpenseEase scope includes:

- Responsive PWA frontend
- Employee expense submission
- Receipt upload
- Receipt capture using device camera where supported
- OCR-based receipt text extraction
- AI-assisted receipt understanding
- Structured receipt-field extraction
- AI-assisted expense categorization
- Similarity-based duplicate detection
- Deterministic policy validation
- Employee / Manager / Finance workflow
- Manager approval, rejection, and correction requests
- Multi-tenancy
- Role-Based Access Control (RBAC)
- PostgreSQL Row-Level Security (RLS)
- Auditability
- Finance Batches
- Finance review
- Accounting-style Journal Entry generation
- Deterministic account mapping
- Balanced journal-entry validation
- CSV export
- QuickBooks/Xero integration points
- Docker/Docker Compose
- Git/GitHub
- Automated and manual testing

---

# 4. EXPLICITLY OUT OF CURRENT SCOPE

Do NOT implement the following unless explicitly approved:

- Native Android application
- Native iOS application
- React Native application
- Flutter application
- Banking infrastructure
- Guaranteed payment settlement
- Automated employee payouts
- Tax filing
- Custom enterprise ERP
- Corporate card feeds
- Advanced analytics platform
- Multi-currency support
- Kubernetes
- Kafka
- Redis
- RabbitMQ
- Unnecessary microservices
- Unnecessary cloud infrastructure

Future extensions mentioned in the synopsis must NOT automatically be implemented in the current MVP.

---

# 5. TECHNOLOGY STACK

## Frontend

React.js

The frontend must be implemented as a responsive Progressive Web Application.

PWA requirements include:

- Web App Manifest
- Service Worker
- Installability
- Responsive desktop layout
- Responsive mobile-browser layout
- Appropriate client-side caching

Do NOT create a separate mobile application.

---

## Primary Backend

Node.js + Express.js

The Node.js backend is the primary application backend and should handle:

- Authentication
- Authorization
- Expense management
- Workflow management
- Policy validation
- Duplicate-detection orchestration
- Finance Batches
- Journal Entries
- CSV export
- Integration orchestration
- Audit logging
- Communication with the AI service

---

## AI Service

Python + FastAPI

The Python service is a dedicated AI/document-processing service.

It may handle:

- Image preprocessing
- OCR orchestration where appropriate
- Receipt understanding
- Structured extraction
- Categorization assistance
- Similarity-based duplicate detection

The Python service must expose well-defined APIs and structured responses.

---

## Database

PostgreSQL

Use PostgreSQL for persistent transactional data.

PostgreSQL Row-Level Security (RLS) must be used to enforce tenant isolation.

---

## OCR

Use:

- Tesseract OCR

or

- An approved cloud OCR provider

Do not introduce a cloud OCR provider without documenting the dependency and configuration requirements.

---

## Image Processing

Use:

- OpenCV
- Pillow

Only introduce additional image-processing libraries when technically necessary.

---

## AI / LLM / VLM

An LLM or Vision-Language Model may be used for:

- Receipt understanding
- Structured field extraction
- Semantic categorization assistance
- Similarity/semantic analysis

AI output is NOT authoritative.

All AI-generated values must be validated before entering trusted application state.

---

## API Communication

Use REST APIs with JSON for:

React PWA
        ↓
Node.js / Express
        ↓
Python / FastAPI

Do not introduce GraphQL or another API architecture unless explicitly approved.

---

## Authentication / Authorization

Use secure authentication with JWT or another approved secure session mechanism.

Use RBAC for:

- EMPLOYEE
- MANAGER
- FINANCE

Do not invent additional business roles without approval.

---

## Infrastructure

Use:

- Docker
- Docker Compose

Docker is for reproducible development and deployment environments.

Do NOT add unnecessary infrastructure services.

---

## Version Control

Use:

- Git
- GitHub

Make small, meaningful commits.

---

# 6. CORE EXPENSE WORKFLOW

The intended end-to-end workflow is:

Employee
    ↓
Receipt Capture
    ↓
Receipt Upload
    ↓
OCR
    ↓
AI Understanding
    ↓
Employee Confirmation
    ↓
Policy Validation
    ↓
Duplicate / Similarity Check
    ↓
Manager Review
    ↓
Approve / Reject / Request Correction
    ↓
Finance Batch
    ↓
Finance Review
    ↓
Journal Entry Generation
    ↓
Balance Validation
    ↓
CSV Export / QuickBooks / Xero

This workflow must remain logically consistent throughout the implementation.

Do not remove or bypass major stages without explicit approval.

---

# 7. AI SAFETY AND RESPONSIBILITY

AI is an ASSISTIVE component, not the final authority.

The principle is:

AI UNDERSTANDS AND SUGGESTS.
DETERMINISTIC CODE VALIDATES.
AUTHORIZED HUMANS DECIDE.
ACCOUNTING LOGIC RECORDS.

AI MUST NOT independently:

- Approve an expense
- Reject an expense
- Make the final policy-violation decision
- Invent accounting accounts
- Invent debit/credit entries
- Modify accounting balances
- Bypass authorization
- Access another tenant's data
- Directly perform financial settlement
- Override deterministic business rules

---

# 8. AI OUTPUT VALIDATION

Never trust raw AI output.

Every AI response must be:

1. Parsed.
2. Schema validated.
3. Type validated.
4. Sanitized.
5. Checked for missing or invalid fields.
6. Checked against application/business constraints.

If confidence is insufficient:

Return:

- null
- unknown
- low-confidence flag

rather than fabricating information.

Never instruct an AI model to "guess" missing receipt information.

Example:

BAD:

AI:
"Receipt date is probably 12/09/2026."

GOOD:

AI:
"Date: null"
"confidence: low"
"needs_review: true"

---

# 9. OCR RULES

OCR output must be treated as untrusted extracted data.

Never assume OCR is correct.

The system should gracefully handle:

- Blurry receipts
- Rotated receipts
- Partial receipts
- Missing fields
- Poor lighting
- Handwritten/unclear information
- Unsupported formats
- Corrupt files

Preserve the original receipt.

Maintain a distinction between:

Original Receipt
    ↓
OCR Output
    ↓
AI Extraction
    ↓
User-Confirmed Data

Do not silently overwrite the original receipt.

---

# 10. POLICY VALIDATION

Policy validation must primarily be deterministic.

Examples include:

- Expense amount limits
- Restricted categories
- Missing receipts
- Configured exceptions
- Other explicitly configured policy rules

Do NOT use an LLM as the final policy decision-maker.

AI may identify or suggest relevant information, but deterministic application rules must make the final validation result.

Policy values must come from approved configuration/database values.

Do not invent policy limits.

---

# 11. DUPLICATE DETECTION

Duplicate detection may use similarity-based analysis.

Relevant signals can include:

- Employee
- Merchant
- Amount
- Date
- Receipt text
- Expense description
- Similarity score

The system should identify POTENTIAL duplicates.

Do not automatically reject or delete an expense solely because an AI/similarity model reports a high similarity score unless an explicit deterministic business rule requires it.

Potential duplicates should be available for human review.

---

# 12. MULTI-TENANCY

ExpenseEase is a multi-tenant system.

Every tenant's data must remain isolated.

Tenant isolation must be enforced at the backend and database levels.

Use PostgreSQL Row-Level Security where applicable.

Never trust:

- Frontend tenant IDs
- User-supplied tenant IDs
- URL parameters
- Request body tenant IDs
- AI-provided tenant information

The authenticated user's tenant context must be established securely by the backend.

A user from Tenant A must never be able to:

- Read Tenant B data
- Modify Tenant B data
- Delete Tenant B data
- Access Tenant B receipts
- Access Tenant B finance batches
- Access Tenant B journal entries
- Access Tenant B audit logs

Test cross-tenant access explicitly.

---

# 13. RBAC

The current business roles are:

## EMPLOYEE

Can:

- Create expenses
- Upload receipts
- View own expenses
- Confirm extracted information
- Correct returned expenses
- Submit expenses

## MANAGER

Can:

- Review submitted expenses
- View supporting receipts
- Review extracted information
- Approve expenses
- Reject expenses
- Request corrections

## FINANCE

Can:

- Review approved expenses
- Create/review Finance Batches
- Review finance records
- Generate Journal Entries
- Export accounting data
- Use approved accounting integrations

Authorization must be enforced on the backend.

Never rely solely on hiding buttons or pages in React.

---

# 14. FINANCE BATCHES

Finance Batches are a REQUIRED part of the project.

Do NOT replace Finance Batches with Journal Entries.

The relationship is:

Approved Expenses
        ↓
Finance Batch
        ↓
Finance Review
        ↓
Journal Entry / Export

Finance Batches should group approved expenses for finance review and audit.

A Finance Batch must NOT contain:

- Rejected expenses
- Unapproved expenses
- Expenses belonging to another tenant
- The same expense multiple times unless explicitly supported by a defined business rule

If journal-entry generation fails, Finance Batches must still remain usable.

Journal Entries are an additional accounting layer after Finance Batches.

---

# 15. JOURNAL ENTRY RULES

Journal entries must be generated using deterministic account mappings.

The correct architecture is:

Expense Category
        ↓
Configured Account Mapping
        ↓
Accounting Account
        ↓
Journal Entry Line

The LLM MUST NOT invent accounting accounts.

The LLM MUST NOT decide debit/credit balances.

Every finalized journal entry must satisfy:

TOTAL DEBITS = TOTAL CREDITS

If:

TOTAL DEBITS != TOTAL CREDITS

the journal entry MUST NOT be finalized.

Missing account mappings must result in an explicit error or review state.

Journal entries should be reviewable before finalization/export where required by the workflow.

---

# 16. ACCOUNTING INTEGRITY

Accounting calculations must use deterministic application logic.

Do not rely on:

- LLM arithmetic
- LLM-generated totals
- AI-generated balances
- Unvalidated floating-point calculations

Use appropriate numeric/decimal handling for monetary values.

Do not silently round monetary values in a way that can create an imbalance.

Every journal entry must be validated before finalization.

---

# 17. AUDITABILITY

Important actions must be auditable.

Examples:

- Expense creation
- Receipt upload
- Extraction changes
- User confirmation
- Policy validation
- Duplicate flags
- Manager decisions
- Correction requests
- Finance Batch creation
- Finance review
- Journal Entry generation
- Journal Entry finalization
- Export/integration actions

Audit records should preserve enough information to understand:

WHO
WHAT
WHEN
AND
WHICH RESOURCE

was affected.

Do not allow users to silently rewrite historical audit records.

---

# 18. SECURITY REQUIREMENTS

Always consider:

- Authentication
- Authorization
- RBAC
- Tenant isolation
- PostgreSQL RLS
- IDOR
- SQL injection
- Unsafe queries
- File-upload security
- File-type validation
- File-size validation
- Path traversal
- CORS
- Rate limiting where appropriate
- Error-information leakage
- Secret management
- API security
- AI prompt injection
- OCR-generated malicious input
- Cross-tenant AI context leakage

Never hardcode:

- API keys
- Passwords
- Database credentials
- Tokens
- Secrets

Use environment variables or an appropriate secret-management mechanism.

Provide `.env.example` files containing placeholders, never real secrets.

---

# 19. PWA REQUIREMENTS

The frontend must remain a responsive PWA.

The PWA should work across:

- Desktop browsers
- Mobile browsers

The UI should adapt to smaller screens.

Receipt capture should support:

- File selection
- Camera capture where supported by the browser/device

Do not claim native mobile capabilities that the browser does not provide.

Offline functionality must not be overstated.

The core server-side expense workflow requires backend connectivity.

Do not implement complex offline synchronization unless explicitly required and approved.

---

# 20. API DESIGN

Use clear REST endpoints.

Examples may include:

/api/auth/*
/api/users/*
/api/expenses/*
/api/receipts/*
/api/policies/*
/api/approvals/*
/api/finance-batches/*
/api/journal-entries/*
/api/export/*

These are examples, not mandatory exact endpoint names.

Choose consistent REST conventions.

Every protected endpoint must enforce:

Authentication
    ↓
Tenant authorization
    ↓
Role authorization
    ↓
Resource authorization

Do not expose internal database structures unnecessarily through APIs.

---

# 21. DATABASE DESIGN

Database design should maintain:

- Referential integrity
- Appropriate foreign keys
- Appropriate indexes
- Tenant ownership
- Auditability
- Data consistency

Potential core entities include:

- tenants
- users
- roles
- expenses
- receipts
- policies
- approvals
- audit_logs
- finance_batches
- journal_entries
- journal_entry_lines
- account_mappings

Do not create large numbers of unnecessary tables.

Do not create fields merely because another expense platform has them.

Every important field should have a clear purpose.

---

# 22. ERROR HANDLING

Errors must be explicit and useful.

Do not hide failures.

Do not silently continue after critical failures.

Examples:

OCR failure
→ Inform user
→ Preserve receipt
→ Allow retry/manual correction

AI service unavailable
→ Graceful fallback
→ Do not fabricate data

Missing account mapping
→ Flag for finance review
→ Do not invent an account

Unbalanced journal
→ Reject finalization
→ Show validation error

Unauthorized request
→ Reject request
→ Do not leak protected information

---

# 23. TESTING

Testing must be implemented progressively.

At minimum, test:

## PWA

- Responsive layout
- Installability
- Receipt upload
- Mobile-browser behavior

## Authentication

- Login
- Invalid credentials
- Protected routes
- Session/token handling

## RBAC

- Employee restrictions
- Manager restrictions
- Finance restrictions

## Multi-tenancy

- Tenant isolation
- Cross-tenant access attempts
- Cross-tenant modification attempts

## OCR

- Valid receipt
- Poor-quality receipt
- Missing fields
- Invalid file
- Unsupported format

## AI

- Valid structured output
- Invalid AI output
- Missing fields
- Low confidence
- AI service failure

## Policy

- Valid expense
- Amount-limit violation
- Restricted category
- Missing receipt

## Duplicate detection

- Exact duplicate
- Similar receipt
- Legitimate repeated expense

## Approval

- Approve
- Reject
- Request correction
- Invalid state transitions

## Finance Batch

- Approved expense inclusion
- Rejected expense exclusion
- Duplicate inclusion prevention
- Tenant isolation

## Journal Entries

- Balanced entry
- Unbalanced entry
- Missing mapping
- Duplicate generation
- Multiple expense categories

## Export

- Empty dataset
- Single expense
- Multiple expenses
- Large dataset
- Unauthorized export
- Cross-tenant export attempt

---

# 24. DEVELOPMENT RULES

Prefer:

- Small changes
- Modular code
- Clear naming
- Reusable services
- Input validation
- Consistent error handling
- Automated tests
- Meaningful logs
- Minimal dependencies
- Clear documentation

Avoid:

- Giant files
- Duplicate business logic
- Hardcoded business rules
- Hardcoded secrets
- Dead code
- Unnecessary dependencies
- Unnecessary abstractions
- Premature optimization
- Unnecessary architectural complexity

Do not rewrite working code without a reason.

Do not perform unrelated refactoring while implementing a feature.

---

# 25. DEPENDENCY RULE

Before adding a new dependency:

1. Determine whether the existing stack can solve the problem.
2. Determine whether the dependency is actually required.
3. Check whether it introduces security or maintenance concerns.
4. Use the smallest appropriate dependency.
5. Document why it was added.

Do not add dependencies simply because they are popular.

---

# 26. GIT RULES

Use meaningful commits.

Examples:

chore: initialize ExpenseEase project
feat: add receipt upload
feat: implement expense workflow
feat: add OCR processing
feat: add AI receipt extraction
feat: implement finance batches
feat: add journal entry generation
test: add expense workflow tests
fix: prevent cross-tenant expense access

Avoid vague commits such as:

"stuff"
"changes"
"updated"
"fixed things"

Do not rewrite Git history unless explicitly instructed.

---

# 27. CHECKPOINT DEVELOPMENT PROCESS

Development must happen incrementally.

Do NOT attempt to build the entire application in one step.

For every checkpoint:

1. Inspect the current implementation.
2. Identify what the checkpoint requires.
3. Implement only that checkpoint.
4. Run relevant tests.
5. Check for regressions.
6. Report what changed.
7. Report tests performed and their results.
8. Report assumptions.
9. STOP.

Do not automatically continue to the next checkpoint.

---

# 28. DEVELOPMENT CHECKPOINTS

## CHECKPOINT 0 — Repository & Project Foundation

Establish:

- Git repository
- Project structure
- React PWA
- Node.js/Express backend
- Python/FastAPI service
- PostgreSQL
- Docker/Docker Compose
- Environment configuration
- Basic service communication
- AGENTS.md
- README.md

At the end, all services should start successfully.

Do NOT implement business functionality yet.

---

## CHECKPOINT 1 — Database + Multi-Tenancy

Implement:

- PostgreSQL schema
- Core entities
- Relationships
- Tenant ownership
- Row-Level Security
- Migrations
- Required indexes
- Database constraints

Verify cross-tenant isolation.

STOP after completion and verification.

---

## CHECKPOINT 2 — Authentication + RBAC

Implement:

- Authentication
- Employee role
- Manager role
- Finance role
- Backend authorization
- Protected routes
- Tenant-aware authorization

Test unauthorized access.

STOP after completion and verification.

---

## CHECKPOINT 3 — Receipt Capture + OCR

Implement:

Receipt Upload
    ↓
File Validation
    ↓
Image Processing
    ↓
OCR
    ↓
Extracted Text

Support receipt capture/upload through the PWA.

Preserve the original receipt.

STOP after OCR functionality and tests are verified.

---

## CHECKPOINT 4 — AI Receipt Understanding

Implement the Python/FastAPI AI layer for:

- Structured extraction
- Receipt understanding
- Categorization assistance
- Confidence information
- Similarity assistance where appropriate

Validate all AI output.

Do not allow AI to make final business decisions.

STOP after verification.

---

## CHECKPOINT 5 — Policy + Duplicate Validation

Implement:

- Deterministic policy validation
- Configurable limits
- Restricted categories
- Missing-receipt checks
- Duplicate/similarity detection
- Human-review flags

STOP after tests pass.

---

## CHECKPOINT 6 — Approval Workflow

Implement:

SUBMITTED
    ↓
PROCESSING
    ↓
VALIDATION
    ↓
PENDING_APPROVAL
    ↓
APPROVED / REJECTED / CORRECTION_REQUESTED
    ↓
FINANCE

Record workflow transitions in the audit history.

STOP after verification.

---

## CHECKPOINT 7 — Finance Batches

Implement:

- Finance Batch creation
- Approved-expense grouping
- Finance review
- Batch status
- Audit history
- Tenant isolation
- Duplicate-inclusion prevention

Do NOT replace Finance Batches with Journal Entries.

STOP after verification.

---

## CHECKPOINT 8 — Journal Entries

Implement:

Finance Batch
    ↓
Account Mapping
    ↓
Journal Entry
    ↓
Balance Validation
    ↓
Review
    ↓
Finalize

Enforce:

TOTAL DEBIT = TOTAL CREDIT

Use deterministic account mappings.

STOP after verification.

---

## CHECKPOINT 9 — CSV + Accounting Integration

Implement:

- CSV export
- Accounting-ready data
- QuickBooks integration point
- Xero integration point

External integrations may depend on provider APIs and sandbox credentials.

Do not block the MVP on unavailable external credentials.

STOP after verification.

---

## CHECKPOINT 10 — Security + Testing

Perform a dedicated security and testing audit.

Check:

- Authentication
- RBAC
- IDOR
- Tenant isolation
- RLS
- SQL injection
- File uploads
- Path traversal
- Secrets
- API security
- AI prompt injection
- OCR input
- Error leakage
- Accounting integrity

Fix verified issues.

Do not perform unrelated refactoring.

STOP after audit.

---

## CHECKPOINT 11 — Final End-to-End Audit

Verify the complete workflow:

Employee
→ Receipt Capture
→ OCR
→ AI
→ Confirmation
→ Policy / Duplicate Check
→ Manager
→ Approval
→ Finance Batch
→ Finance Review
→ Journal Entry
→ Balance Validation
→ CSV / QuickBooks / Xero

Produce:

1. Implemented + Verified
2. Required but Missing
3. Implemented but Not Required
4. Assumptions
5. Known Limitations
6. Test Results

Do not claim a feature is complete without evidence from code, tests, schema, API behavior, or manual verification.

---

# 29. HALLUCINATION PREVENTION

When uncertain, DO NOT GUESS.

Never invent:

- Requirements
- User roles
- API endpoints
- Database fields
- Database tables
- Business rules
- Accounting rules
- Policy limits
- External services
- API credentials
- AI capabilities
- Integration behavior
- Security guarantees
- Performance guarantees

If information is missing:

UNKNOWN

Then explain what information is needed.

For material decisions:

PROPOSED DECISION:
<decision>

REASON:
<reason>

WAIT FOR APPROVAL.

---

# 30. FINAL PRINCIPLE

ExpenseEase must remain:

SIMPLE
SECURE
TENANT-ISOLATED
AUDITABLE
AI-ASSISTED
ACCOUNTING-CONSISTENT
PWA-BASED
SMB-FOCUSED

The implementation should solve the approved project requirements without unnecessary complexity.

When there is a choice between:

A larger, more complex implementation

and

A smaller implementation that completely satisfies the approved requirement,

prefer the smaller implementation.

Never sacrifice security, data isolation, accounting integrity, or correctness for convenience.