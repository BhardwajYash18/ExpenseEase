-- Migration: 009_create_export_audit.sql
-- Description: Create export_audit_logs table for tracking CSV export and accounting integrations
-- Checkpoint 9 — CSV Export + QuickBooks/Xero Integration Points

-- 1. Export Audit Logs Table (Append-Only Audit Trail)
-- Captures WHO, WHAT, WHEN, and WHICH RESOURCE for export and integration actions (PRD FR-12.2, FR-12.3; AGENTS.md Sec 17).
CREATE TABLE IF NOT EXISTS export_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role VARCHAR(32) NOT NULL,
    export_type VARCHAR(32) NOT NULL
        CHECK (export_type IN ('CSV', 'QUICKBOOKS', 'XERO')),
    resource_type VARCHAR(32) NOT NULL
        CHECK (resource_type IN ('JOURNAL_ENTRY', 'FINANCE_BATCH', 'ALL_JOURNAL_ENTRIES')),
    resource_id UUID,
    record_count INTEGER NOT NULL DEFAULT 0,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Indexes for Performance and RLS Filtering
CREATE INDEX IF NOT EXISTS idx_export_audit_tenant ON export_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_export_audit_actor ON export_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_export_audit_type ON export_audit_logs(export_type);
CREATE INDEX IF NOT EXISTS idx_export_audit_resource ON export_audit_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_export_audit_created ON export_audit_logs(created_at);

-- 3. Row-Level Security (RLS)
ALTER TABLE export_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_audit_logs FORCE ROW LEVEL SECURITY;

-- 4. Tenant Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_policy ON export_audit_logs;
CREATE POLICY tenant_isolation_policy ON export_audit_logs
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 5. Grant Permissions to Unprivileged Application Role
GRANT SELECT, INSERT ON export_audit_logs TO expensease_app;
