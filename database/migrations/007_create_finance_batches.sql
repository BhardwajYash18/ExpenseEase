-- Migration: 007_create_finance_batches.sql
-- Description: Create finance_batches, finance_batch_items, and finance_batch_actions tables
-- Checkpoint 7 — Finance Batches

-- 1. Finance Batches Table
-- Groups approved expenses for finance review and audit.
CREATE TABLE IF NOT EXISTS finance_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'REVIEWED')),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    expense_count INTEGER NOT NULL DEFAULT 0,
    reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Finance Batch Items Table
-- Relates an approved receipt/expense to a finance batch.
-- Enforces that the same receipt cannot be included twice in the same batch.
CREATE TABLE IF NOT EXISTS finance_batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES finance_batches(id) ON DELETE CASCADE,
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_receipt UNIQUE (batch_id, receipt_id)
);

-- 3. Finance Batch Actions Table (Append-Only Audit Trail)
-- Captures WHO, WHAT, WHEN, and WHICH RESOURCE for batch operations per PRD FR-12.2 / FR-12.3.
CREATE TABLE IF NOT EXISTS finance_batch_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES finance_batches(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL
        CHECK (action IN ('CREATE', 'ADD_ITEM', 'REMOVE_ITEM', 'REVIEW')),
    affected_receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Indexes for Performance and RLS Filtering
CREATE INDEX IF NOT EXISTS idx_finance_batches_tenant ON finance_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_batches_status ON finance_batches(status);
CREATE INDEX IF NOT EXISTS idx_finance_batches_created_by ON finance_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_finance_batches_created_at ON finance_batches(created_at);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON finance_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_receipt ON finance_batch_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_tenant ON finance_batch_items(tenant_id);

CREATE INDEX IF NOT EXISTS idx_batch_actions_batch ON finance_batch_actions(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_actions_tenant ON finance_batch_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_batch_actions_actor ON finance_batch_actions(actor_id);
CREATE INDEX IF NOT EXISTS idx_batch_actions_created ON finance_batch_actions(created_at);

-- 5. Row-Level Security (RLS)
ALTER TABLE finance_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE finance_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_batch_items FORCE ROW LEVEL SECURITY;

ALTER TABLE finance_batch_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_batch_actions FORCE ROW LEVEL SECURITY;

-- 6. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON finance_batches;
CREATE POLICY tenant_isolation_policy ON finance_batches
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON finance_batch_items;
CREATE POLICY tenant_isolation_policy ON finance_batch_items
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON finance_batch_actions;
CREATE POLICY tenant_isolation_policy ON finance_batch_actions
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 7. Grant Permissions to Unprivileged Application Role
GRANT SELECT, INSERT, UPDATE, DELETE ON finance_batches TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON finance_batch_items TO expensease_app;
GRANT SELECT, INSERT ON finance_batch_actions TO expensease_app;
