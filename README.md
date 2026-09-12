# EXPENSEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

ExpensEase is a B2B expense-management platform for small and mid-sized businesses (SMBs). The application is delivered as a single responsive Progressive Web Application (PWA) for desktop and mobile browsers, backed by a Node.js API orchestrator, a dedicated Python document processing service, and PostgreSQL.

> **Current Status**: `CHECKPOINT 2 — AUTHENTICATION + RBAC COMPLETED`
>
> Checkpoints 0, 1, and 2 are fully implemented, verified, and tested. The project foundation, deterministic database migrations, PostgreSQL Row-Level Security (RLS) multi-tenancy model, bcrypt password hashing, HS256-pinned JWT authentication, and RBAC authorization are complete.
>
> In accordance with `AGENTS.md`, later-stage business workflows (receipt capture & OCR, AI extraction, deterministic policy validation, duplicate detection, approval workflows, Finance Batches, Journal Entries, and CSV export) are intentionally deferred to subsequent checkpoints.

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
             AI Service
```

- **Frontend (`frontend/`)**: React-based responsive Progressive Web Application (PWA) with Web App Manifest and Service Worker support.
- **Primary Backend (`backend/`)**: Node.js + Express REST API orchestrator handling authentication, authorization (RBAC), multi-tenant context management, security headers, database access, and inter-service communication.
- **AI Service (`ai-service/`)**: Dedicated Python + FastAPI service for document processing and assistive AI operations (scaffolded with foundational health checks).
- **Database (`database/`)**: PostgreSQL relational database managed via Docker Compose with deterministic SQL migrations, non-privileged application role, and Row-Level Security (RLS).

---

## Technology Stack

- **Frontend**: React 18, Vite, Vanilla CSS, Web App Manifest, Service Worker.
- **Primary Backend**: Node.js (v18+), Express 4, `pg` (PostgreSQL client pool), `bcryptjs` (saltRounds=12), `jsonwebtoken` (HS256 pinned), `express-validator`, Helmet, CORS, Dotenv.
- **AI Service**: Python 3.11+, FastAPI, Uvicorn, Pydantic.
- **Database**: PostgreSQL 16 (Docker container), Row-Level Security (RLS), custom `expensease_app` unprivileged role.
- **Containerization & Orchestration**: Docker, Docker Compose.

---

## Completed Milestones & Tasks

### Checkpoint 0 — Project Foundation
- [x] Established the four-service repository structure adhering strictly to `AGENTS.md`.
- [x] Implemented React PWA shell with `manifest.json`, Service Worker registration, and responsive layout.
- [x] Implemented primary Node.js + Express backend service with security headers (`helmet`), CORS, and error handling.
- [x] Implemented Python + FastAPI AI service with health endpoints.
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

---

## Repository Structure

```
ExpensEase/
│
├── frontend/                     # React Responsive PWA
│   ├── public/                   # Static assets, manifest.json, sw.js
│   ├── src/                      # React components, styles, entry points
│   ├── Dockerfile
│   └── package.json
│
├── backend/                      # Node.js + Express REST API
│   ├── src/
│   │   ├── config/               # Environment (env.js) & database (db.js)
│   │   ├── controllers/          # Business & auth controllers (authController.js)
│   │   ├── middleware/           # authenticate.js, requireRole.js, errorHandler.js
│   │   ├── routes/               # health.js, auth.js
│   │   ├── services/             # authService.js
│   │   ├── models/               # Data access models
│   │   ├── validators/           # Request schema validators
│   │   └── utils/                # Helper utilities
│   ├── tests/                    # Jest test suites (auth, multiTenancy, health, readiness, database)
│   ├── Dockerfile
│   └── package.json
│
├── ai-service/                   # Python + FastAPI AI & Document Processing
│   ├── app/
│   │   ├── api/                  # API routers (health check)
│   │   ├── core/                 # App configuration & settings
│   │   ├── services/             # Processing logic (Checkpoint 4+)
│   │   ├── models/               # Schemas & data models
│   │   ├── processors/           # Image & OCR processors
│   │   └── utils/                # Helper functions
│   ├── tests/                    # Pytest test suite
│   ├── Dockerfile
│   └── requirements.txt
│
├── database/                     # Database scripts & schema
│   ├── migrations/               # Deterministic SQL migrations (001_..., 002_...)
│   ├── seeds/                    # Seed scripts
│   └── migrator.js               # SQL migration runner
│
├── docs/                         # Documentation
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
- **Python** >= 3.10 and **pip**
- **Docker** and **Docker Compose**

---

## Environment Configuration

Copy `.env.example` to `.env` in the root directory and in `backend/`:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Ensure `JWT_SECRET` is set in your environment or `.env` file with a strong random secret.

Default local ports:
- **Frontend**: `http://localhost:3000`
- **Backend**: `http://localhost:5000`
- **AI Service**: `http://localhost:8000`
- **PostgreSQL**: `localhost:5432`

---

## Running Migrations

Database migrations are managed deterministically via:

```bash
cd backend
npm run migrate
```

This applies any pending migrations in `database/migrations/` and updates `schema_migrations`.

---

## Running the Application

### Option 1: Docker Compose (Recommended)

To build and run all four services:

```bash
docker compose up --build
```

To shut down:

```bash
docker compose down
```

### Option 2: Local Manual Setup

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

#### 4. Start AI Service
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
npm run dev
```

---

## Active API Endpoints

| Service | Method | Endpoint | Auth Required | Description |
|---|---|---|---|---|
| **Backend** | `GET` | `/api/health` | No | Liveness health check |
| **Backend** | `GET` | `/api/health/ready` | No | Readiness check (verifies PostgreSQL & AI service) |
| **Backend** | `POST` | `/api/auth/login` | No | Login endpoint: `{ email, password, slug }` → `{ token, user }` |
| **Backend** | `GET` | `/api/auth/me` | Bearer Token | Authenticated user profile |
| **AI Service** | `GET` | `/health` | No | AI service liveness check |
| **Frontend** | `GET` | `/` | No | Responsive PWA shell |

---

## Testing

All suites run in automated CI-ready test runners:

### Backend Tests (42 tests, 5 suites)
```bash
cd backend
npm test
```
Tests cover:
- Health and readiness endpoints
- Database pool connectivity
- Multi-tenancy RLS isolation, constraint violations, and pool context isolation
- Password hashing and verification
- JWT signing, HS256 pinning, tampering/expiration rejection
- Authentication & login flows (valid/invalid credentials, inactive users, bad slugs)
- RBAC middleware enforcement across `EMPLOYEE`, `MANAGER`, and `FINANCE`
- Client parameter tampering rejection

### AI Service Tests
```bash
cd ai-service
pytest
```

### Frontend Production Build
```bash
cd frontend
npm run build
```

---

## Next Steps

Following the incremental development process in `AGENTS.md`, work will proceed to:

- **Checkpoint 3 — Receipt Capture + OCR**: Receipt upload/camera capture in PWA, file validation, image processing (OpenCV/Pillow), OCR extraction orchestration (Tesseract), and receipt preservation.
