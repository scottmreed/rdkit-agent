'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

const OPERATIONS = ['neutralize', 'strip-maps', 'sanitize', 'add-h', 'remove-h'];

/**
 * Apply an edit operation to a molecule
 */
async function editMolecule(smiles, operation) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) {
    return { smiles, operation, error: h.error };
  }

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, operation, error: 'Invalid molecule' };
    }

    let resultSmiles;
    let details = {};

    switch (operation) {
      case 'sanitize': {
        // Sanitization is typically done on load; get canonical SMILES
        resultSmiles = mol.get_smiles();
        details.message = 'Molecule sanitized';
        break;
      }

      case 'neutralize': {
        // Neutralize: remove formal charges where possible
        try {
          const neutralized = mol.neutralize();
          if (neutralized) {
            resultSmiles = mol.get_smiles();
            details.message = 'Molecule neutralized';
          } else {
            resultSmiles = mol.get_smiles();
            details.message = 'No changes needed (already neutral or cannot neutralize)';
          }
        } catch (e) {
          // If method doesn't exist, try via SMILES manipulation
          resultSmiles = mol.get_smiles();
          details.message = `Neutralize not fully supported: ${e.message}`;
        }
        break;
      }

      case 'strip-maps': {
        // Remove atom map numbers
        try {
          const stripped = mol.remove_hs_parameters ? mol.get_smiles() : mol.get_smiles();
          // Replace atom map numbers in SMILES: [C:1] → [C], or c1:1ccccc1 → c1ccccc1
          resultSmiles = stripped.replace(/:(\d+)(?=\])/g, '');
          details.message = 'Atom map numbers removed';
        } catch (e) {
          resultSmiles = mol.get_smiles().replace(/:(\d+)(?=\])/g, '');
          details.message = 'Atom map numbers removed from SMILES string';
        }
        break;
      }

      case 'add-h': {
        try {
          const withH = mol.add_hs(JSON.stringify({ explicitOnly: false }));
          if (withH) {
            resultSmiles = withH;
            details.message = 'Explicit hydrogens added';
          } else {
            resultSmiles = mol.get_smiles();
            details.message = 'Could not add hydrogens';
          }
        } catch (e) {
          resultSmiles = mol.get_smiles();
          details.message = `add-h failed: ${e.message}`;
        }
        break;
      }

      case 'remove-h': {
        try {
          const withoutH = mol.remove_hs(JSON.stringify({}));
          if (withoutH) {
            resultSmiles = withoutH;
            details.message = 'Explicit hydrogens removed';
          } else {
            resultSmiles = mol.get_smiles();
            details.message = 'Could not remove hydrogens';
          }
        } catch (e) {
          resultSmiles = mol.get_smiles();
          details.message = `remove-h failed: ${e.message}`;
        }
        break;
      }

      default:
        return { smiles, operation, error: `Unknown operation: ${operation}. Valid: ${OPERATIONS.join(', ')}` };
    }

    return {
      smiles: h.value,
      operation,
      result_smiles: resultSmiles,
      canonical_original: mol.get_smiles(),
      ...details
    };

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main edit command
 */
async function edit(args) {
  const operation = args.operation || (args._ && args._[1]);
  if (!operation) {
    return { error: `No operation specified. Valid operations: ${OPERATIONS.join(', ')}` };
  }

  if (!OPERATIONS.includes(operation)) {
    return { error: `Unknown operation: '${operation}'. Valid: ${OPERATIONS.join(', ')}` };
  }

  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.smiles) molecules = [parsed.smiles];
      else if (parsed.molecules) molecules = parsed.molecules;
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.smiles) {
    molecules = Array.isArray(args.smiles) ? args.smiles : [args.smiles];
  } else if (args._ && args._.length > 0) {
    molecules = [args._[0]];
  }

  if (molecules.length === 0) {
    return { error: 'No molecules provided. Use --smiles <smiles> --operation <op>' };
  }

  const results = await Promise.all(molecules.map(s => editMolecule(s, operation)));

  if (results.length === 1) return results[0];
  return { count: results.length, operation, results };
}

module.exports = { edit, editMolecule, OPERATIONS };
