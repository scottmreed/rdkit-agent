'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Get atom counts from a molecule SMILES using RDKit
 */
async function getAtomCounts(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) throw new Error(h.error);

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      throw new Error(`Invalid molecule: ${smiles}`);
    }

    const jsonStr = mol.get_json();
    const molData = JSON.parse(jsonStr);
    const counts = {};

    if (molData && molData.molecules) {
      for (const m of molData.molecules) {
        if (m.atoms) {
          for (const atom of m.atoms) {
            const symbol = atom.element || atom.type;
            if (symbol && symbol !== 'H') {
              counts[symbol] = (counts[symbol] || 0) + 1;
            }
          }
        }
      }
    }

    // Fallback: use simple regex on canonical SMILES if JSON parsing didn't work
    if (Object.keys(counts).length === 0) {
      const canonical = mol.get_smiles();
      const atomRe = /\[([A-Z][a-z]?)[^\]]*\]|([B]r|[C]l|[BCNOPSF]|[bcnops])/g;
      let m;
      while ((m = atomRe.exec(canonical)) !== null) {
        const atom = (m[1] || m[2]).replace(/^[a-z]/, s => s.toUpperCase());
        if (atom !== 'H') {
          counts[atom] = (counts[atom] || 0) + 1;
        }
      }
    }

    return counts;
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Sum atom counts from multiple molecules
 */
function sumCounts(countsList) {
  const total = {};
  for (const counts of countsList) {
    for (const [elem, n] of Object.entries(counts)) {
      total[elem] = (total[elem] || 0) + n;
    }
  }
  return total;
}

/**
 * Main balance command
 */
async function balance(args) {
  let reactantSmiles = [];
  let productSmiles = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      reactantSmiles = parsed.reactants || [];
      productSmiles = parsed.products || [];
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else {
    if (args.reactants) {
      reactantSmiles = args.reactants.split(',').map(s => s.trim());
    }
    if (args.products) {
      productSmiles = args.products.split(',').map(s => s.trim());
    }
  }

  if (reactantSmiles.length === 0 || productSmiles.length === 0) {
    return { error: 'Both --reactants and --products are required' };
  }

  // Try RDKit-based counting
  let reactantCounts, productCounts;
  let useRDKit = true;

  try {
    const reactantCountsList = await Promise.all(reactantSmiles.map(getAtomCounts));
    const productCountsList = await Promise.all(productSmiles.map(getAtomCounts));
    reactantCounts = sumCounts(reactantCountsList);
    productCounts = sumCounts(productCountsList);
  } catch (e) {
    useRDKit = false;
    // Fallback: simple regex counting
    function countAtomsSimple(smilesList) {
      const counts = {};
      for (const smi of smilesList) {
        const atomRe = /\[([A-Z][a-z]?)[^\]]*\]|([B]r|[C]l|[BCNOPSF]|[bcnops])/g;
        let m;
        while ((m = atomRe.exec(smi)) !== null) {
          const atom = (m[1] || m[2]).replace(/^[a-z]/, s => s.toUpperCase());
          if (atom !== 'H') counts[atom] = (counts[atom] || 0) + 1;
        }
      }
      return counts;
    }
    reactantCounts = countAtomsSimple(reactantSmiles);
    productCounts = countAtomsSimple(productSmiles);
  }

  const allElements = new Set([...Object.keys(reactantCounts), ...Object.keys(productCounts)]);
  const elementBalance = {};
  const imbalances = [];

  for (const elem of allElements) {
    const r = reactantCounts[elem] || 0;
    const p = productCounts[elem] || 0;
    elementBalance[elem] = { reactants: r, products: p, balanced: r === p, delta: p - r };
    if (r !== p) {
      imbalances.push({ element: elem, reactants: r, products: p, delta: p - r });
    }
  }

  const balanced = imbalances.length === 0;

  return {
    balanced,
    reactants: reactantSmiles,
    products: productSmiles,
    element_balance: elementBalance,
    imbalances,
    summary: balanced
      ? 'Reaction is atom-balanced'
      : `Imbalanced elements: ${imbalances.map(i => `${i.element} (Δ${i.delta > 0 ? '+' : ''}${i.delta})`).join(', ')}`,
    method: useRDKit ? 'rdkit' : 'regex_fallback'
  };
}

module.exports = { balance, getAtomCounts, sumCounts };
