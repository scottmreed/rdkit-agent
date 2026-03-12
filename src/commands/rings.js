'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Analyze ring systems in a molecule
 */
async function analyzeRings(smiles) {
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

    const canonical = mol.get_smiles();

    // Get descriptors for ring information
    let descData = {};
    try {
      const descJson = mol.get_descriptors();
      if (descJson) descData = JSON.parse(descJson);
    } catch (e) {}

    // Extract ring counts from descriptors
    const ringCount = descData.RingCount || descData.NumRings || 0;
    const aromaticRings = descData.NumAromaticRings || 0;
    const saturatedRings = descData.NumSaturatedRings || 0;
    const aliphaticRings = descData.NumAliphaticRings || 0;
    const aromaticHeterocycles = descData.NumAromaticHeterocycles || 0;
    const saturatedHeterocycles = descData.NumSaturatedHeterocycles || 0;
    const bridgeheadAtoms = descData.NumBridgeheadAtoms || 0;
    const spiroAtoms = descData.NumSpiroAtoms || 0;

    // Get ring info from JSON
    let ringData = [];
    try {
      const jsonStr = mol.get_json();
      const molJson = JSON.parse(jsonStr);
      // Extract ring information if available
      if (molJson && molJson.molecules && molJson.molecules[0]) {
        const m = molJson.molecules[0];
        if (m.rings) ringData = m.rings;
      }
    } catch (e) {}

    // Compute ring size distribution from SMARTS
    const ringSizeDistribution = {};
    for (let size = 3; size <= 8; size++) {
      let ringQmol = null;
      try {
        const ringSmarts = `[r${size}]`;
        ringQmol = RDKit.get_qmol(ringSmarts);
        if (ringQmol && ringQmol.is_valid()) {
          const match = mol.get_substruct_match(ringQmol);
          if (match && match !== '{}') {
            const matchesJson = mol.get_substruct_matches(ringQmol);
            // This gives atom matches, not ring counts, but gives indication
            ringSizeDistribution[`ring_${size}`] = true;
          }
        }
      } catch (e) {
        // skip
      } finally {
        if (ringQmol) {
          try { ringQmol.delete(); } catch (_) {}
        }
      }
    }

    return {
      smiles: h.value,
      canonical_smiles: canonical,
      ring_count: ringCount,
      aromatic_rings: aromaticRings,
      saturated_rings: saturatedRings,
      aliphatic_rings: aliphaticRings,
      aromatic_heterocycles: aromaticHeterocycles,
      saturated_heterocycles: saturatedHeterocycles,
      bridgehead_atoms: bridgeheadAtoms,
      spiro_atoms: spiroAtoms,
      has_fused_rings: bridgeheadAtoms > 0 || (ringCount > 1 && spiroAtoms === 0),
      has_spiro: spiroAtoms > 0,
      ring_size_presence: ringSizeDistribution
    };

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main rings command
 */
async function rings(args) {
  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.smiles) molecules = [parsed.smiles];
      else if (parsed.molecules) molecules = parsed.molecules;
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
    return { error: 'No molecules provided. Use --smiles <smiles>' };
  }

  const results = await Promise.all(molecules.map(analyzeRings));

  if (results.length === 1) return results[0];
  return { count: results.length, results };
}

module.exports = { rings, analyzeRings };
