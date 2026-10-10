-- Migration: 010_add_reimbursement_request_fields.sql
-- Description: Add requested_amount and reimbursement_description columns to receipt_extractions

ALTER TABLE receipt_extractions
    ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS reimbursement_description TEXT;
