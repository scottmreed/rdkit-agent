'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Generate fingerprint for a single molecule
 */
async function generateFingerprint(smiles, type, radius, nbits) {
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

    let fp;
    const details = JSON.stringify({ nBits: nbits, radius });

    switch (type) {
      case 'morgan': {
        fp = mol.get_morgan_fp(details);
        break;
      }
      case 'rdkit': {
        fp = mol.get_rdkit_fp(details);
        break;
      }
      case 'topological':
      case 'topological_torsion': {
        fp = mol.get_topological_torsion_fp(details);
        break;
      }
      case 'atom_pair': {
        fp = mol.get_atom_pair_fp(details);
        break;
      }
      case 'pattern': {
        fp = mol.get_pattern_fp(details);
        break;
      }
      default:
        fp = mol.get_morgan_fp(details);
    }

    if (!fp) {
      return { smiles, error: 'Failed to generate fingerprint' };
    }

    // Count set bits
    const setBits = [];
    for (let i = 0; i < fp.length; i++) {
      if (fp[i] === '1') setBits.push(i);
    }

    return {
      smiles: h.value,
      canonical_smiles: mol.get_smiles(),
      type,
      radius,
      nbits,
      fingerprint: fp,
      set_bits: setBits,
      density: setBits.length / nbits
    };

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main fingerprint command
 */
async function fingerprint(args) {
  const type = (args.type || 'morgan').toLowerCase();
  const radius = parseInt(args.radius) || 2;
  const nbits = parseInt(args.nbits) || 2048;

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

  const results = await Promise.all(molecules.map(s => generateFingerprint(s, type, radius, nbits)));

  if (results.length === 1) return results[0];
  return { count: results.length, results };
}

module.exports = { fingerprint, generateFingerprint };
