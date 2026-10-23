-- Migration: 011_add_reimbursement_and_email_tables.sql
-- Description: Add reimbursement tracking to expense_workflows, create reimbursement_payments and reimbursement_email_logs tables

-- 1. Extend expense_workflows with reimbursement status and total reimbursed amount
ALTER TABLE expense_workflows
    ADD COLUMN IF NOT EXISTS reimbursement_status VARCHAR(32) NOT NULL DEFAULT 'UNPAID'
        CHECK (reimbursement_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    ADD COLUMN IF NOT EXISTS total_reimbursed_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS idx_expense_workflows_reimbursement_status
    ON expense_workflows(reimbursement_status);

-- 2. Reimbursement Payments Table (Payment ledger supporting full and partial payments)
CREATE TABLE IF NOT EXISTS reimbursement_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
    workflow_id UUID NOT NULL REFERENCES expense_workflows(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(64) NOT NULL DEFAULT 'DIRECT_DEPOSIT'
        CHECK (payment_method IN ('DIRECT_DEPOSIT', 'BANK_TRANSFER', 'CHECK', 'CASH', 'PAYROLL', 'OTHER')),
    payment_reference VARCHAR(255),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_payments_tenant ON reimbursement_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_payments_receipt ON reimbursement_payments(receipt_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_payments_workflow ON reimbursement_payments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_payments_paid_at ON reimbursement_payments(paid_at);

-- 3. Reimbursement Email Logs Table (Audit trail for notification emails)
CREATE TABLE IF NOT EXISTS reimbursement_email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recipient_email VARCHAR(255) NOT NULL,
    claim_ids UUID[] NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    email_type VARCHAR(32) NOT NULL DEFAULT 'REIMBURSEMENT_NOTIFICATION'
        CHECK (email_type IN ('REIMBURSEMENT_APPROVED', 'REIMBURSEMENT_PAID', 'REIMBURSEMENT_NOTIFICATION')),
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATED'
        CHECK (delivery_mode IN ('SIMULATED', 'REAL')),
    status VARCHAR(32) NOT NULL DEFAULT 'MOCK_SENT'
        CHECK (status IN ('SENT', 'FAILED', 'MOCK_SENT')),
    idempotency_key VARCHAR(128),
    subject TEXT NOT NULL,
    body_preview TEXT,
    provider_response TEXT,
    sent_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_logs_tenant ON reimbursement_email_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_employee ON reimbursement_email_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON reimbursement_email_logs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_logs_idempotency
    ON reimbursement_email_logs(tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 4. Row-Level Security Configuration
ALTER TABLE reimbursement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_payments FORCE ROW LEVEL SECURITY;

ALTER TABLE reimbursement_email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_email_logs FORCE ROW LEVEL SECURITY;

-- 5. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON reimbursement_payments;
CREATE POLICY tenant_isolation_policy ON reimbursement_payments
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON reimbursement_email_logs;
CREATE POLICY tenant_isolation_policy ON reimbursement_email_logs
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Grant Permissions to Application Role
GRANT SELECT, INSERT, UPDATE, DELETE ON reimbursement_payments TO expensease_app;
GRANT SELECT, INSERT ON reimbursement_email_logs TO expensease_app;
