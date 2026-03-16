'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Enumerate tautomers of a molecule.
 *
 * NOTE: Tautomer enumeration via TautomerEnumerator is NOT available in the standard
 * RDKit WASM build (@rdkit/rdkit). This feature requires full Python RDKit:
 *   from rdkit.Chem.MolStandardize import rdMolStandardize
 *   te = rdMolStandardize.TautomerEnumerator()
 *   tautomers = te.Enumerate(mol)
 *
 * This implementation checks at runtime for the WASM API. If the API is present
 * it will be used; otherwise a clear NOT_SUPPORTED_IN_WASM error is raised.
 *
 * @param {{ smiles: string, limit?: number }} args
 * @returns {Promise<object>}
 */
async function enumerateTautomers(args) {
  const smiles = args.smiles || (args.input);
  const limit = parseInt(args.limit) || 10;

  if (!smiles) {
    return { error: 'No SMILES provided. Use --smiles <smiles>' };
  }

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

    // Check for tautomer enumeration support at runtime.
    // Different builds may expose this as: get_tautomers(), enumerate_tautomers(),
    // or via a TautomerEnumerator object on the RDKit module.
    const hasMolMethod = typeof mol.get_tautomers === 'function' ||
      typeof mol.enumerate_tautomers === 'function';
    const hasModuleMethod = typeof RDKit.get_tautomers === 'function' ||
      typeof RDKit.TautomerEnumerator === 'function';

    if (!hasMolMethod && !hasModuleMethod) {
      const err = new Error(
        'Tautomer enumeration (TautomerEnumerator) is not available in this RDKit WASM build. ' +
        'This feature requires full Python RDKit:\n' +
        '  from rdkit.Chem.MolStandardize import rdMolStandardize\n' +
        '  te = rdMolStandardize.TautomerEnumerator()\n' +
        '  tautomers = te.Enumerate(mol)\n' +
        'See README section "WASM Limitations" for details.'
      );
      err.code = 'NOT_SUPPORTED_IN_WASM';
      throw err;
    }

    // Attempt enumeration via whichever API is available
    let tautomerSmiles = [];
    try {
      let raw;
      if (typeof mol.get_tautomers === 'function') {
        raw = mol.get_tautomers(JSON.stringify({ maxTautomers: limit }));
      } else if (typeof mol.enumerate_tautomers === 'function') {
        raw = mol.enumerate_tautomers(JSON.stringify({ maxTautomers: limit }));
      } else if (typeof RDKit.get_tautomers === 'function') {
        raw = RDKit.get_tautomers(h.value, JSON.stringify({ maxTautomers: limit }));
      }

      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
          tautomerSmiles = parsed.filter(s => typeof s === 'string');
        }
      }
    } catch (e) {
      return { smiles: h.value, error: `Tautomer enumeration failed: ${e.message}` };
    }

    // Deduplicate and canonicalize
    const seen = new Set();
    const unique = [];
    for (const smi of tautomerSmiles) {
      if (seen.has(smi)) continue;
      seen.add(smi);
      let tmol = null;
      try {
        tmol = RDKit.get_mol(smi);
        if (tmol && tmol.is_valid()) {
          const canon = tmol.get_smiles();
          if (!seen.has(canon)) {
            seen.add(canon);
            unique.push(canon);
          }
        } else {
          unique.push(smi);
        }
      } catch (_) {
        unique.push(smi);
      } finally {
        if (tmol) try { tmol.delete(); } catch (_) {}
      }
    }

    // Identify canonical tautomer (first in list is typically the canonical form)
    const canonicalTautomer = unique.length > 0 ? unique[0] : canonical;

    return {
      input_smiles: h.value,
      canonical_tautomer: canonicalTautomer,
      tautomers: unique.slice(0, limit),
      count: unique.length
    };

  } finally {
    if (mol) try { mol.delete(); } catch (_) {}
  }
}

/**
 * CLI entry point for the tautomers command.
 */
async function tautomers(args) {
  const smiles = args.smiles || (args._ && args._[0]);
  if (!smiles) {
    return { error: 'No SMILES provided. Use --smiles <smiles>' };
  }
  return enumerateTautomers({ smiles, limit: args.limit });
}

module.exports = { tautomers, enumerateTautomers };
