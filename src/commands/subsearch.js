'use strict';

const fs = require('fs');
const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Perform substructure search
 */
async function subsearch(args) {
  const query = args.query || args.smarts || (args._ && args._[0]);
  if (!query) {
    return { error: 'No query SMARTS provided. Use --query <smarts>' };
  }

  let targets = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.targets) targets = parsed.targets;
      if (parsed.query === undefined && !query) {
        return { error: 'No query in JSON input' };
      }
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.targets) {
    targets = Array.isArray(args.targets) ? args.targets : args.targets.split(',').map(s => s.trim());
  } else if (args.file) {
    try {
      const content = fs.readFileSync(args.file, 'utf8');
      // Parse SDF or line-by-line SMILES
      if (args.file.endsWith('.sdf') || content.includes('$$$$')) {
        targets = content.split('$$$$').map(b => b.trim()).filter(Boolean);
      } else {
        targets = content.split('\n').map(s => s.trim()).filter(Boolean);
      }
    } catch (e) {
      return { error: `Could not read file '${args.file}': ${e.message}` };
    }
  }

  if (targets.length === 0) {
    return { error: 'No target molecules provided. Use --targets <smiles,...> or --file <path>' };
  }

  const RDKit = await getRDKit();
  let qmol = null;

  try {
    qmol = RDKit.get_qmol(query);
    if (!qmol || !qmol.is_valid()) {
      return { error: `Invalid SMARTS query: ${query}` };
    }

    // Process targets in parallel. qmol is read-only (used only for matching) so
    // sharing it across concurrent iterations is safe with the single-threaded WASM module.
    // Promise.all completes before the outer finally block deletes qmol.
    const targetResults = await Promise.all(targets.map(async (target, i) => {
      let mol = null;
      try {
        const h = harden(target, 'smiles');
        const molInput = h.error ? target : h.value;
        mol = RDKit.get_mol(molInput);

        if (!mol || !mol.is_valid()) {
          return { index: i, smiles: target, error: 'Invalid molecule', matched: false };
        }

        const matchResult = mol.get_substruct_match(qmol);
        const matched = matchResult && matchResult !== '{}';

        if (matched) {
          let matchDetails = null;
          try { matchDetails = JSON.parse(matchResult); } catch (_) {}
          return {
            index: i,
            smiles: target,
            canonical_smiles: mol.get_smiles(),
            matched: true,
            match_atoms: matchDetails
          };
        }
        return { index: i, smiles: target, matched: false };
      } finally {
        if (mol) { try { mol.delete(); } catch (_) {} }
      }
    }));

    const matches = targetResults.filter(r => r.matched);
    const nonmatches = targetResults.filter(r => !r.matched);

    return {
      query,
      total: targets.length,
      matched: matches.length,
      not_matched: nonmatches.length,
      matches,
      include_nonmatches: args['include-all'] || false
    };

  } finally {
    if (qmol) {
      try { qmol.delete(); } catch (_) {}
    }
  }
}

module.exports = { subsearch };
