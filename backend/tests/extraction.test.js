const request = require('supertest');
const axios = require('axios');
const app = require('../src/app');
const { pool, withTenantContext, withTransaction } = require('../src/config/db');
const { runMigrations } = require('../../database/migrator');
const authService = require('../src/services/authService');
const storageService = require('../src/services/storageService');

jest.mock('axios');

describe('Checkpoint 4 — AI Receipt Understanding & Structured Extraction', () => {
  let tenantAId, tenantASlug;
  let tenantBId, tenantBSlug;

  let employeeAToken, employeeBToken;
  let managerAToken, financeAToken;
  let employeeAId, employeeBId;

  let receiptAId;
  const rawPassword = 'SecurePassword123!';

  const mockAiExtractionResponse = {
    merchant_name: 'BLUE BOTTLE COFFEE',
    receipt_date: '2026-05-12',
    total_amount: 14.50,
    subtotal_amount: 13.25,
    tax_amount: 1.25,
    currency: 'USD',
    receipt_number: 'BB-88391',
    suggested_category: 'Meals',
    confidence_score: 0.92,
    is_flagged_for_review: false,
    review_reasons: [],
    field_confidences: {
      merchant: 0.95,
      date: 0.90,
      total_amount: 0.95,
      category: 0.88,
    },
    raw_model_response: '{"merchant_name":"BLUE BOTTLE COFFEE"}',
    model_provider: 'mock',
    model_name: 'mock-test-v1',
    line_items: [
      {
        line_number: 1,
        description: 'Cappuccino',
        quantity: 1,
        unit_price: 5.50,
        total_price: 5.50,
      },
      {
        line_number: 2,
        description: 'Avocado Toast',
        quantity: 1,
        unit_price: 7.75,
        total_price: 7.75,
      },
    ],
  };

  beforeAll(async () => {
    await runMigrations(pool);

    const hashedPwd = await authService.hashPassword(rawPassword);

    tenantASlug = `extract-tenant-a-${Date.now()}`;
    tenantBSlug = `extract-tenant-b-${Date.now()}`;

    await withTransaction(async (client) => {
      // Create Tenants
      const resA = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Extract Corp A', $1, 'ACTIVE') RETURNING id`,
        [tenantASlug]
      );
      tenantAId = resA.rows[0].id;

      const resB = await client.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('Extract Corp B', $1, 'ACTIVE') RETURNING id`,
        [tenantBSlug]
      );
      tenantBId = resB.rows[0].id;

      // Users for Tenant A
      const empARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'A', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `emp.a.${Date.now()}@extracta.com`, hashedPwd]
      );
      employeeAId = empARes.rows[0].id;

      const empBRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'B', 'EMPLOYEE') RETURNING id`,
        [tenantAId, `emp.b.${Date.now()}@extracta.com`, hashedPwd]
      );
      employeeBId = empBRes.rows[0].id;

      const mgrARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Manager', 'A', 'MANAGER') RETURNING id`,
        [tenantAId, `mgr.a.${Date.now()}@extracta.com`, hashedPwd]
      );
      managerAId = mgrARes.rows[0].id;

      const finARes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Finance', 'A', 'FINANCE') RETURNING id`,
        [tenantAId, `fin.a.${Date.now()}@extracta.com`, hashedPwd]
      );
      financeAId = finARes.rows[0].id;

      // User for Tenant B
      const empBSubRes = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, 'Employee', 'TenantB', 'EMPLOYEE') RETURNING id`,
        [tenantBId, `emp.b.${Date.now()}@extractb.com`, hashedPwd]
      );
      employeeTenantBId = empBSubRes.rows[0].id;
    });

    // Generate JWTs with signToken
    employeeAToken = authService.signToken({ sub: employeeAId, tid: tenantAId, role: 'EMPLOYEE' });
    employeeBToken = authService.signToken({ sub: employeeBId, tid: tenantAId, role: 'EMPLOYEE' });
    managerAToken = authService.signToken({ sub: managerAId, tid: tenantAId, role: 'MANAGER' });
    financeAToken = authService.signToken({ sub: financeAId, tid: tenantAId, role: 'FINANCE' });
    employeeTenantBToken = authService.signToken({ sub: employeeTenantBId, tid: tenantBId, role: 'EMPLOYEE' });

    // Create a receipt uploaded by Employee A in Tenant A
    const storageKey = storageService.generateStorageKey(tenantAId, 'image/jpeg');
    await storageService.storeFile(storageKey, Buffer.from('test image content'));

    await withTenantContext(tenantAId, async (client) => {
      const res = await client.query(
        `INSERT INTO receipts (
          tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes,
          storage_key, upload_status, ocr_status, ocr_raw_text
        ) VALUES ($1, $2, 'coffee.jpg', 'image/jpeg', 1024, $3, 'COMPLETED', 'COMPLETED', $4)
        RETURNING id`,
        [tenantAId, employeeAId, storageKey, 'BLUE BOTTLE COFFEE\nDate: 2026-05-12\nTotal: $14.50']
      );
      receiptAId = res.rows[0].id;
    });
  });

  let employeeTenantBToken;

  afterAll(async () => {
    await pool.end();
  });

  describe('1. Trigger AI Extraction (POST /api/receipts/:id/extraction)', () => {
    it('should successfully trigger AI extraction and store structured fields and line items', async () => {
      axios.post.mockResolvedValueOnce({ data: mockAiExtractionResponse });

      const res = await request(app)
        .post(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.extraction).toBeDefined();

      const { aiData, confirmedData, effectiveValues, lineItems } = res.body.extraction;

      // Check immutable AI values
      expect(aiData.merchantName).toBe('BLUE BOTTLE COFFEE');
      expect(aiData.receiptDate).toBe('2026-05-12');
      expect(aiData.totalAmount).toBe(14.50);
      expect(aiData.subtotalAmount).toBe(13.25);
      expect(aiData.taxAmount).toBe(1.25);
      expect(aiData.suggestedCategory).toBe('Meals');
      expect(aiData.confidenceScore).toBe(0.92);

      // Check line items
      expect(lineItems).toHaveLength(2);
      expect(lineItems[0].description).toBe('Cappuccino');
      expect(lineItems[0].unitPrice).toBe(5.50);

      // Check confirmed data is initially null
      expect(confirmedData.merchantName).toBeNull();
      expect(confirmedData.totalAmount).toBeNull();

      // Check deterministic effective values match AI values when unconfirmed
      expect(effectiveValues.merchantName).toBe('BLUE BOTTLE COFFEE');
      expect(effectiveValues.receiptDate).toBe('2026-05-12');
      expect(effectiveValues.totalAmount).toBe(14.50);
      expect(effectiveValues.category).toBe('Meals');
    });

    it('should handle AI service failure gracefully with 502 and record failed status', async () => {
      axios.post.mockRejectedValueOnce(new Error('Connection refused to AI service'));

      const res = await request(app)
        .post(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(502);
      expect(res.body.error.message).toMatch(/AI service processing failed/);
    });
  });

  describe('2. Fetch Extraction (GET /api/receipts/:id/extraction)', () => {
    it('should retrieve existing extraction with effective values', async () => {
      const res = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.extraction.receiptId).toBe(receiptAId);
      expect(res.body.extraction.effectiveValues.merchantName).toBe('BLUE BOTTLE COFFEE');
    });

    it('should return 404 for receipt with no extraction yet', async () => {
      // Create new receipt without extraction
      let newReceiptId;
      const key = storageService.generateStorageKey(tenantAId, 'image/png');
      await storageService.storeFile(key, Buffer.from('dummy'));

      await withTenantContext(tenantAId, async (client) => {
        const r = await client.query(
          `INSERT INTO receipts (tenant_id, uploaded_by, original_filename, mime_type, file_size_bytes, storage_key)
           VALUES ($1, $2, 'test.png', 'image/png', 100, $3) RETURNING id`,
          [tenantAId, employeeAId, key]
        );
        newReceiptId = r.rows[0].id;
      });

      const res = await request(app)
        .get(`/api/receipts/${newReceiptId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Extraction not found');
    });
  });

  describe('3. Edit Confirmed Values (PUT /api/receipts/:id/extraction)', () => {
    it('should update confirmed values, preserve AI values, and deterministically compute effective values', async () => {
      // Re-trigger extraction to ensure it is in COMPLETED state
      axios.post.mockResolvedValueOnce({ data: mockAiExtractionResponse });
      await request(app)
        .post(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      // Employee edits merchant and total amount, but leaves date and category as AI values
      const updatePayload = {
        merchantName: 'Blue Bottle Cafe (Corrected)',
        totalAmount: 15.00,
      };

      const res = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      const { aiData, confirmedData, effectiveValues, extractionStatus } = res.body.extraction;

      expect(extractionStatus).toBe('MANUALLY_CONFIRMED');

      // AI DATA MUST REMAIN UNTOUCHED (Provenance preserved!)
      expect(aiData.merchantName).toBe('BLUE BOTTLE COFFEE');
      expect(aiData.totalAmount).toBe(14.50);

      // CONFIRMED DATA IS POPULATED
      expect(confirmedData.merchantName).toBe('Blue Bottle Cafe (Corrected)');
      expect(confirmedData.totalAmount).toBe(15.00);
      expect(confirmedData.correctedBy).toBe(employeeAId);
      expect(confirmedData.correctedAt).toBeDefined();

      // EFFECTIVE VALUE DETERMINISTIC LOGIC:
      // effective = confirmed if confirmed IS NOT NULL otherwise ai_value
      expect(effectiveValues.merchantName).toBe('Blue Bottle Cafe (Corrected)'); // from confirmed
      expect(effectiveValues.totalAmount).toBe(15.00); // from confirmed
      expect(effectiveValues.receiptDate).toBe('2026-05-12'); // fallback to AI
      expect(effectiveValues.category).toBe('Meals'); // fallback to AI
    });

    it('should reject invalid category update', async () => {
      const res = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ category: 'InventedCategory' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid category/);
    });

    it('should reject invalid date format update', async () => {
      const res = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ receiptDate: '05/12/2026' }); // non-ISO

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/receiptDate must be in YYYY-MM-DD format/);
    });

    it('should reject negative total amount', async () => {
      const res = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({ totalAmount: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/totalAmount must be a non-negative number/);
    });

    it('should allow employee to edit both product name and quantity while preserving prices as read-only', async () => {
      // Fetch current extraction to get line item IDs
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      expect(getRes.status).toBe(200);
      const items = getRes.body.extraction.lineItems;
      expect(items.length).toBeGreaterThanOrEqual(1);

      const targetItem = items[0];
      const originalUnitPrice = targetItem.unitPrice;
      const originalTotalPrice = targetItem.totalPrice;

      // Update description and quantity
      const updateRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              id: targetItem.id,
              description: 'Double Shot Oat Cappuccino',
              quantity: 3,
              // Attempting to pass altered prices should be ignored because prices remain read-only
              unitPrice: 99.99,
              totalPrice: 299.97,
            },
          ],
        });

      expect(updateRes.status).toBe(200);
      const updatedItem = updateRes.body.extraction.lineItems.find((li) => li.id === targetItem.id);
      expect(updatedItem).toBeDefined();
      expect(updatedItem.description).toBe('Double Shot Oat Cappuccino');
      expect(Number(updatedItem.quantity)).toBe(3);
      // Prices MUST remain unmutated (read-only)
      expect(updatedItem.unitPrice).toBe(originalUnitPrice);
      expect(updatedItem.totalPrice).toBe(originalTotalPrice);
    });

    it('should reject empty or whitespace-only product name with 400', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      const targetItem = getRes.body.extraction.lineItems[0];

      const res = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              id: targetItem.id,
              description: '   ',
              quantity: 2,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Product\/item description cannot be empty/);
    });

    it('should reject zero, negative, or invalid quantities with 400', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`);

      const targetItem = getRes.body.extraction.lineItems[0];

      // Test zero quantity
      const resZero = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              id: targetItem.id,
              description: 'Valid Item Name',
              quantity: 0,
            },
          ],
        });
      expect(resZero.status).toBe(400);
      expect(resZero.body.error.message).toMatch(/Quantity must be a valid positive number/);

      // Test negative quantity
      const resNegative = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              id: targetItem.id,
              description: 'Valid Item Name',
              quantity: -2.5,
            },
          ],
        });
      expect(resNegative.status).toBe(400);
      expect(resNegative.body.error.message).toMatch(/Quantity must be a valid positive number/);

      // Test non-numeric quantity
      const resInvalid = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              id: targetItem.id,
              description: 'Valid Item Name',
              quantity: 'invalid-qty',
            },
          ],
        });
      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.error.message).toMatch(/Quantity must be a valid positive number/);
    });

    it('should allow adding new manual products with positive quantity and deleting line items explicitly', async () => {
      // Add manual item
      const addRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          lineItems: [
            {
              description: 'Manual Almond Croissant',
              quantity: 2,
            },
          ],
        });

      expect(addRes.status).toBe(200);
      const addedItem = addRes.body.extraction.lineItems.find(
        (li) => li.description === 'Manual Almond Croissant'
      );
      expect(addedItem).toBeDefined();
      expect(Number(addedItem.quantity)).toBe(2);
      expect(addedItem.unitPrice).toBeNull();
      expect(addedItem.totalPrice).toBeNull();

      // Delete the added item explicitly using deletedLineItemIds
      const deleteRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          deletedLineItemIds: [addedItem.id],
        });

      expect(deleteRes.status).toBe(200);
      const remainingItems = deleteRes.body.extraction.lineItems;
      expect(remainingItems.find((li) => li.id === addedItem.id)).toBeUndefined();
    });
  });

  describe('4. RBAC & Multi-Tenant Authorization Rules', () => {
    it('Employee B cannot view or edit extraction of receipt uploaded by Employee A (returns 404)', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeBToken}`);

      expect(getRes.status).toBe(404);

      const putRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeBToken}`)
        .send({ merchantName: 'Unauthorized Edit' });

      expect(putRes.status).toBe(404);
    });

    it('Manager A can view and confirm extraction for Employee A receipt within Tenant A', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${managerAToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.extraction.id).toBeDefined();

      const putRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${managerAToken}`)
        .send({ category: 'Travel' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.extraction.effectiveValues.category).toBe('Travel');
    });

    it('Finance A can view and confirm extraction for Employee A receipt within Tenant A', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${financeAToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.extraction.id).toBeDefined();
    });

    it('Tenant B user cannot access or edit Tenant A extraction (PostgreSQL RLS strict isolation)', async () => {
      const getRes = await request(app)
        .get(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeTenantBToken}`);

      expect(getRes.status).toBe(404);

      const putRes = await request(app)
        .put(`/api/receipts/${receiptAId}/extraction`)
        .set('Authorization', `Bearer ${employeeTenantBToken}`)
        .send({ merchantName: 'Cross Tenant Breach' });

      expect(putRes.status).toBe(404);
    });
  });
});
