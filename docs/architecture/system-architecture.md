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

## Component Roles (Checkpoint 0 Foundation)

1. **React Frontend (Progressive Web Application)**
   - Single React-based PWA for both desktop and mobile browsers.
   - Provides Web App Manifest and Service Worker foundation for installability and responsive layout.
   - Communicates with the primary backend exclusively over REST/JSON.

2. **Primary Backend (Node.js + Express)**
   - Primary application server orchestrating business APIs, database access, and inter-service communication.
   - Exposes standard REST endpoints including foundational health and readiness checks.
   - Connects directly to PostgreSQL with connection pooling.

3. **AI Service (Python + FastAPI)**
   - Dedicated service for AI and document processing workloads.
   - Exposes RESTful endpoints for future OCR and machine learning tasks.
   - AI output is strictly assistive; at Checkpoint 0, only service liveness (`/health`) is established.

4. **Database (PostgreSQL)**
   - Relational database for persistent transactional data.
   - At Checkpoint 0, only database connectivity via Docker Compose is established without application tables or seed data.

## Communication Patterns

- **Frontend to Backend**: REST / JSON over HTTP.
- **Backend to AI Service**: REST / JSON over HTTP.
- **Backend to Database**: Direct TCP connection via PostgreSQL client pool (`pg`).
- **Tenancy & Isolation**: Handled centrally at backend and database layers (PostgreSQL Row-Level Security planned for Checkpoint 1).
