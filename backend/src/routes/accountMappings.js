const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const accountMappingController = require('../controllers/accountMappingController');

const router = express.Router();

// All account mapping operations require authentication and the FINANCE role
// per AGENTS.md Section 13, 15 and docs/PRD.md Section 9.3, FR-10.2.
router.use(authenticate);
router.use(requireRole('FINANCE'));

// GET /api/account-mappings - List all configured category mappings
router.get('/', accountMappingController.listMappings);

// POST /api/account-mappings - Create or update a category mapping
router.post('/', accountMappingController.upsertMapping);

module.exports = router;
