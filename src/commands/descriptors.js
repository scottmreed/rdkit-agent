'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Compute descriptors for a single SMILES
 */
async function computeDescriptors(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) {
    return { smiles, error: h.error };
  }

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    // Get all RDKit descriptors as JSON
    let descJson;
    try {
      descJson = mol.get_descriptors();
    } catch (e) {
      return { smiles, error: `Failed to compute descriptors: ${e.message}` };
    }

    const rawDescs = descJson ? JSON.parse(descJson) : {};

    // Extract the standard Lipinski/drug-like descriptors
    const result = {
      smiles: h.value,
      canonical_smiles: mol.get_smiles(),
      MW: rawDescs.exactmw || rawDescs.amw || rawDescs.MW || null,
      logP: rawDescs.CrippenClogP || rawDescs.MolLogP || null,
      TPSA: rawDescs.tpsa || rawDescs.TPSA || null,
      HBD: rawDescs.NumHBD || rawDescs.NumHDonors || null,
      HBA: rawDescs.NumHBA || rawDescs.NumHAcceptors || null,
      rotatable_bonds: rawDescs.NumRotatableBonds || null,
      aromatic_rings: rawDescs.NumAromaticRings || null,
      heavy_atoms: rawDescs.NumHeavyAtoms || rawDescs.HeavyAtomCount || null,
      rings: rawDescs.RingCount || rawDescs.NumRings || null,
      stereo_centers: rawDescs.NumAtomStereoCenters || null,
      formal_charge: rawDescs.FormalCharge || null
    };

    // Fill in nulls with alternative descriptor names
    const altNames = {
      MW: ['exactmw', 'amw', 'MW', 'MolWt'],
      logP: ['CrippenClogP', 'MolLogP', 'LogP'],
      TPSA: ['tpsa', 'TPSA'],
      HBD: ['NumHBD', 'NumHDonors', 'HBD'],
      HBA: ['NumHBA', 'NumHAcceptors', 'HBA'],
      rotatable_bonds: ['NumRotatableBonds', 'RotatableBonds'],
      aromatic_rings: ['NumAromaticRings', 'AromaticRings'],
      heavy_atoms: ['NumHeavyAtoms', 'HeavyAtomCount']
    };

    for (const [key, alts] of Object.entries(altNames)) {
      if (result[key] === null) {
        for (const alt of alts) {
          if (rawDescs[alt] !== undefined) {
            result[key] = rawDescs[alt];
            break;
          }
        }
      }
    }

    // Round floating point values
    if (result.MW !== null) result.MW = Math.round(result.MW * 100) / 100;
    if (result.logP !== null) result.logP = Math.round(result.logP * 100) / 100;
    if (result.TPSA !== null) result.TPSA = Math.round(result.TPSA * 100) / 100;

    return result;

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main descriptors command
 */
async function descriptors(args) {
  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.molecules) molecules = parsed.molecules;
      else if (parsed.smiles) molecules = [parsed.smiles];
      else if (Array.isArray(parsed)) molecules = parsed;
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.smiles) {
    molecules = Array.isArray(args.smiles) ? args.smiles : [args.smiles];
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (molecules.length === 0) {
    return { error: 'No molecules provided. Use --smiles <smiles> or --json \'{"molecules":["CCO"]}\'' };
  }

  const results = await Promise.all(molecules.map(computeDescriptors));

  if (results.length === 1) {
    return results[0];
  }

  return {
    count: results.length,
    results
  };
}

module.exports = { descriptors, computeDescriptors };
