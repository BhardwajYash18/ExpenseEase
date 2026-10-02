-- Migration: 005_create_validation_results.sql
-- Description: Create tenant_policies, receipt_validation_results, and receipt_duplicate_candidates tables (Checkpoint 5)
-- Checkpoint 5 — Policy Validation + Duplicate Detection

-- 1. Tenant Expense Policies Table
-- Stores server-controlled configurable policy constraints scoped to each tenant.
-- No invented business defaults (max_amount and require_receipt_above are NULL when unconfigured).
CREATE TABLE IF NOT EXISTS tenant_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
    max_amount NUMERIC(12, 2) DEFAULT NULL CHECK (max_amount IS NULL OR max_amount >= 0),
    require_receipt_above NUMERIC(12, 2) DEFAULT NULL CHECK (require_receipt_above IS NULL OR require_receipt_above >= 0),
    restricted_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    policy_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Receipt Validation Results Table
-- Stores the deterministic evaluation of policy rules and summary duplicate detection signals.
CREATE TABLE IF NOT EXISTS receipt_validation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    validation_status VARCHAR(32) NOT NULL
        CHECK (validation_status IN ('PASSED', 'FAILED', 'REVIEW_REQUIRED')),
    validation_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    policy_rules_result JSONB NOT NULL DEFAULT '[]'::jsonb,
    duplicate_status VARCHAR(32) NOT NULL DEFAULT 'NO_MATCH'
        CHECK (duplicate_status IN ('NO_MATCH', 'POSSIBLE_DUPLICATE', 'HIGH_SIMILARITY', 'DETECTION_UNAVAILABLE')),
    duplicate_score NUMERIC(3, 2) NOT NULL DEFAULT 0.00 CHECK (duplicate_score >= 0.0 AND duplicate_score <= 1.0),
    validated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Receipt Duplicate Candidates Table
-- Stores detailed potential duplicate candidates found during similarity analysis.
CREATE TABLE IF NOT EXISTS receipt_duplicate_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_result_id UUID NOT NULL REFERENCES receipt_validation_results(id) ON DELETE CASCADE,
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    candidate_receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    similarity_score NUMERIC(3, 2) NOT NULL CHECK (similarity_score >= 0.0 AND similarity_score <= 1.0),
    matching_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
    detection_method VARCHAR(64) NOT NULL DEFAULT 'multi_signal_heuristics',
    model_version VARCHAR(64) NOT NULL DEFAULT 'v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_candidate_not_self CHECK (receipt_id <> candidate_receipt_id)
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_policies_tenant ON tenant_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_receipt ON receipt_validation_results(receipt_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_tenant ON receipt_validation_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_status ON receipt_validation_results(validation_status);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_val_id ON receipt_duplicate_candidates(validation_result_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_receipt ON receipt_duplicate_candidates(receipt_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_candidate ON receipt_duplicate_candidates(candidate_receipt_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_tenant ON receipt_duplicate_candidates(tenant_id);

-- 5. Row-Level Security
ALTER TABLE tenant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE receipt_validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_validation_results FORCE ROW LEVEL SECURITY;

ALTER TABLE receipt_duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_duplicate_candidates FORCE ROW LEVEL SECURITY;

-- 6. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_policies;
CREATE POLICY tenant_isolation_policy ON tenant_policies
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON receipt_validation_results;
CREATE POLICY tenant_isolation_policy ON receipt_validation_results
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON receipt_duplicate_candidates;
CREATE POLICY tenant_isolation_policy ON receipt_duplicate_candidates
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 7. Grant permissions to application role
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_policies TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_validation_results TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_duplicate_candidates TO expensease_app;
