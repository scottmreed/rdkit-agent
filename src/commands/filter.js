'use strict';

const { computeDescriptors } = require('./descriptors');

/**
 * Main filter command - filter molecules by descriptor criteria
 */
async function filter(args) {
  let molecules = [];
  let criteria = {};

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      molecules = parsed.smiles || parsed.molecules || [];
      criteria = {
        mw_min: parsed.mw_min,
        mw_max: parsed.mw_max,
        logp_min: parsed.logp_min,
        logp_max: parsed.logp_max,
        hba_max: parsed.hba_max,
        hbd_max: parsed.hbd_max,
        tpsa_max: parsed.tpsa_max,
        rotatable_bonds_max: parsed.rotatable_bonds_max
      };
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else {
    if (args.smiles) {
      molecules = Array.isArray(args.smiles) ? args.smiles : args.smiles.split(',').map(s => s.trim());
    } else if (args._ && args._.length > 0) {
      molecules = args._;
    }

    criteria = {
      mw_min: args['mw-min'] !== undefined ? parseFloat(args['mw-min']) : undefined,
      mw_max: args['mw-max'] !== undefined ? parseFloat(args['mw-max']) : undefined,
      logp_min: args['logp-min'] !== undefined ? parseFloat(args['logp-min']) : undefined,
      logp_max: args['logp-max'] !== undefined ? parseFloat(args['logp-max']) : undefined,
      hba_max: args['hba-max'] !== undefined ? parseInt(args['hba-max']) : undefined,
      hbd_max: args['hbd-max'] !== undefined ? parseInt(args['hbd-max']) : undefined,
      tpsa_max: args['tpsa-max'] !== undefined ? parseFloat(args['tpsa-max']) : undefined,
      rotatable_bonds_max: args['rotatable-bonds-max'] !== undefined ? parseInt(args['rotatable-bonds-max']) : undefined
    };
  }

  if (molecules.length === 0) {
    return { error: 'No molecules provided. Use --smiles <smiles,...>' };
  }

  // Check if it's Lipinski rule of 5
  const lipinskiRo5 = args['lipinski'] || args['ro5'];
  if (lipinskiRo5) {
    criteria.mw_max = criteria.mw_max || 500;
    criteria.logp_max = criteria.logp_max || 5;
    criteria.hba_max = criteria.hba_max || 10;
    criteria.hbd_max = criteria.hbd_max || 5;
  }

  // Compute descriptors for all molecules
  const descriptorsList = await Promise.all(molecules.map(computeDescriptors));

  const passed = [];
  const failed = [];

  for (const desc of descriptorsList) {
    if (desc.error) {
      failed.push({ ...desc, filter_reason: desc.error, passed: false });
      continue;
    }

    const reasons = [];

    if (criteria.mw_min !== undefined && desc.MW < criteria.mw_min) {
      reasons.push(`MW ${desc.MW} < ${criteria.mw_min}`);
    }
    if (criteria.mw_max !== undefined && desc.MW > criteria.mw_max) {
      reasons.push(`MW ${desc.MW} > ${criteria.mw_max}`);
    }
    if (criteria.logp_min !== undefined && desc.logP < criteria.logp_min) {
      reasons.push(`logP ${desc.logP} < ${criteria.logp_min}`);
    }
    if (criteria.logp_max !== undefined && desc.logP > criteria.logp_max) {
      reasons.push(`logP ${desc.logP} > ${criteria.logp_max}`);
    }
    if (criteria.hba_max !== undefined && desc.HBA > criteria.hba_max) {
      reasons.push(`HBA ${desc.HBA} > ${criteria.hba_max}`);
    }
    if (criteria.hbd_max !== undefined && desc.HBD > criteria.hbd_max) {
      reasons.push(`HBD ${desc.HBD} > ${criteria.hbd_max}`);
    }
    if (criteria.tpsa_max !== undefined && desc.TPSA > criteria.tpsa_max) {
      reasons.push(`TPSA ${desc.TPSA} > ${criteria.tpsa_max}`);
    }
    if (criteria.rotatable_bonds_max !== undefined && desc.rotatable_bonds > criteria.rotatable_bonds_max) {
      reasons.push(`RotBonds ${desc.rotatable_bonds} > ${criteria.rotatable_bonds_max}`);
    }

    if (reasons.length === 0) {
      passed.push({ ...desc, passed: true });
    } else {
      failed.push({ ...desc, passed: false, filter_reasons: reasons });
    }
  }

  return {
    total: molecules.length,
    passed: passed.length,
    failed: failed.length,
    criteria,
    passed_molecules: passed,
    failed_molecules: failed
  };
}

module.exports = { filter };
