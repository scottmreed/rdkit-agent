'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Apply a reaction SMIRKS to a single reactant SMILES and return unique product SMILES.
 *
 * @param {object} RDKit  - Initialized RDKit WASM module
 * @param {object} rxn    - ChemicalReaction object from RDKit.get_rxn()
 * @param {string} reactantSmiles
 * @returns {{ reactant: string, products: string[], error?: string }}
 */
async function runOneReactant(RDKit, rxn, reactantSmiles) {
  const hr = harden(reactantSmiles, 'smiles');
  if (hr.error) {
    return { reactant: reactantSmiles, products: [], error: hr.error };
  }

  let mol = null;
  let ml = null;
  let resultList = null;
  try {
    mol = RDKit.get_mol(hr.value);
    if (!mol || !mol.is_valid()) {
      return { reactant: hr.value, products: [], error: 'Invalid molecule' };
    }

    // run_reactants requires a MolList (WASM typed container)
    ml = new RDKit.MolList();
    ml.append(mol);

    resultList = rxn.run_reactants(ml, 1000);

    const seen = new Set();
    const unique = [];
    const n = resultList.size();
    for (let i = 0; i < n; i++) {
      const productSet = resultList.get(i);
      const m = productSet.size();
      for (let j = 0; j < m; j++) {
        let pmol = null;
        try {
          pmol = productSet.at(j);
          if (pmol && pmol.is_valid()) {
            const smi = pmol.get_smiles();
            if (smi && !seen.has(smi)) {
              seen.add(smi);
              unique.push(smi);
            }
          }
        } catch (_) {}
        // Product mols from run_reactants are owned by the result list; do not delete here
      }
    }

    return { reactant: hr.value, products: unique };
  } catch (e) {
    return { reactant: hr.value, products: [], error: `Reaction failed: ${e.message}` };
  } finally {
    // Note: resultList mols are owned by the JSMolListList — do not delete individual product mols.
    // The resultList itself does not need explicit delete in rdkit-js WASM.
    if (mol) try { mol.delete(); } catch (_) {}
    if (ml) try { ml.delete(); } catch (_) {}
  }
}

/**
 * Apply a reaction SMIRKS to one or more reactant SMILES.
 *
 * @param {{ smirks: string, reactants: string|string[] }} args
 * @returns {Promise<object>}
 */
async function reactionApply(args) {
  const smirks = args.smirks;
  let reactants = args.reactants;

  if (!smirks) {
    return { error: 'No SMIRKS provided. Use --smirks <smirks>' };
  }

  // Normalise reactants to an array
  if (!reactants || (Array.isArray(reactants) && reactants.length === 0)) {
    return { error: 'No reactants provided. Use --reactants <smiles,...>' };
  }
  if (typeof reactants === 'string') {
    reactants = reactants.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(reactants)) reactants = [reactants];

  const RDKit = await getRDKit();

  // WASM capability check — get_rxn exists in @rdkit/rdkit ≥ 2022.03
  if (typeof RDKit.get_rxn !== 'function') {
    const err = new Error(
      'Reaction chemistry (get_rxn / run_reactants) is not available in this RDKit WASM build. ' +
      'This feature requires a WASM build that includes reaction support ' +
      '(@rdkit/rdkit >= 2022.03) or full Python RDKit.'
    );
    err.code = 'NOT_SUPPORTED_IN_WASM';
    throw err;
  }

  const h = harden(smirks, 'smirks');
  if (h.error) return { smirks, error: h.error };

  // get_rxn returns null for invalid SMIRKS
  let rxn = null;
  try {
    rxn = RDKit.get_rxn(h.value);
    if (!rxn) {
      return { smirks, error: 'Invalid reaction SMIRKS — could not parse as a reaction' };
    }

    const perReactant = await Promise.all(
      reactants.map(r => runOneReactant(RDKit, rxn, r))
    );

    // products array: one entry per input reactant, each entry is [smi, ...]
    const products = perReactant.map(r => r.products);
    const errors = perReactant
      .filter(r => r.error)
      .map(r => ({ reactant: r.reactant, error: r.error }));

    const result = {
      reaction: h.value,
      reactant_count: reactants.length,
      products
    };
    if (errors.length > 0) result.errors = errors;
    return result;

  } finally {
    // rxn does not expose delete() in rdkit-js WASM
  }
}

/**
 * CLI entry point for the react command.
 */
async function react(args) {
  const smirks = args.smirks;

  // Collect reactants from --reactants flag (comma-separated) and positional args
  let reactants = [];
  if (args.reactants) {
    const raw = Array.isArray(args.reactants) ? args.reactants : args.reactants.split(',');
    reactants.push(...raw.map(s => s.trim()).filter(Boolean));
  }
  if (args._ && args._.length > 0) {
    reactants.push(...args._);
  }

  if (!smirks) {
    return { error: 'No SMIRKS provided. Use --smirks <smirks>' };
  }
  if (reactants.length === 0) {
    return { error: 'No reactants provided. Use --reactants "CCO,CCCO" or --reactants "CCO" "CCCO"' };
  }

  return reactionApply({ smirks, reactants });
}

module.exports = { react, reactionApply };
