'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Extract specified stereocenters from the molecule JSON.
 * In rdkit-js mol JSON, atoms with explicit chirality carry a "stereo" field
 * set to "cw" (clockwise / @@) or "ccw" (counter-clockwise / @).
 * Atoms with no stereo tag, or tag "unspecified", are not returned here.
 *
 * @param {object} molJson - Parsed mol JSON from mol.get_json()
 * @returns {Array<{atom_idx:number, type:string, specified:boolean, descriptor:string}>}
 */
function specifiedCentersFromMolJson(molJson) {
  const centers = [];
  try {
    const m = molJson && molJson.molecules && molJson.molecules[0];
    if (!m) return centers;

    const atoms = m.atoms || [];
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const stereo = atom.stereo;
      if (stereo === 'cw' || stereo === 'ccw') {
        centers.push({
          atom_idx: i,
          type: 'tetrahedral',
          specified: true,
          descriptor: stereo === 'cw' ? '@@' : '@'
        });
      }
    }

    // Double-bond E/Z stereo from bonds (rdkit mol JSON uses "trans"/"cis" or "E"/"Z")
    const bonds = m.bonds || [];
    for (let i = 0; i < bonds.length; i++) {
      const bond = bonds[i];
      const stereo = bond.stereo;
      if (stereo === 'E' || stereo === 'Z' || stereo === 'trans' || stereo === 'cis') {
        centers.push({
          bond_idx: i,
          begin_atom: bond.atoms ? bond.atoms[0] : null,
          end_atom: bond.atoms ? bond.atoms[1] : null,
          stereo_atoms: bond.stereoAtoms || null,
          type: 'double_bond',
          specified: true,
          descriptor: stereo === 'trans' ? 'E' : stereo === 'cis' ? 'Z' : stereo
        });
      }
    }
  } catch (_) {}
  return centers;
}

/**
 * Analyse stereocenters in a single SMILES.
 *
 * Uses:
 *  - mol.get_json() for specified tetrahedral centers (stereo: "cw"/"ccw")
 *  - mol.get_descriptors() for total and unspecified counts
 *    (NumAtomStereoCenters, NumUnspecifiedAtomStereoCenters)
 *  - Atom indices for unspecified centers are not available via the WASM JSON API
 *    and will be reported as separate entries with atom_idx: null.
 *
 * @param {string} smiles
 * @returns {Promise<object>}
 */
async function analyzeStereo(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) return { smiles, error: h.error };

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    const canonical = mol.get_smiles();

    // 1. Get specified centers from mol JSON
    let specifiedCenters = [];
    try {
      const molJson = JSON.parse(mol.get_json());
      specifiedCenters = specifiedCentersFromMolJson(molJson);
    } catch (_) {}

    // 2. Get total/unspecified counts from descriptors
    let totalTetrahedralCount = specifiedCenters.filter(c => c.type === 'tetrahedral').length;
    let unspecifiedCount = 0;

    try {
      const desc = JSON.parse(mol.get_descriptors());
      const total = desc.NumAtomStereoCenters;
      const unspecified = desc.NumUnspecifiedAtomStereoCenters;
      if (typeof total === 'number') totalTetrahedralCount = total;
      if (typeof unspecified === 'number') unspecifiedCount = unspecified;
    } catch (_) {}

    const specifiedCount = totalTetrahedralCount - unspecifiedCount;

    // 3. Build the stereo_centers list.
    //    Specified centers come from mol JSON (with atom_idx).
    //    Unspecified centers are added as entries without atom_idx.
    const stereoCenters = [...specifiedCenters];

    // Pad with unspecified tetrahedral entries if descriptors report more than mol JSON found
    const specifiedTetrahedralInJson = specifiedCenters.filter(c => c.type === 'tetrahedral').length;
    const missingSpecified = specifiedCount - specifiedTetrahedralInJson;
    for (let i = 0; i < missingSpecified; i++) {
      stereoCenters.push({ atom_idx: null, type: 'tetrahedral', specified: true, descriptor: null });
    }
    for (let i = 0; i < unspecifiedCount; i++) {
      stereoCenters.push({ atom_idx: null, type: 'tetrahedral', specified: false, descriptor: null });
    }

    const doubleBondStereo = specifiedCenters.filter(c => c.type === 'double_bond');
    const hasStereo = totalTetrahedralCount > 0 || doubleBondStereo.length > 0;
    const hasUnspecified = unspecifiedCount > 0;

    return {
      smiles: h.value,
      canonical_smiles: canonical,
      stereo_centers: stereoCenters,
      stereo_center_count: totalTetrahedralCount,
      specified_count: specifiedCount,
      unspecified_count: unspecifiedCount,
      has_stereo: hasStereo,
      has_unspecified_stereo: hasUnspecified
    };

  } finally {
    if (mol) try { mol.delete(); } catch (_) {}
  }
}

/**
 * CLI entry point for the stereo command.
 */
async function stereo(args) {
  let molecules = [];

  if (args.smiles) {
    molecules = Array.isArray(args.smiles)
      ? args.smiles
      : args.smiles.split(',').map(s => s.trim()).filter(Boolean);
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (molecules.length === 0) {
    return { error: 'No SMILES provided. Use --smiles <smiles>' };
  }

  if (args.enumerate) {
    // Stereo enumeration requires enumerate_stereocenters which is not available
    // in the standard RDKit WASM build. Check at runtime and give a clear error.
    const RDKit = await getRDKit();
    const hh = harden(molecules[0], 'smiles');
    let mol = null;
    try {
      mol = hh.error ? null : RDKit.get_mol(hh.value);
      if (mol && typeof mol.enumerate_stereocenters !== 'function') {
        const err = new Error(
          'Stereo enumeration (enumerate_stereocenters) is not available in this ' +
          'RDKit WASM build. Use full Python RDKit:\n' +
          '  from rdkit.Chem.EnumerateStereoisomers import EnumerateStereoisomers\n' +
          '  isomers = list(EnumerateStereoisomers(mol))'
        );
        err.code = 'NOT_SUPPORTED_IN_WASM';
        throw err;
      }
    } finally {
      if (mol) try { mol.delete(); } catch (_) {}
    }
  }

  const results = await Promise.all(molecules.map(analyzeStereo));

  if (results.length === 1) return results[0];
  return { count: results.length, results };
}

module.exports = { stereo, analyzeStereo };
