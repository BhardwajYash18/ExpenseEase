# EXPENSEASE: SMART EMPLOYEE EXPENSE MANAGEMENT PLATFORM

ExpensEase is a B2B expense-management platform for small and mid-sized businesses (SMBs). The application is delivered as a single responsive Progressive Web Application (PWA) for desktop and mobile browsers, backed by a Node.js API orchestrator, a dedicated Python document processing service, and PostgreSQL.

> **Current Status**: `CHECKPOINT 0 — PROJECT FOUNDATION`
>
> At this checkpoint, only the clean technical foundation and inter-service connectivity have been established. Business workflows (expenses, OCR text extraction, AI models, approval flows, policies, finance batches, and journal entries) are intentionally not implemented yet.

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
- **Backend (`backend/`)**: Node.js + Express REST API orchestrator handling routing, security headers, database connectivity, and inter-service routing.
- **AI Service (`ai-service/`)**: Dedicated Python + FastAPI service for document processing and assistive AI operations (scaffolded with foundational health checks).
- **Database (`database/`)**: PostgreSQL relational database managed via Docker Compose. No application tables or schema are introduced in Checkpoint 0.

---

## Technology Stack

- **Frontend**: React 18, Vite, Vanilla CSS, Web App Manifest, Service Worker.
- **Primary Backend**: Node.js (v18+), Express 4, `pg` (PostgreSQL client pool), Helmet, CORS, Dotenv.
- **AI Service**: Python 3.11+, FastAPI, Uvicorn, Pydantic.
- **Database**: PostgreSQL 16 (implemented via Docker container for local development).
- **Containerization & Orchestration**: Docker, Docker Compose.

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
│   │   ├── config/               # Environment & database configuration
│   │   ├── middleware/           # Error handling & middleware
│   │   ├── routes/               # Express routes (health & liveness)
│   │   ├── controllers/          # Business controllers (Checkpoint 1+)
│   │   ├── services/             # Core application services
│   │   ├── models/               # Data access models
│   │   ├── validators/           # Request schema validators
│   │   └── utils/                # Helper utilities
│   ├── tests/                    # Backend unit & integration tests
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
│   ├── migrations/               # Schema migrations (Checkpoint 1+)
│   └── seeds/                    # Seed scripts
│
├── tests/                        # Cross-service tests
│   ├── integration/
│   └── e2e/
│
├── docs/                         # Documentation
│   └── architecture/             # Architectural specifications
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

Copy `.env.example` to `.env` in the root directory or respective subdirectories:

```bash
cp .env.example .env
```

Default local ports:
- **Frontend**: `http://localhost:3000`
- **Backend**: `http://localhost:5000`
- **AI Service**: `http://localhost:8000`
- **PostgreSQL**: `localhost:5432`

---

## Running the Application

### Option 1: Docker Compose (Recommended)

To build and run all four services in synchronized containers:

```bash
docker compose up --build
```

To run in detached mode:

```bash
docker compose up -d
```

To shut down:

```bash
docker compose down
```

### Option 2: Local Manual Setup

#### 1. Start PostgreSQL
Run PostgreSQL via Docker:
```bash
docker compose up -d postgres
```

#### 2. Start Backend
```bash
cd backend
npm install
npm run dev
```

#### 3. Start AI Service
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

#### 4. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Foundational Health Check Endpoints

| Service | Method | Endpoint | Description |
|---|---|---|---|
| **Backend** | `GET` | `http://localhost:5000/api/health` | Foundational liveness check |
| **Backend** | `GET` | `http://localhost:5000/api/health/ready` | Readiness check (validates PostgreSQL & AI Service connectivity) |
| **AI Service** | `GET` | `http://localhost:8000/health` | Foundational liveness check |
| **Frontend** | `GET` | `http://localhost:3000/` | PWA status interface and app shell |

---

## Next Steps

Following the development rules in `AGENTS.md`, work will proceed to **Checkpoint 1 — Database + Multi-Tenancy** upon explicit approval.
