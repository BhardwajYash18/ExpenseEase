-- Migration: 006_create_approval_workflows.sql
-- Description: Create expense_workflows and expense_workflow_actions tables for Checkpoint 6 approval workflow
-- Checkpoint 6 — Approval Workflow

-- 1. Expense Workflows Table
-- Tracks the current lifecycle state of an expense claim associated with a receipt.
CREATE TABLE IF NOT EXISTS expense_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    receipt_id UUID NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    current_state VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (current_state IN (
            'DRAFT',
            'PENDING_APPROVAL',
            'APPROVED',
            'REJECTED',
            'CORRECTION_REQUESTED'
        )),
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Expense Workflow Actions Table (Immutable Audit History)
-- Records every state transition, actor, timestamp, and rejection/correction reasons.
CREATE TABLE IF NOT EXISTS expense_workflow_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES expense_workflows(id) ON DELETE CASCADE,
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(32) NOT NULL
        CHECK (action IN (
            'SUBMIT',
            'APPROVE',
            'REJECT',
            'REQUEST_CORRECTION'
        )),
    previous_state VARCHAR(32) NOT NULL,
    new_state VARCHAR(32) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_expense_workflows_tenant ON expense_workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expense_workflows_receipt ON expense_workflows(receipt_id);
CREATE INDEX IF NOT EXISTS idx_expense_workflows_state ON expense_workflows(current_state);
CREATE INDEX IF NOT EXISTS idx_expense_workflows_submitter ON expense_workflows(submitted_by);

CREATE INDEX IF NOT EXISTS idx_workflow_actions_workflow ON expense_workflow_actions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_receipt ON expense_workflow_actions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_tenant ON expense_workflow_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_actor ON expense_workflow_actions(actor_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_created ON expense_workflow_actions(created_at);

-- 4. Row-Level Security
ALTER TABLE expense_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_workflows FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_workflow_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_workflow_actions FORCE ROW LEVEL SECURITY;

-- 5. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON expense_workflows;
CREATE POLICY tenant_isolation_policy ON expense_workflows
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON expense_workflow_actions;
CREATE POLICY tenant_isolation_policy ON expense_workflow_actions
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Grant Permissions to Unprivileged Role
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_workflows TO expensease_app;
GRANT SELECT, INSERT ON expense_workflow_actions TO expensease_app;
