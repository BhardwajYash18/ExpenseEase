-- Migration: 013_add_other_account_mapping_and_direct_entries.sql
-- Description: Add 'Other' default account mapping, direct_financial_entries table, and non-reimbursable claim support

-- 1. Support non-reimbursable documentation on receipts and expense_workflows
ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS claim_type VARCHAR(32) NOT NULL DEFAULT 'REIMBURSEMENT'
        CHECK (claim_type IN ('REIMBURSEMENT', 'NON_REIMBURSABLE')),
    ADD COLUMN IF NOT EXISTS org_reference VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_receipts_claim_type ON receipts(claim_type);

ALTER TABLE expense_workflows
    ADD COLUMN IF NOT EXISTS claim_type VARCHAR(32) NOT NULL DEFAULT 'REIMBURSEMENT'
        CHECK (claim_type IN ('REIMBURSEMENT', 'NON_REIMBURSABLE')),
    ADD COLUMN IF NOT EXISTS org_reference VARCHAR(100);

-- Update workflow current_state constraint to support 'DOCUMENTED' for non-reimbursable bills
ALTER TABLE expense_workflows
    DROP CONSTRAINT IF EXISTS expense_workflows_current_state_check;

ALTER TABLE expense_workflows
    ADD CONSTRAINT expense_workflows_current_state_check
    CHECK (current_state IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CORRECTION_REQUESTED', 'DOCUMENTED'));

CREATE INDEX IF NOT EXISTS idx_expense_workflows_claim_type ON expense_workflows(claim_type);

-- 2. Direct Financial Entries Table (Feature B)
CREATE TABLE IF NOT EXISTS direct_financial_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entry_number VARCHAR(64),
    transaction_date DATE NOT NULL,
    vendor VARCHAR(255) NOT NULL,
    reference_number VARCHAR(100),
    source_type VARCHAR(64) NOT NULL DEFAULT 'SUPPLIER_BILL'
        CHECK (source_type IN ('SUPPLIER_BILL', 'EXTERNAL_INVOICE', 'DIRECT_PAYMENT', 'WIRE_TRANSFER', 'OTHER')),
    category VARCHAR(64),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    tax_amount NUMERIC(12, 2) DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    debit_account VARCHAR(128) NOT NULL,
    credit_account VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    notes TEXT,
    reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'UNRECONCILED'
        CHECK (reconciliation_status IN ('UNRECONCILED', 'RECONCILED', 'FLAGGED')),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'POSTED')),
    attachment_storage_key VARCHAR(512),
    attachment_filename VARCHAR(255),
    attachment_mime_type VARCHAR(100),
    journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_entries_tenant ON direct_financial_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_direct_entries_status ON direct_financial_entries(status);
CREATE INDEX IF NOT EXISTS idx_direct_entries_date ON direct_financial_entries(transaction_date);
CREATE INDEX IF NOT EXISTS idx_direct_entries_vendor ON direct_financial_entries(vendor);

-- Deduplication index for vendor and reference number within tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_entries_ref
    ON direct_financial_entries(tenant_id, vendor, reference_number)
    WHERE reference_number IS NOT NULL AND reference_number != '';

-- 3. Direct Financial Entry Audit Trail
CREATE TABLE IF NOT EXISTS direct_financial_entry_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES direct_financial_entries(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(32) NOT NULL
        CHECK (action IN ('CREATE', 'UPDATE', 'POST', 'ATTACH_FILE')),
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_entry_actions_entry ON direct_financial_entry_actions(entry_id);
CREATE INDEX IF NOT EXISTS idx_direct_entry_actions_tenant ON direct_financial_entry_actions(tenant_id);

-- 4. Enable Row-Level Security
ALTER TABLE direct_financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_financial_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE direct_financial_entry_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_financial_entry_actions FORCE ROW LEVEL SECURITY;

-- 5. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON direct_financial_entries;
CREATE POLICY tenant_isolation_policy ON direct_financial_entries
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON direct_financial_entry_actions;
CREATE POLICY tenant_isolation_policy ON direct_financial_entry_actions
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Grant Permissions to Application Role
GRANT SELECT, INSERT, UPDATE, DELETE ON direct_financial_entries TO expensease_app;
GRANT SELECT, INSERT ON direct_financial_entry_actions TO expensease_app;

-- 7. Update journal_entries source_type to support 'DIRECT_ENTRY'
ALTER TABLE journal_entries
    DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE journal_entries
    ADD CONSTRAINT journal_entries_source_type_check
    CHECK (source_type IN ('FINANCE_BATCH', 'EXTERNAL_IMPORT', 'DIRECT_ENTRY'));

-- 8. Seed default mapping for 'Other' category across all existing tenants
INSERT INTO account_mappings (tenant_id, category, debit_account, credit_account)
SELECT id, 'Other', '6900 - Miscellaneous / Other Expense', '2000 - Accounts Payable'
FROM tenants
ON CONFLICT (tenant_id, category) DO NOTHING;
