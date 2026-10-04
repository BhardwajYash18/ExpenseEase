-- Migration: 002_create_app_role.sql
-- Description: Create unprivileged application role (NOSUPERUSER, NOBYPASSRLS) for realistic PostgreSQL RLS enforcement
-- Checkpoint 1 — Database + Multi-Tenancy

-- 1. Create dedicated application role without superuser or bypassrls privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'expensease_app') THEN
        CREATE ROLE expensease_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
        ALTER ROLE expensease_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

-- 2. Grant permissions on current schema objects
GRANT CONNECT ON DATABASE expensease_db TO expensease_app;
GRANT USAGE ON SCHEMA public TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO expensease_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO expensease_app;

-- 3. Grant default privileges on future schema objects created by migration runner
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO expensease_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO expensease_app;
