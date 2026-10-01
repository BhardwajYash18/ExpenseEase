-- Migration: 003_create_receipts.sql
-- Description: Create receipts table for receipt capture and OCR storage (Checkpoint 3)
-- Checkpoint 3 — Receipt Capture + OCR

-- 1. Receipts Table
-- Stores uploaded receipt images and their OCR processing results.
-- Each receipt belongs to exactly one tenant and is uploaded by one user.
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Original file metadata (preserved; never used as filesystem paths)
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),

    -- Server-controlled storage reference (opaque identifier, not a raw filesystem path)
    storage_key VARCHAR(512) NOT NULL UNIQUE,

    -- Upload lifecycle
    upload_status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED'
        CHECK (upload_status IN ('PENDING', 'COMPLETED', 'FAILED')),

    -- OCR processing lifecycle
    ocr_status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (ocr_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')),
    ocr_raw_text TEXT,
    ocr_engine VARCHAR(64),
    ocr_error_message TEXT,
    ocr_processed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_receipts_tenant_id ON receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_uploaded_by ON receipts(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_receipts_ocr_status ON receipts(ocr_status);
CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);

-- 3. Row-Level Security
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;

-- 4. Tenant Isolation Policy (consistent with users table pattern from CP1)
DROP POLICY IF EXISTS tenant_isolation_policy ON receipts;
CREATE POLICY tenant_isolation_policy ON receipts
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 5. Grant permissions to application role
GRANT SELECT, INSERT, UPDATE, DELETE ON receipts TO expensease_app;
