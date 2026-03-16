'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

// ---------------------------------------------------------------------------
// Molblock helpers
// ---------------------------------------------------------------------------

/**
 * Parse atom count from a V2000 or V3000 molblock header.
 * Returns 0 if the format is not recognised.
 */
function getMolblockAtomCount(molblock) {
  const lines = molblock.split('\n');
  // V2000 counts line is the 4th line (index 3): aaabbblllfffcccsssxxxrrrpppiiimmmvvvvvv
  // atom count is the first 3 characters
  if (lines.length < 4) return 0;
  const countsLine = lines[3];
  const n = parseInt(countsLine.substring(0, 3).trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Add sequential atom map numbers (1-based) to all heavy atoms in a V2000 molblock.
 * The map number field is at columns 60-62 (0-indexed) in each atom line.
 */
function addMapsToMolblock(molblock) {
  const lines = molblock.split('\n');
  const atomCount = getMolblockAtomCount(molblock);
  if (atomCount === 0) return molblock;

  // Atom block starts at line index 4 (after 3 header + 1 counts line)
  for (let i = 4; i < 4 + atomCount && i < lines.length; i++) {
    const line = lines[i];
    // Pad to at least 69 characters (standard V2000 atom line width)
    const padded = line.padEnd(69, ' ');
    const mapNum = (i - 3); // 1-based index
    const mapStr = mapNum.toString().padStart(3, ' ');
    lines[i] = padded.substring(0, 60) + mapStr + padded.substring(63);
  }
  return lines.join('\n');
}

/**
 * Remove all atom map numbers from a V2000 molblock (set field to '  0').
 */
function removeMapsFromMolblock(molblock) {
  const lines = molblock.split('\n');
  const atomCount = getMolblockAtomCount(molblock);
  if (atomCount === 0) return molblock;

  for (let i = 4; i < 4 + atomCount && i < lines.length; i++) {
    const line = lines[i];
    if (line.length >= 63) {
      lines[i] = line.substring(0, 60) + '  0' + line.substring(63);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Sub-command implementations
// ---------------------------------------------------------------------------

/**
 * Extract atom_index → map_number from a V2000 molblock.
 * Map number is stored at columns 60-62 (0-indexed) of each atom line.
 *
 * @param {string} molblock
 * @returns {{ [atomIdx: string]: number }}
 */
function readMapsFromMolblock(molblock) {
  const mapping = {};
  const lines = molblock.split('\n');
  const atomCount = getMolblockAtomCount(molblock);
  for (let i = 4; i < 4 + atomCount && i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 63) continue;
    const mapNum = parseInt(line.substring(60, 63).trim(), 10);
    if (!isNaN(mapNum) && mapNum !== 0) {
      mapping[String(i - 4)] = mapNum; // atom index is 0-based offset into atom block
    }
  }
  return mapping;
}

/**
 * list — extract atom_index → map_number from a SMILES.
 */
async function atomMapList(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) return { smiles, error: h.error };

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    let mapping = {};
    try {
      const molblock = mol.get_molblock();
      mapping = readMapsFromMolblock(molblock);
    } catch (_) {}

    return {
      smiles: h.value,
      atom_maps: mapping,
      mapped_atom_count: Object.keys(mapping).length,
      has_atom_maps: Object.keys(mapping).length > 0
    };

  } finally {
    if (mol) try { mol.delete(); } catch (_) {}
  }
}

/**
 * add — assign sequential atom map numbers (1, 2, …, N) to all heavy atoms.
 * Uses the V2000 molblock as an intermediate representation.
 */
async function atomMapAdd(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) return { smiles, error: h.error };

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    // Obtain V2000 molblock, inject map numbers, reload, export SMILES
    let molblock;
    try {
      molblock = mol.get_molblock();
    } catch (e) {
      return { smiles: h.value, error: `Could not get molblock: ${e.message}` };
    }

    const mappedMolblock = addMapsToMolblock(molblock);

    let mappedMol = null;
    try {
      // get_mol accepts both SMILES and molblock strings
      mappedMol = RDKit.get_mol(mappedMolblock);

      if (!mappedMol || !mappedMol.is_valid()) {
        return { smiles: h.value, error: 'Could not reload mapped molecule' };
      }

      const mappedSmiles = mappedMol.get_smiles();
      return {
        smiles: h.value,
        mapped_smiles: mappedSmiles,
        atom_count: getMolblockAtomCount(molblock)
      };
    } finally {
      if (mappedMol) try { mappedMol.delete(); } catch (_) {}
    }

  } finally {
    if (mol) try { mol.delete(); } catch (_) {}
  }
}

/**
 * remove — strip all atom map numbers from a SMILES.
 */
async function atomMapRemove(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) return { smiles, error: h.error };

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    let molblock;
    try {
      molblock = mol.get_molblock();
    } catch (e) {
      return { smiles: h.value, error: `Could not get molblock: ${e.message}` };
    }

    const cleanMolblock = removeMapsFromMolblock(molblock);

    let cleanMol = null;
    try {
      cleanMol = RDKit.get_mol(cleanMolblock);

      if (!cleanMol || !cleanMol.is_valid()) {
        return { smiles: h.value, error: 'Could not reload molecule after removing maps' };
      }

      return {
        smiles: h.value,
        canonical_smiles: cleanMol.get_smiles()
      };
    } finally {
      if (cleanMol) try { cleanMol.delete(); } catch (_) {}
    }

  } finally {
    if (mol) try { mol.delete(); } catch (_) {}
  }
}

/**
 * check — validate atom mapping in a SMIRKS.
 * Counts mapped/unmapped atoms and checks reactant/product map balance.
 */
async function atomMapCheck(smirks) {
  const h = harden(smirks, 'smirks');
  if (h.error) return { smirks, error: h.error };

  // Split into reactants >> agents >> products
  const parts = h.value.split('>>');
  if (parts.length < 2) {
    return { smirks, error: 'Not a valid reaction SMIRKS (expected ">>" separator)' };
  }

  const reactantPart = parts[0];
  const productPart = parts[parts.length - 1];

  // Extract all :N map numbers
  const mapNumberRe = /:(\d+)/g;

  function extractMaps(smilesPart) {
    const maps = new Set();
    let m;
    while ((m = mapNumberRe.exec(smilesPart)) !== null) {
      maps.add(parseInt(m[1], 10));
    }
    mapNumberRe.lastIndex = 0;
    return maps;
  }

  const reactantMaps = extractMaps(reactantPart);
  const productMaps = extractMaps(productPart);

  // Count total atoms (rough: non-H atoms in SMILES tokens)
  const atomRe = /[A-Z][a-z]?|\[([^\]]+)\]/g;
  function countAtoms(smilesPart) {
    let count = 0;
    let m;
    while ((m = atomRe.exec(smilesPart)) !== null) count++;
    atomRe.lastIndex = 0;
    return count;
  }

  const reactantAtomCount = countAtoms(reactantPart);
  const productAtomCount = countAtoms(productPart);

  const mappedInReactants = reactantMaps.size;
  const mappedInProducts = productMaps.size;
  const unmappedReactants = reactantAtomCount - mappedInReactants;
  const unmappedProducts = productAtomCount - mappedInProducts;

  // Check for map number present in products but not reactants (invalid)
  const onlyInProducts = [...productMaps].filter(n => !reactantMaps.has(n));
  const onlyInReactants = [...reactantMaps].filter(n => !productMaps.has(n));

  const balanced = onlyInProducts.length === 0 && onlyInReactants.length === 0;

  // Validate SMIRKS with RDKit if available
  let rdkitValid = null;
  try {
    const RDKit = await getRDKit();
    if (typeof RDKit.get_rxn === 'function') {
      let rxn = null;
      try {
        rxn = RDKit.get_rxn(h.value);
        rdkitValid = !!(rxn && rxn.is_valid());
      } finally {
        if (rxn) try { rxn.delete(); } catch (_) {}
      }
    }
  } catch (_) {}

  return {
    smirks: h.value,
    valid: rdkitValid !== null ? rdkitValid : true,
    mapped_atoms: Math.min(mappedInReactants, mappedInProducts),
    unmapped_atoms: Math.max(unmappedReactants, unmappedProducts),
    balanced,
    map_numbers_only_in_reactants: onlyInReactants,
    map_numbers_only_in_products: onlyInProducts,
    reactant_atom_count: reactantAtomCount,
    product_atom_count: productAtomCount
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI entry point for the atom-map command.
 *
 * Sub-commands: add | remove | check | list
 * Usage:
 *   rdkit_cli atom-map add    --smiles "[...]"
 *   rdkit_cli atom-map remove --smiles "[...]"
 *   rdkit_cli atom-map check  --smirks "[...]>>[...]"
 *   rdkit_cli atom-map list   --smiles "[...]"
 */
async function atomMap(args) {
  const sub = args.subcommand || (args._ && args._[0]);

  if (!sub) {
    return {
      error: 'No sub-command provided. Use: atom-map add | remove | check | list'
    };
  }

  switch (sub.toLowerCase()) {
    case 'list': {
      const smiles = args.smiles || (args._ && args._[1]);
      if (!smiles) return { error: 'No SMILES provided. Use --smiles <smiles>' };
      return atomMapList(smiles);
    }

    case 'add': {
      const smiles = args.smiles || (args._ && args._[1]);
      if (!smiles) return { error: 'No SMILES provided. Use --smiles <smiles>' };
      return atomMapAdd(smiles);
    }

    case 'remove': {
      const smiles = args.smiles || (args._ && args._[1]);
      if (!smiles) return { error: 'No SMILES provided. Use --smiles <smiles>' };
      return atomMapRemove(smiles);
    }

    case 'check': {
      const smirks = args.smirks || (args._ && args._[1]);
      if (!smirks) return { error: 'No SMIRKS provided. Use --smirks <smirks>' };
      return atomMapCheck(smirks);
    }

    default:
      return {
        error: `Unknown atom-map sub-command: '${sub}'. Use: add | remove | check | list`
      };
  }
}

module.exports = { atomMap, atomMapList, atomMapAdd, atomMapRemove, atomMapCheck };
