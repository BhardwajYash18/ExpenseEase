-- Migration: 004_create_receipt_extractions.sql
-- Description: Create receipt_extractions and receipt_line_items tables with strict AI/Confirmed provenance separation (Checkpoint 4)
-- Checkpoint 4 — AI Receipt Understanding + Structured Extraction

-- 1. Receipt Extractions Table
CREATE TABLE IF NOT EXISTS receipt_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

    -- Extraction lifecycle
    extraction_status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (extraction_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'MANUALLY_CONFIRMED')),
    model_provider VARCHAR(64),
    model_name VARCHAR(128),
    raw_model_response TEXT,
    extraction_error_message TEXT,
    extracted_at TIMESTAMPTZ,

    -- AI Extracted Values (Preserved permanently; never overwritten by human edits)
    ai_merchant_name VARCHAR(255),
    ai_receipt_date DATE,
    ai_total_amount NUMERIC(12, 2),
    ai_subtotal_amount NUMERIC(12, 2),
    ai_tax_amount NUMERIC(12, 2),
    ai_currency VARCHAR(3) DEFAULT 'USD',
    ai_receipt_number VARCHAR(100),
    ai_suggested_category VARCHAR(64),
    ai_confidence_score NUMERIC(3, 2),
    ai_is_flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    ai_review_reasons JSONB DEFAULT '[]'::jsonb,
    ai_field_confidences JSONB DEFAULT '{}'::jsonb,

    -- Confirmed / Corrected Values (Populated when an authorized user edits/confirms)
    confirmed_merchant_name VARCHAR(255),
    confirmed_receipt_date DATE,
    confirmed_total_amount NUMERIC(12, 2),
    confirmed_subtotal_amount NUMERIC(12, 2),
    confirmed_tax_amount NUMERIC(12, 2),
    confirmed_currency VARCHAR(3),
    confirmed_receipt_number VARCHAR(100),
    confirmed_category VARCHAR(64),
    corrected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    corrected_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Receipt Line Items Table
CREATE TABLE IF NOT EXISTS receipt_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_extraction_id UUID NOT NULL REFERENCES receipt_extractions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL,
    description VARCHAR(512) NOT NULL,
    quantity NUMERIC(10, 3) DEFAULT 1.0,
    unit_price NUMERIC(12, 2),
    total_price NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_receipt_extractions_receipt_id ON receipt_extractions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_extractions_tenant_id ON receipt_extractions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipt_extractions_status ON receipt_extractions(extraction_status);
CREATE INDEX IF NOT EXISTS idx_receipt_line_items_extraction_id ON receipt_line_items(receipt_extraction_id);
CREATE INDEX IF NOT EXISTS idx_receipt_line_items_tenant_id ON receipt_line_items(tenant_id);

-- 4. Row-Level Security
ALTER TABLE receipt_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_extractions FORCE ROW LEVEL SECURITY;

ALTER TABLE receipt_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_line_items FORCE ROW LEVEL SECURITY;

-- 5. Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON receipt_extractions;
CREATE POLICY tenant_isolation_policy ON receipt_extractions
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON receipt_line_items;
CREATE POLICY tenant_isolation_policy ON receipt_line_items
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 6. Grant permissions to application role
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_extractions TO expensease_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_line_items TO expensease_app;
