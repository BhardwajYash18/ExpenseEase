# EXPENSEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

ExpensEase is a B2B expense-management platform for small and mid-sized businesses (SMBs). The application is delivered as a single responsive Progressive Web Application (PWA) for desktop and mobile browsers, backed by a Node.js API orchestrator, a dedicated Python document processing service, and PostgreSQL.

> **Current Status**: `CHECKPOINT 3 — RECEIPT CAPTURE + OCR COMPLETED`
>
> Checkpoints 0, 1, 2, and 3 are fully implemented, verified, and tested. The project foundation, deterministic database migrations, PostgreSQL Row-Level Security (RLS) multi-tenancy model, bcrypt password hashing, HS256-pinned JWT authentication, strict RBAC authorization, and the receipt capture & Tesseract OCR pipeline are complete.
>
> In accordance with `AGENTS.md`, later-stage business workflows (AI/VLM receipt understanding and structured field extraction, deterministic policy validation, duplicate detection, approval workflows, Finance Batches, Journal Entries, and CSV export) are intentionally deferred to subsequent checkpoints.

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
       Document/OCR Service
```

- **Frontend (`frontend/`)**: React-based responsive Progressive Web Application (PWA) with Web App Manifest, Service Worker support, device camera capture, and file upload interface.
- **Primary Backend (`backend/`)**: Node.js + Express REST API orchestrator handling authentication, authorization (RBAC), receipt file validation with magic bytes, secure storage abstraction, multi-tenant context management, database access, and OCR dispatch.
- **Document/OCR Service (`ai-service/`)**: Dedicated Python + FastAPI service for deterministic image preprocessing (OpenCV, Pillow) and Tesseract OCR raw text extraction. *(AI/LLM structured field understanding is deferred to Checkpoint 4).*
- **Database (`database/`)**: PostgreSQL relational database managed via Docker Compose with deterministic SQL migrations, non-privileged application role, and Row-Level Security (RLS).

---

## Technology Stack

- **Frontend**: React 18, Vite, Vanilla CSS, Web App Manifest, Service Worker, Concurrently.
- **Primary Backend**: Node.js (v18+), Express 4, `pg` (PostgreSQL client pool), `bcryptjs` (saltRounds=12), `jsonwebtoken` (HS256 pinned), `multer`, `form-data`, `axios`, `express-validator`, Helmet, CORS, Dotenv.
- **Document/OCR Service**: Python 3.11+, FastAPI, Uvicorn, Pillow, OpenCV (headless), Pytesseract (Tesseract OCR), Pydantic.
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

---

## Repository Structure

```
ExpensEase/
│
├── frontend/                     # React Responsive PWA
│   ├── public/                   # Static assets, manifest.json, sw.js
│   ├── src/
│   │   ├── components/           # ReceiptCapture.jsx, ReceiptView.jsx
│   │   ├── App.jsx               # Main application shell with auth & receipt flows
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
│   │   ├── controllers/          # authController.js, receiptController.js
│   │   ├── middleware/           # authenticate.js, requireRole.js, errorHandler.js
│   │   ├── routes/               # health.js, auth.js, receipts.js
│   │   ├── services/             # authService.js, storageService.js, receiptService.js
│   │   ├── utils/                # fileValidation.js (magic bytes & sanitization)
│   │   └── app.js                # Express app setup and route mounting
│   ├── tests/                    # Jest test suites (receipts, auth, multiTenancy, database, etc.)
│   ├── Dockerfile
│   └── package.json
│
├── ai-service/                   # Python + FastAPI Document & OCR Service
│   ├── app/
│   │   ├── api/                  # health.py, ocr.py
│   │   ├── core/                 # config.py (Pydantic settings)
│   │   ├── processors/           # image_preprocessor.py (OpenCV / Pillow)
│   │   ├── services/             # ocr_service.py (Tesseract OCR extraction)
│   │   └── main.py               # FastAPI application entry point
│   ├── tests/                    # Pytest test suite (test_ocr.py, test_health.py)
│   ├── Dockerfile                # Installs tesseract-ocr system packages
│   └── requirements.txt
│
├── database/                     # Database scripts & schema
│   ├── migrations/               # Deterministic SQL migrations:
│   │   ├── 001_create_tenants_and_users.sql
│   │   ├── 002_create_app_role.sql
│   │   └── 003_create_receipts.sql
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
| **AI Service** | `GET` | `/health` | No | Any | AI service liveness check |
| **AI Service** | `POST` | `/ocr/extract` | No (Internal) | Any | Accepts multipart image, runs preprocessing & Tesseract OCR |
| **Frontend** | `GET` | `/` | No | Any | Responsive PWA shell with camera/file capture & preview |

---

## Testing

All test suites run in automated CI-ready test runners:

### Backend Tests (60 tests across 6 suites)
```bash
cd backend
npm test
```
Tests cover:
- Health and readiness endpoints (`health.test.js`, `readiness.test.js`)
- Database pool connectivity and schema verification (`database.test.js`)
- Multi-tenancy RLS isolation, constraint violations, and pool context isolation (`multiTenancy.test.js`)
- Password hashing, JWT signing, HS256 pinning, tampering/expiration rejection, and RBAC (`auth.test.js`)
- Receipt file validation, magic byte spoofing detection, PDF rejection, strict EMPLOYEE upload RBAC, RLS receipt isolation, file streaming, OCR text retrieval, and OCR failure resilience (`receipts.test.js`)

### AI / Document Service Tests (6 tests)
```bash
cd ai-service
pytest
```
Tests cover:
- Service liveness (`test_health.py`)
- Image preprocessing with valid and corrupted images (`test_ocr.py`)
- Tesseract OCR extraction resilience and structured response schema
- OCR API endpoint file upload validation and empty file rejection

### Frontend Production Build
```bash
cd frontend
npm run build
```
Verifies clean compilation of the PWA bundle via Vite.

---

## Next Steps

Following the incremental development process in `AGENTS.md`, work will proceed to:

- **Checkpoint 4 — AI Receipt Understanding**: Python/FastAPI AI layer for structured field extraction (merchant, transaction date, amount, taxes, line items), semantic categorization assistance, confidence scoring, and strict AI output schema validation. *(AI output remains assistive; deterministic business code validates all data).*
