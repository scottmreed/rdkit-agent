'use strict';

const path = require('path');
const fs = require('fs');
const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

let RAW_FG_PATTERNS;
try {
  RAW_FG_PATTERNS = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'fg_patterns.json'), 'utf8')
  );
} catch (e) {
  RAW_FG_PATTERNS = [];
  console.error('Warning: Could not load fg_patterns.json:', e.message);
}

function normalizeFGPatterns(rawPatterns) {
  if (!Array.isArray(rawPatterns)) return [];

  const normalized = [];
  for (const entry of rawPatterns) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name || '').trim();
    if (!name) continue;

    const rawSmarts = Array.isArray(entry.smarts) ? entry.smarts : [entry.smarts];
    const smarts = rawSmarts
      .map(v => String(v || '').trim())
      .filter(Boolean);
    if (smarts.length === 0) continue;

    normalized.push({
      name,
      smarts,
      tier: Number.isFinite(Number(entry.tier)) ? Number(entry.tier) : 1,
      consume: entry.consume !== false,
    });
  }

  // deterministic order: tier first, then file order
  return normalized
    .map((entry, index) => ({ ...entry, _index: index }))
    .sort((a, b) => (a.tier - b.tier) || (a._index - b._index))
    .map(({ _index, ...entry }) => entry);
}

const FG_PATTERNS = normalizeFGPatterns(RAW_FG_PATTERNS);

function parseMatches(matchesJson) {
  if (!matchesJson || matchesJson === '[]') return [];
  try {
    const parsed = JSON.parse(matchesJson);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(match => {
        if (Array.isArray(match)) return match;
        if (match && Array.isArray(match.atoms)) return match.atoms;
        return [];
      })
      .filter(atoms => Array.isArray(atoms) && atoms.length > 0);
  } catch (_) {
    return [];
  }
}

function hasAtomOverlap(matchAtoms, claimedAtoms) {
  for (const atomIdx of matchAtoms) {
    if (claimedAtoms.has(atomIdx)) return true;
  }
  return false;
}

/**
 * Detect functional groups in a single molecule using tiered + consuming assignment.
 */
async function detectFG(smiles) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) {
    return { smiles, error: h.error, functional_groups: [] };
  }

  let mol = null;

  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule', functional_groups: [] };
    }

    const found = [];
    const claimedAtoms = new Set();
    const invalidPatterns = [];

    for (const pattern of FG_PATTERNS) {
      const acceptedMatches = [];
      const seenAtomSets = new Set();

      for (const smarts of pattern.smarts) {
        let qmol = null;
        try {
          qmol = RDKit.get_qmol(smarts);
          if (!qmol || !qmol.is_valid()) {
            invalidPatterns.push({ name: pattern.name, smarts, reason: 'invalid_qmol' });
            continue;
          }

          const matches = parseMatches(mol.get_substruct_matches(qmol));
          for (const match of matches) {
            const atomSet = Array.from(new Set(match)).sort((a, b) => a - b);
            const atomKey = atomSet.join('-');

            if (!atomKey || seenAtomSets.has(atomKey)) continue;
            if (pattern.consume && hasAtomOverlap(atomSet, claimedAtoms)) continue;

            acceptedMatches.push(atomSet);
            seenAtomSets.add(atomKey);
            if (pattern.consume) {
              for (const atomIdx of atomSet) claimedAtoms.add(atomIdx);
            }
          }
        } catch (e) {
          invalidPatterns.push({ name: pattern.name, smarts, reason: String(e.message || e) });
        } finally {
          if (qmol) {
            try { qmol.delete(); } catch (_) {}
          }
        }
      }

      if (acceptedMatches.length > 0) {
        found.push({
          name: pattern.name,
          count: acceptedMatches.length,
          smarts: pattern.smarts[0],
          tier: pattern.tier,
          consume: pattern.consume,
          matches: acceptedMatches,
        });
      }
    }

    return {
      smiles: h.value,
      canonical_smiles: mol.get_smiles(),
      functional_groups: found,
      count: found.length,
      diagnostics: {
        backend: 'tiered_consuming_smarts_v1',
        patterns_total: FG_PATTERNS.length,
        invalid_patterns: invalidPatterns,
      },
    };
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main fg command
 */
async function fg(args) {
  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.molecules) molecules = parsed.molecules;
      else if (parsed.smiles) molecules = [parsed.smiles];
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

  const results = await Promise.all(molecules.map(detectFG));

  if (results.length === 1) {
    return results[0];
  }

  return { count: results.length, results };
}

module.exports = { fg, detectFG, FG_PATTERNS, normalizeFGPatterns };
