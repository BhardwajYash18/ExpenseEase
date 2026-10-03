-- Migration: 008_create_journal_entries.sql
-- Description: Create account_mappings, journal_entries, journal_entry_lines, and journal_entry_actions tables
-- Checkpoint 8 — Journal Entries / Deterministic Accounting

-- 1. Account Mappings Table
-- Deterministic mapping from expense category to accounting GL accounts (PRD FR-10.2, AGENTS.md Sec 15).
CREATE TABLE IF NOT EXISTS account_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    category VARCHAR(64) NOT NULL,
    debit_account VARCHAR(128) NOT NULL,
    credit_account VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_category UNIQUE (tenant_id, category)
);

-- 2. Journal Entries Table
-- Accounting journal entries generated from reviewed Finance Batches (PRD FR-10.1, AGENTS.md Sec 14, 15, 28).
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES finance_batches(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'FINALIZED')),
    total_debit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_credit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_count INTEGER NOT NULL DEFAULT 0,
    finalized_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_journal_entry UNIQUE (batch_id)
);

-- 3. Journal Entry Lines Table
-- Individual debit and credit lines for each journal entry (PRD FR-10.2, AGENTS.md Sec 15).
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    line_order INTEGER NOT NULL DEFAULT 1,
    account VARCHAR(128) NOT NULL,
    debit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    credit_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Journal Entry Actions Table (Append-Only Audit Trail)
-- Captures WHO, WHAT, WHEN, and WHICH RESOURCE for accounting operations (PRD FR-12.2, FR-12.3, AGENTS.md Sec 17).
CREATE TABLE IF NOT EXISTS journal_entry_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL
        CHECK (action IN ('GENERATE', 'FINALIZE')),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Indexes for Performance and RLS Filtering
CREATE INDEX IF NOT EXISTS idx_account_mappings_tenant ON account_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_mappings_category ON account_mappings(tenant_id, category);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant ON journal_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_batch ON journal_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries(created_at);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant ON journal_entry_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_receipt ON journal_entry_lines(receipt_id);

CREATE INDEX IF NOT EXISTS idx_journal_actions_entry ON journal_entry_actions(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_actions_tenant ON journal_entry_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_actions_created ON journal_entry_actions(created_at);

-- 6. Row-Level Security (RLS)
ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mappings FORCE ROW LEVEL SECURITY;

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE journal_entry_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_actions FORCE ROW LEVEL SECURITY;

-- 7. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON account_mappings;
CREATE POLICY tenant_isolation_policy ON account_mappings
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON journal_entries;
CREATE POLICY tenant_isolation_policy ON journal_entries
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON journal_entry_lines;
CREATE POLICY tenant_isolation_policy ON journal_entry_lines
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON journal_entry_actions;
CREATE POLICY tenant_isolation_policy ON journal_entry_actions
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 8. Grant Permissions to Unprivileged Application Role
GRANT SELECT, INSERT, UPDATE, DELETE ON account_mappings TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry_lines TO expensease_app;
GRANT SELECT, INSERT ON journal_entry_actions TO expensease_app;
