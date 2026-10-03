const accountMappingService = require('../services/accountMappingService');

/**
 * Account Mapping Controller (Checkpoint 8)
 *
 * REST API handlers for managing category-to-GL-account mappings.
 * Strictly restricted to authenticated FINANCE role.
 */

async function listMappings(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    let mappings = await accountMappingService.getAccountMappings(tenantId);

    // If tenant has no mappings yet, seed defaults for immediate usability
    if (mappings.length === 0) {
      mappings = await accountMappingService.seedDefaultAccountMappings(tenantId);
    }

    res.json({
      success: true,
      mappings,
    });
  } catch (err) {
    next(err);
  }
}

async function upsertMapping(req, res, next) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { category, debitAccount, creditAccount } = req.body;

    const mapping = await accountMappingService.createOrUpdateAccountMapping(
      tenantId,
      userId,
      { category, debitAccount, creditAccount }
    );

    res.status(200).json({
      success: true,
      mapping,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMappings,
  upsertMapping,
};
