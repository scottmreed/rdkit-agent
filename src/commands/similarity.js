'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Run fn over arr with at most `concurrency` items in-flight at once.
 * Preserves input order in the returned array.
 */
async function parallelMap(arr, fn, concurrency) {
  const results = new Array(arr.length);
  let next = 0;
  async function worker() {
    while (next < arr.length) {
      const i = next++;
      results[i] = await fn(arr[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, arr.length) }, worker));
  return results;
}

/**
 * Compute Tanimoto similarity between two fingerprint bit strings
 */
function tanimoto(fp1, fp2) {
  if (!fp1 || !fp2 || fp1.length !== fp2.length) return 0;
  let intersect = 0;
  let union = 0;
  for (let i = 0; i < fp1.length; i++) {
    const a = fp1[i] === '1';
    const b = fp2[i] === '1';
    if (a && b) intersect++;
    if (a || b) union++;
  }
  return union === 0 ? 0 : intersect / union;
}

/**
 * Get Morgan fingerprint for a molecule
 */
async function getMorganFP(mol, nbits, radius) {
  try {
    const details = JSON.stringify({ nBits: nbits, radius });
    return mol.get_morgan_fp(details);
  } catch (e) {
    return null;
  }
}

/**
 * Main similarity command
 */
async function similarity(args) {
  const threshold = parseFloat(args.threshold) || 0.7;
  const top = parseInt(args.top) || 10;
  const fpType = (args.type || 'morgan').toLowerCase();
  const nbits = parseInt(args.nbits) || 2048;
  const radius = parseInt(args.radius) || 2;

  let querySmiles = args.query;
  let targetSmiles = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      querySmiles = parsed.query || querySmiles;
      targetSmiles = parsed.targets || targetSmiles;
      if (parsed.threshold !== undefined) threshold = parsed.threshold;
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.targets) {
    targetSmiles = Array.isArray(args.targets) ? args.targets : args.targets.split(',').map(s => s.trim());
  }

  if (!querySmiles) {
    return { error: 'No query molecule provided. Use --query <smiles>' };
  }
  if (targetSmiles.length === 0) {
    return { error: 'No target molecules provided. Use --targets <smiles,...>' };
  }

  const RDKit = await getRDKit();

  // Parse query
  const qh = harden(querySmiles, 'smiles');
  if (qh.error) return { error: `Query: ${qh.error}` };

  let queryMol = null;
  let queryFP = null;

  try {
    queryMol = RDKit.get_mol(qh.value);
    if (!queryMol || !queryMol.is_valid()) {
      return { error: `Invalid query molecule: ${querySmiles}` };
    }
    queryFP = await getMorganFP(queryMol, nbits, radius);
    if (!queryFP) return { error: 'Failed to generate query fingerprint' };
  } finally {
    if (queryMol) {
      try { queryMol.delete(); } catch (_) {}
    }
  }

  // Process targets in parallel. WASM is single-threaded so there is no true CPU
  // parallelism, but Promise.all avoids re-entering the event loop between targets
  // and keeps the pattern consistent with other multi-molecule commands.
  // A concurrency cap avoids creating thousands of live mol objects for large lists.
  const CONCURRENCY = 16;
  const results = await parallelMap(targetSmiles, async (smi, i) => {
    const h = harden(smi, 'smiles');
    if (h.error) return { smiles: smi, similarity: 0, error: h.error };

    let mol = null;
    try {
      mol = RDKit.get_mol(h.value);
      if (!mol || !mol.is_valid()) return { smiles: smi, similarity: 0, error: 'Invalid molecule' };

      const fp = await getMorganFP(mol, nbits, radius);
      if (!fp) return { smiles: smi, similarity: 0, error: 'Failed to generate fingerprint' };

      const sim = tanimoto(queryFP, fp);
      return {
        index: i,
        smiles: smi,
        canonical_smiles: mol.get_smiles(),
        similarity: Math.round(sim * 10000) / 10000
      };
    } finally {
      if (mol) { try { mol.delete(); } catch (_) {} }
    }
  }, CONCURRENCY);

  // Sort by similarity descending
  results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  // Filter by threshold and apply top N limit
  const aboveThreshold = results.filter(r => (r.similarity || 0) >= threshold);
  const topN = aboveThreshold.slice(0, top);

  return {
    query: qh.value,
    threshold,
    top,
    total_targets: targetSmiles.length,
    above_threshold: aboveThreshold.length,
    results: topN,
    all_results: results
  };
}

module.exports = { similarity, tanimoto };
