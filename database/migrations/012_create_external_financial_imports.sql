-- Migration: 012_create_external_financial_imports.sql
-- Description: Create external_financial_imports table and enable journal entries for external imports

-- 1. External Financial Imports Table
CREATE TABLE IF NOT EXISTS external_financial_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    original_filename VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL,
    total_debit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_credit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    row_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PREVIEWED'
        CHECK (status IN ('PREVIEWED', 'POSTED', 'REJECTED')),
    journal_entry_id UUID,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    raw_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_external_imports_tenant ON external_financial_imports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_external_imports_status ON external_financial_imports(status);
CREATE INDEX IF NOT EXISTS idx_external_imports_created_at ON external_financial_imports(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_imports_hash
    ON external_financial_imports(tenant_id, file_hash);

-- 2. Modify journal_entries to support external imports
ALTER TABLE journal_entries
    ALTER COLUMN batch_id DROP NOT NULL;

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'FINANCE_BATCH'
        CHECK (source_type IN ('FINANCE_BATCH', 'EXTERNAL_IMPORT')),
    ADD COLUMN IF NOT EXISTS external_import_id UUID REFERENCES external_financial_imports(id) ON DELETE SET NULL;

-- Add foreign key constraint for journal_entry_id in external_financial_imports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_external_imports_journal_entry'
    ) THEN
        ALTER TABLE external_financial_imports
            ADD CONSTRAINT fk_external_imports_journal_entry
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Row-Level Security Configuration
ALTER TABLE external_financial_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_financial_imports FORCE ROW LEVEL SECURITY;

-- 4. Tenant Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_policy ON external_financial_imports;
CREATE POLICY tenant_isolation_policy ON external_financial_imports
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 5. Grant Permissions to Application Role
GRANT SELECT, INSERT, UPDATE, DELETE ON external_financial_imports TO expensease_app;
