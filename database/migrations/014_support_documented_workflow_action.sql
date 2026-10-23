-- Migration: 014_support_documented_workflow_action.sql
-- Description: Allow 'DOCUMENT' action in expense_workflow_actions for non-reimbursable records

ALTER TABLE expense_workflow_actions
    DROP CONSTRAINT IF EXISTS expense_workflow_actions_action_check;

ALTER TABLE expense_workflow_actions
    ADD CONSTRAINT expense_workflow_actions_action_check
    CHECK (action IN ('SUBMIT', 'APPROVE', 'REJECT', 'REQUEST_CORRECTION', 'DOCUMENT'));
