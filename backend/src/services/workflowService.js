const { withTenantContext } = require('../config/db');

/**
 * Workflow Service (Checkpoint 6)
 *
 * Implements the employee -> manager approval workflow strictly in accordance
 * with AGENTS.md (Sections 6, 13, 17, 28) and docs/PRD.md (Sections 5 [FR-08], 8, 9).
 *
 * Authoritative Persisted State Machine:
 * DRAFT
 *   ↓ Employee Submit
 * PENDING_APPROVAL
 *   ├─ Manager Approve → APPROVED
 *   ├─ Manager Reject (mandatory reason) → REJECTED
 *   └─ Manager Request Correction (mandatory reason) → CORRECTION_REQUESTED
 *                                       ↓
 *                               Employee corrects/resubmits
 *                                       ↓
 *                               PENDING_APPROVAL
 *
 * Terminal CP6 approval state is APPROVED.
 * Approved expenses become available to Finance for CP7 Finance Batches.
 */

const WORKFLOW_STATES = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CORRECTION_REQUESTED: 'CORRECTION_REQUESTED',
};

const WORKFLOW_ACTIONS = {
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_CORRECTION: 'REQUEST_CORRECTION',
};

/**
 * Format workflow response object
 */
function formatWorkflowResponse(workflowRow, actionRows = []) {
  if (!workflowRow) return null;
  return {
    id: workflowRow.id,
    receiptId: workflowRow.receipt_id,
    tenantId: workflowRow.tenant_id,
    submittedBy: workflowRow.submitted_by,
    currentState: workflowRow.current_state,
    submittedAt: workflowRow.submitted_at,
    completedAt: workflowRow.completed_at,
    createdAt: workflowRow.created_at,
    updatedAt: workflowRow.updated_at,
    history: actionRows.map((a) => ({
      id: a.id,
      action: a.action,
      previousState: a.previous_state,
      newState: a.new_state,
      reason: a.reason,
      actorId: a.actor_id,
      actorRole: a.actor_role,
      actorEmail: a.actor_email,
      actorFirstName: a.actor_first_name,
      actorLastName: a.actor_last_name,
      createdAt: a.created_at,
    })),
  };
}

/**
 * Get or initialize workflow in DRAFT for a receipt
 */
async function getOrCreateWorkflow(client, tenantId, receiptId, userId) {
  const { rows } = await client.query(
    'SELECT * FROM expense_workflows WHERE receipt_id = $1',
    [receiptId]
  );
  if (rows[0]) return rows[0];

  const insertSql = `
    INSERT INTO expense_workflows (
      tenant_id, receipt_id, submitted_by, current_state
    ) VALUES ($1, $2, $3, 'DRAFT')
    RETURNING *
  `;
  const { rows: inserted } = await client.query(insertSql, [tenantId, receiptId, userId]);
  return inserted[0];
}

/**
 * Fetch workflow and full audit history for an authorized receipt
 */
async function getWorkflow(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Authorize receipt access
    let receiptQuery = 'SELECT id, uploaded_by, tenant_id FROM receipts WHERE id = $1';
    const params = [receiptId];
    if (user.role === 'EMPLOYEE') {
      receiptQuery += ' AND uploaded_by = $2';
      params.push(user.id);
    }
    const { rows: receiptRows } = await client.query(receiptQuery, params);
    if (!receiptRows[0]) {
      const err = new Error('Receipt not found');
      err.status = 404;
      throw err;
    }

    const receipt = receiptRows[0];

    // 2. Fetch or create workflow
    let workflow = await getOrCreateWorkflow(client, tenantId, receiptId, receipt.uploaded_by);

    // 3. Fetch audit actions
    const historySql = `
      SELECT a.*, u.email as actor_email, u.role as actor_role, u.first_name as actor_first_name, u.last_name as actor_last_name
      FROM expense_workflow_actions a
      JOIN users u ON a.actor_id = u.id
      WHERE a.workflow_id = $1
      ORDER BY a.created_at ASC
    `;
    const { rows: historyRows } = await client.query(historySql, [workflow.id]);

    return formatWorkflowResponse(workflow, historyRows);
  });
}

/**
 * Submit an expense claim for approval
 *
 * Transitions: DRAFT or CORRECTION_REQUESTED -> PENDING_APPROVAL
 */
async function submitExpense(tenantId, receiptId, user) {
  return withTenantContext(tenantId, async (client) => {
    await client.query('BEGIN');
    try {
      // 1. Authorize ownership (EMPLOYEE only submits own receipt)
      const { rows: receiptRows } = await client.query(
        'SELECT id, uploaded_by FROM receipts WHERE id = $1',
        [receiptId]
      );
      if (!receiptRows[0]) {
        const err = new Error('Receipt not found');
        err.status = 404;
        throw err;
      }
      if (receiptRows[0].uploaded_by !== user.id) {
        const err = new Error('Forbidden: You can only submit your own expense claims.');
        err.status = 403;
        throw err;
      }

      // 2. Lock workflow row
      let workflow = await getOrCreateWorkflow(client, tenantId, receiptId, user.id);
      const { rows: lockedRows } = await client.query(
        'SELECT * FROM expense_workflows WHERE id = $1 FOR UPDATE',
        [workflow.id]
      );
      workflow = lockedRows[0];

      // 3. Validate current state allows submission
      if (
        workflow.current_state !== WORKFLOW_STATES.DRAFT &&
        workflow.current_state !== WORKFLOW_STATES.CORRECTION_REQUESTED
      ) {
        const err = new Error(
          `Cannot submit expense from current state '${workflow.current_state}'. Allowed states: DRAFT, CORRECTION_REQUESTED.`
        );
        err.status = 400;
        throw err;
      }

      // 4. Verify prerequisite: Extraction must exist and not be failed
      const { rows: extRows } = await client.query(
        'SELECT * FROM receipt_extractions WHERE receipt_id = $1',
        [receiptId]
      );
      if (!extRows[0] || (extRows[0].extraction_status !== 'COMPLETED' && extRows[0].extraction_status !== 'MANUALLY_CONFIRMED')) {
        const err = new Error('Cannot submit expense: Receipt structured extraction must be completed before submission.');
        err.status = 400;
        throw err;
      }

      // 5. Verify prerequisite: Policy validation must have been executed (CP5)
      const { rows: valRows } = await client.query(
        'SELECT * FROM receipt_validation_results WHERE receipt_id = $1',
        [receiptId]
      );
      if (!valRows[0]) {
        const err = new Error('Cannot submit expense: Policy validation must be run before submission.');
        err.status = 400;
        throw err;
      }

      const prevState = workflow.current_state;

      // 6. Record SUBMIT action in audit history
      await client.query(
        `INSERT INTO expense_workflow_actions (
          workflow_id, receipt_id, tenant_id, actor_id, action, previous_state, new_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          workflow.id,
          receiptId,
          tenantId,
          user.id,
          WORKFLOW_ACTIONS.SUBMIT,
          prevState,
          WORKFLOW_STATES.PENDING_APPROVAL,
        ]
      );

      // 7. Update workflow state to PENDING_APPROVAL
      const updateSql = `
        UPDATE expense_workflows
        SET current_state = $1, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const { rows: updatedRows } = await client.query(updateSql, [
        WORKFLOW_STATES.PENDING_APPROVAL,
        workflow.id,
      ]);

      await client.query('COMMIT');

      // Fetch history
      const { rows: historyRows } = await client.query(
        `SELECT a.*, u.email as actor_email, u.role as actor_role, u.first_name as actor_first_name, u.last_name as actor_last_name
         FROM expense_workflow_actions a
         JOIN users u ON a.actor_id = u.id
         WHERE a.workflow_id = $1
         ORDER BY a.created_at ASC`,
        [workflow.id]
      );

      return formatWorkflowResponse(updatedRows[0], historyRows);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Approve an expense claim
 *
 * Transitions: PENDING_APPROVAL -> APPROVED
 * Allowed role: MANAGER ONLY
 */
async function approveExpense(tenantId, receiptId, user, comment = null) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Authorize role: MANAGER strictly (PRD FR-08.3, AGENTS.md Section 13)
    if (user.role !== 'MANAGER') {
      const err = new Error('Forbidden: Only an authorized manager can approve expense claims.');
      err.status = 403;
      throw err;
    }

    await client.query('BEGIN');
    try {
      // 2. Lock workflow row
      const { rows: lockedRows } = await client.query(
        `SELECT w.*, r.uploaded_by
         FROM expense_workflows w
         JOIN receipts r ON w.receipt_id = r.id
         WHERE w.receipt_id = $1
         FOR UPDATE OF w`,
        [receiptId]
      );

      if (!lockedRows[0]) {
        const err = new Error('Expense workflow not found for this receipt.');
        err.status = 404;
        throw err;
      }

      const workflow = lockedRows[0];

      // 3. Enforce separation of duties: Submitter cannot approve own expense claim
      if (workflow.submitted_by === user.id || workflow.uploaded_by === user.id) {
        const err = new Error('Forbidden: Separation of duties: Reviewer cannot approve their own expense submission.');
        err.status = 403;
        throw err;
      }

      // 4. Verify current state is PENDING_APPROVAL
      if (workflow.current_state !== WORKFLOW_STATES.PENDING_APPROVAL) {
        const err = new Error(
          `Cannot approve expense in state '${workflow.current_state}'. State must be PENDING_APPROVAL.`
        );
        err.status = 400;
        throw err;
      }

      const prevState = workflow.current_state;

      // 5. Insert audit action
      await client.query(
        `INSERT INTO expense_workflow_actions (
          workflow_id, receipt_id, tenant_id, actor_id, action, previous_state, new_state, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflow.id,
          receiptId,
          tenantId,
          user.id,
          WORKFLOW_ACTIONS.APPROVE,
          prevState,
          WORKFLOW_STATES.APPROVED,
          comment || null,
        ]
      );

      // 6. Update workflow state to APPROVED
      const updateSql = `
        UPDATE expense_workflows
        SET current_state = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const { rows: updatedRows } = await client.query(updateSql, [
        WORKFLOW_STATES.APPROVED,
        workflow.id,
      ]);

      await client.query('COMMIT');

      // Fetch history
      const { rows: historyRows } = await client.query(
        `SELECT a.*, u.email as actor_email, u.role as actor_role, u.first_name as actor_first_name, u.last_name as actor_last_name
         FROM expense_workflow_actions a
         JOIN users u ON a.actor_id = u.id
         WHERE a.workflow_id = $1
         ORDER BY a.created_at ASC`,
        [workflow.id]
      );

      return formatWorkflowResponse(updatedRows[0], historyRows);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Reject an expense claim (with mandatory reason)
 *
 * Transitions: PENDING_APPROVAL -> REJECTED
 * Allowed role: MANAGER ONLY
 */
async function rejectExpense(tenantId, receiptId, user, reason) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Authorize role: MANAGER strictly (PRD FR-08.4)
    if (user.role !== 'MANAGER') {
      const err = new Error('Forbidden: Only an authorized manager can reject expense claims.');
      err.status = 403;
      throw err;
    }

    // 2. Validate mandatory rejection reason (PRD FR-08.4: "Managers can reject expenses (with reason)")
    if (!reason || !String(reason).trim()) {
      const err = new Error('A rejection reason is strictly required when rejecting an expense claim.');
      err.status = 400;
      throw err;
    }

    await client.query('BEGIN');
    try {
      // 3. Lock workflow row
      const { rows: lockedRows } = await client.query(
        'SELECT * FROM expense_workflows WHERE receipt_id = $1 FOR UPDATE',
        [receiptId]
      );

      if (!lockedRows[0]) {
        const err = new Error('Expense workflow not found for this receipt.');
        err.status = 404;
        throw err;
      }

      const workflow = lockedRows[0];

      // 4. Verify current state
      if (workflow.current_state !== WORKFLOW_STATES.PENDING_APPROVAL) {
        const err = new Error(
          `Cannot reject expense in state '${workflow.current_state}'. State must be PENDING_APPROVAL.`
        );
        err.status = 400;
        throw err;
      }

      const prevState = workflow.current_state;

      // 5. Insert audit action
      await client.query(
        `INSERT INTO expense_workflow_actions (
          workflow_id, receipt_id, tenant_id, actor_id, action, previous_state, new_state, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflow.id,
          receiptId,
          tenantId,
          user.id,
          WORKFLOW_ACTIONS.REJECT,
          prevState,
          WORKFLOW_STATES.REJECTED,
          String(reason).trim(),
        ]
      );

      // 6. Update workflow state to REJECTED
      const updateSql = `
        UPDATE expense_workflows
        SET current_state = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const { rows: updatedRows } = await client.query(updateSql, [
        WORKFLOW_STATES.REJECTED,
        workflow.id,
      ]);

      await client.query('COMMIT');

      // Fetch history
      const { rows: historyRows } = await client.query(
        `SELECT a.*, u.email as actor_email, u.role as actor_role, u.first_name as actor_first_name, u.last_name as actor_last_name
         FROM expense_workflow_actions a
         JOIN users u ON a.actor_id = u.id
         WHERE a.workflow_id = $1
         ORDER BY a.created_at ASC`,
        [workflow.id]
      );

      return formatWorkflowResponse(updatedRows[0], historyRows);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Request correction from employee (with mandatory reason)
 *
 * Transitions: PENDING_APPROVAL -> CORRECTION_REQUESTED
 * Allowed role: MANAGER ONLY
 */
async function requestCorrection(tenantId, receiptId, user, reason) {
  return withTenantContext(tenantId, async (client) => {
    // 1. Authorize role: MANAGER strictly (PRD FR-08.5)
    if (user.role !== 'MANAGER') {
      const err = new Error('Forbidden: Only an authorized manager can request corrections on expense claims.');
      err.status = 403;
      throw err;
    }

    // 2. Validate mandatory correction reason (PRD FR-08.5, AGENTS.md Section 17)
    if (!reason || !String(reason).trim()) {
      const err = new Error('A reason is strictly required when requesting corrections from the employee.');
      err.status = 400;
      throw err;
    }

    await client.query('BEGIN');
    try {
      // 3. Lock workflow row
      const { rows: lockedRows } = await client.query(
        'SELECT * FROM expense_workflows WHERE receipt_id = $1 FOR UPDATE',
        [receiptId]
      );

      if (!lockedRows[0]) {
        const err = new Error('Expense workflow not found for this receipt.');
        err.status = 404;
        throw err;
      }

      const workflow = lockedRows[0];

      // 4. Verify current state
      if (workflow.current_state !== WORKFLOW_STATES.PENDING_APPROVAL) {
        const err = new Error(
          `Cannot request correction in state '${workflow.current_state}'. State must be PENDING_APPROVAL.`
        );
        err.status = 400;
        throw err;
      }

      const prevState = workflow.current_state;

      // 5. Insert audit action
      await client.query(
        `INSERT INTO expense_workflow_actions (
          workflow_id, receipt_id, tenant_id, actor_id, action, previous_state, new_state, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflow.id,
          receiptId,
          tenantId,
          user.id,
          WORKFLOW_ACTIONS.REQUEST_CORRECTION,
          prevState,
          WORKFLOW_STATES.CORRECTION_REQUESTED,
          String(reason).trim(),
        ]
      );

      // 6. Update workflow state to CORRECTION_REQUESTED
      const updateSql = `
        UPDATE expense_workflows
        SET current_state = $1, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const { rows: updatedRows } = await client.query(updateSql, [
        WORKFLOW_STATES.CORRECTION_REQUESTED,
        workflow.id,
      ]);

      await client.query('COMMIT');

      // Fetch history
      const { rows: historyRows } = await client.query(
        `SELECT a.*, u.email as actor_email, u.role as actor_role, u.first_name as actor_first_name, u.last_name as actor_last_name
         FROM expense_workflow_actions a
         JOIN users u ON a.actor_id = u.id
         WHERE a.workflow_id = $1
         ORDER BY a.created_at ASC`,
        [workflow.id]
      );

      return formatWorkflowResponse(updatedRows[0], historyRows);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

module.exports = {
  WORKFLOW_STATES,
  WORKFLOW_ACTIONS,
  getWorkflow,
  submitExpense,
  approveExpense,
  rejectExpense,
  requestCorrection,
  formatWorkflowResponse,
};
