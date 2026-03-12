'use strict';

const fs = require('fs');
const path = require('path');
const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');
const { aliasCheck, heuristicCheck } = require('./check');
const { detectFG } = require('./fg');

const CHECKMOL_CSV_PATH = path.join(__dirname, '..', '..', 'data', 'checkmol_smarts_part1.csv');

let RAW_CHECKMOL_PATTERNS = [];
try {
  const csvText = fs.readFileSync(CHECKMOL_CSV_PATH, 'utf8');
  RAW_CHECKMOL_PATTERNS = loadCheckmolPatterns(csvText);
} catch (_) {
  RAW_CHECKMOL_PATTERNS = [];
}

function parseCheckmolLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('id,')) return null;

  // checkmol export uses id,name,"smarts1,smarts2,..."
  const quotedMatch = trimmed.match(/^([^,]+),(.*),"(.*)"$/);
  if (quotedMatch) {
    const id = quotedMatch[1].trim();
    const name = quotedMatch[2].trim();
    const smartsRaw = quotedMatch[3].trim();
    const smarts = smartsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!id || !name || smarts.length === 0) return null;
    return { id, name, smarts };
  }

  // Fallback for unquoted smarts field
  const parts = trimmed.split(',');
  if (parts.length < 3) return null;
  const id = parts.shift().trim();
  const name = parts.shift().trim();
  const smarts = parts.join(',').split(',').map((s) => s.trim()).filter(Boolean);
  if (!id || !name || smarts.length === 0) return null;
  return { id, name, smarts };
}

function loadCheckmolPatterns(csvText) {
  const lines = String(csvText || '').split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    const entry = parseCheckmolLine(line);
    if (entry) parsed.push(entry);
  }
  return parsed;
}

function parseMatches(matchesJson) {
  if (!matchesJson || matchesJson === '[]') return [];
  try {
    const parsed = JSON.parse(matchesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((match) => {
        if (Array.isArray(match)) return match;
        if (match && Array.isArray(match.atoms)) return match.atoms;
        return [];
      })
      .filter((atoms) => Array.isArray(atoms) && atoms.length > 0);
  } catch (_) {
    return [];
  }
}

function countUnpairedRingDigits(smiles) {
  const counts = new Map();
  const text = String(smiles || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9' && text[i - 1] !== '%') {
      counts.set(ch, (counts.get(ch) || 0) + 1);
    }
  }
  const unpaired = [];
  for (const [digit, count] of counts.entries()) {
    if (count % 2 !== 0) unpaired.push(digit);
  }
  return unpaired;
}

function trimUnpairedRingDigits(smiles) {
  const text = String(smiles || '');
  const unpaired = countUnpairedRingDigits(text);
  if (unpaired.length === 0) return null;
  let fixed = text;
  for (const digit of unpaired) {
    const idx = fixed.lastIndexOf(digit);
    if (idx >= 0) {
      fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
    }
  }
  return fixed !== text ? fixed : null;
}

function balanceBracketAndParenClosures(smiles) {
  const text = String(smiles || '');
  let squareDepth = 0;
  let parenDepth = 0;
  let out = '';

  for (const ch of text) {
    if (ch === '[') {
      squareDepth += 1;
      out += ch;
    } else if (ch === ']') {
      if (squareDepth > 0) {
        squareDepth -= 1;
        out += ch;
      }
    } else if (ch === '(') {
      parenDepth += 1;
      out += ch;
    } else if (ch === ')') {
      if (parenDepth > 0) {
        parenDepth -= 1;
        out += ch;
      }
    } else {
      out += ch;
    }
  }

  if (squareDepth > 0) out += ']'.repeat(squareDepth);
  if (parenDepth > 0) out += ')'.repeat(parenDepth);
  return out !== text ? out : null;
}

function stripNonSmilesCharacters(smiles) {
  const text = String(smiles || '');
  const stripped = text.replace(/[^A-Za-z0-9@+\-=\/#%\[\]().\\:*]/g, '');
  return stripped !== text ? stripped : null;
}

/** Replace R-group placeholder R with C (e.g. COOR -> COOC). Does not change Br. */
function replaceRWithC(smiles) {
  const text = String(smiles || '');
  if (!text.includes('R')) return null;
  const replaced = text.replace(/(?<![B])R/g, 'C');
  return replaced !== text ? replaced : null;
}

function inferIntentFromRaw(rawInput) {
  const raw = String(rawInput || '').trim();
  const estimatedAtomTokens = (raw.match(/Cl|Br|Si|Li|Na|Mg|Ca|Al|Fe|Zn|Cu|Ni|Co|Mn|Cr|Se|As|[A-Z]/g) || []).length;
  const ringDigits = raw.match(/\d/g) || [];
  const expectedRings = Math.floor(ringDigits.length / 2);

  const fgHints = [];
  const rawUpper = raw.toUpperCase();
  if (/\[N\+\]\(=O\)\[O-\]|N\(=O\)O|N\(=O\)\[O-\]/i.test(raw)) fgHints.push('nitro');
  if (/C\(=O\)|C=O/.test(rawUpper)) fgHints.push('carbonyl');
  if (/C#N/.test(rawUpper)) fgHints.push('nitrile');
  if (/S\(=O\)\(=O\)/.test(rawUpper)) fgHints.push('sulfonyl');
  if (/(F|CL|BR|I)/.test(rawUpper) && /C/.test(rawUpper)) fgHints.push('halide');
  if (/N/.test(rawUpper)) fgHints.push('amine_like');
  if (/O/.test(rawUpper)) fgHints.push('oxygenated');

  return {
    raw,
    expected_rings: expectedRings,
    estimated_atom_tokens: estimatedAtomTokens,
    fg_hints: Array.from(new Set(fgHints)),
  };
}

function scoreCandidate(candidate, intent) {
  let score = 0;
  if (candidate.valid) score += 6;
  if (candidate.source === 'alias_correction') score += 3;
  if (candidate.source === 'heuristic_correction') score += 2;
  if (candidate.source === 'ring_digit_trim') score += 1.5;
  if (candidate.source === 'closure_balance') score += 1.2;
  if (candidate.source === 'charset_strip') score += 0.5;
  if (candidate.source === 'r_substitute_c') score += 1.5;

  if (typeof candidate.rings === 'number' && intent.expected_rings > 0) {
    score += Math.max(0, 3 - Math.abs(candidate.rings - intent.expected_rings));
  }
  if (typeof candidate.heavy_atoms === 'number' && intent.estimated_atom_tokens > 0) {
    score += Math.max(0, 3 - Math.abs(candidate.heavy_atoms - intent.estimated_atom_tokens) * 0.5);
  }

  const groups = new Set((candidate.functional_groups || []).concat(candidate.checkmol_groups || []).map((g) => String(g).toLowerCase()));
  for (const hint of intent.fg_hints || []) {
    if (hint === 'carbonyl' && Array.from(groups).some((g) => /aldehyde|ketone|amide|ester|acid|carbonyl/.test(g))) score += 1.5;
    if (hint === 'nitro' && Array.from(groups).some((g) => /nitro/.test(g))) score += 1.5;
    if (hint === 'nitrile' && Array.from(groups).some((g) => /nitrile/.test(g))) score += 1.2;
    if (hint === 'sulfonyl' && Array.from(groups).some((g) => /sulfon|sulfone|sulfoxide/.test(g))) score += 1.2;
    if (hint === 'halide' && Array.from(groups).some((g) => /halide/.test(g))) score += 1.0;
    if (hint === 'amine_like' && Array.from(groups).some((g) => /amine|ammonium|amide|imine/.test(g))) score += 1.0;
    if (hint === 'oxygenated' && Array.from(groups).some((g) => /alcohol|ether|ester|acid|phenol|carbonyl/.test(g))) score += 1.0;
  }

  return Math.round(score * 1000) / 1000;
}

async function detectCheckmolGroups(mol, RDKit) {
  if (!RAW_CHECKMOL_PATTERNS.length) return [];
  const found = [];

  for (const entry of RAW_CHECKMOL_PATTERNS) {
    let matched = false;
    for (const smarts of entry.smarts) {
      let qmol = null;
      try {
        qmol = RDKit.get_qmol(smarts);
        if (!qmol || !qmol.is_valid()) continue;
        const matches = parseMatches(mol.get_substruct_matches(qmol));
        if (matches.length > 0) {
          matched = true;
          break;
        }
      } catch (_) {
        // ignore malformed SMARTS rows in external catalog
      } finally {
        if (qmol) {
          try { qmol.delete(); } catch (_) {}
        }
      }
    }
    if (matched) found.push(entry.name);
  }

  return found;
}

async function evaluateCandidate(candidate, intent, RDKit) {
  const value = String(candidate || '').trim();
  if (!value) {
    return { source: 'unknown', candidate: value, valid: false, error: 'empty_candidate' };
  }

  let mol = null;
  try {
    mol = RDKit.get_mol(value);
    if (!mol || !mol.is_valid()) {
      return { source: 'unknown', candidate: value, valid: false, error: 'rdkit_parse_failed' };
    }

    const canonical = mol.get_smiles();
    let rings = null;
    let heavyAtoms = null;
    try {
      const descs = JSON.parse(mol.get_descriptors() || '{}');
      rings = descs.RingCount || descs.NumRings || null;
      heavyAtoms = descs.NumHeavyAtoms || descs.HeavyAtomCount || null;
    } catch (_) {
      // descriptor extraction is optional for repair ranking
    }

    const fgResult = await detectFG(canonical);
    const functionalGroups = Array.isArray(fgResult.functional_groups)
      ? fgResult.functional_groups.map((g) => g.name).filter(Boolean)
      : [];
    const checkmolGroups = await detectCheckmolGroups(mol, RDKit);

    const result = {
      valid: true,
      candidate: value,
      canonical_smiles: canonical,
      rings,
      heavy_atoms: heavyAtoms,
      functional_groups: functionalGroups,
      checkmol_groups: checkmolGroups,
    };
    result.score = scoreCandidate(result, intent);
    return result;
  } catch (e) {
    return { source: 'unknown', candidate: value, valid: false, error: String(e.message || e) };
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

function buildCandidateList(rawInput) {
  const raw = String(rawInput || '').trim();
  const seen = new Set();
  const candidates = [];
  const push = (source, value) => {
    const v = String(value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    candidates.push({ source, value: v });
  };

  push('raw', raw);

  const hardened = harden(raw, 'smiles');
  if (hardened && hardened.value) push('harden', hardened.value);

  const aliasResult = aliasCheck(hardened && hardened.value ? hardened.value : raw);
  if (aliasResult.corrected && aliasResult.corrected_value) {
    push('alias_correction', aliasResult.corrected_value);
  }

  const heuristicInput = aliasResult.corrected && aliasResult.corrected_value
    ? aliasResult.corrected_value
    : (hardened && hardened.value ? hardened.value : raw);
  const heuristicResult = heuristicCheck(heuristicInput);
  if (heuristicResult.corrected_value) {
    push('heuristic_correction', heuristicResult.corrected_value);
  }

  const ringTrimmed = trimUnpairedRingDigits(heuristicInput);
  if (ringTrimmed) push('ring_digit_trim', ringTrimmed);

  const balanced = balanceBracketAndParenClosures(heuristicInput);
  if (balanced) push('closure_balance', balanced);

  const stripped = stripNonSmilesCharacters(heuristicInput);
  if (stripped) push('charset_strip', stripped);

  const rSubstituted = replaceRWithC(raw);
  if (rSubstituted) push('r_substitute_c', rSubstituted);
  const rSubstitutedFromHeuristic = replaceRWithC(heuristicInput);
  if (rSubstitutedFromHeuristic && rSubstitutedFromHeuristic !== rSubstituted) push('r_substitute_c', rSubstitutedFromHeuristic);

  return candidates;
}

function summariseConfidence(best, secondBest) {
  const bestScore = typeof best.score === 'number' ? best.score : 0;
  const secondScore = secondBest && typeof secondBest.score === 'number' ? secondBest.score : 0;
  const gap = bestScore - secondScore;

  if (bestScore >= 10 && gap >= 2) return { label: 'high', value: 0.9 };
  if (bestScore >= 7 && gap >= 1) return { label: 'medium', value: 0.7 };
  return { label: 'low', value: 0.5 };
}

async function repairOneSmiles(input, options) {
  const raw = String(input || '').trim();
  if (!raw) {
    return {
      success: false,
      input: raw,
      error: 'empty_input',
      attempts: [],
    };
  }

  const RDKit = await getRDKit();
  const intent = inferIntentFromRaw(raw);
  const candidateList = buildCandidateList(raw);
  const maxCandidates = Number.isFinite(Number(options.maxCandidates))
    ? Math.max(1, Number(options.maxCandidates))
    : 12;
  const sliced = candidateList.slice(0, maxCandidates);

  const attempts = [];
  for (const item of sliced) {
    const evaluated = await evaluateCandidate(item.value, intent, RDKit);
    attempts.push({
      ...evaluated,
      source: item.source,
      candidate: item.value,
    });
  }

  const valid = attempts.filter((attempt) => attempt.valid);
  if (valid.length === 0) {
    return {
      success: false,
      input: raw,
      error: 'no_valid_repair_found',
      intent,
      attempts,
    };
  }

  valid.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = valid[0];
  const second = valid[1] || null;
  const confidence = summariseConfidence(best, second);

  return {
    success: true,
    input: raw,
    repaired_smiles: best.canonical_smiles,
    canonical_smiles: best.canonical_smiles,
    strategy: best.source,
    confidence: confidence.value,
    confidence_label: confidence.label,
    intent,
    best_candidate: best,
    attempts,
  };
}

async function repairSmiles(args) {
  let molecules = [];
  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.molecules) molecules = parsed.molecules;
      else if (parsed.input) molecules = [parsed.input];
      else if (parsed.smiles) molecules = [parsed.smiles];
      else if (Array.isArray(parsed)) molecules = parsed;
    } catch (e) {
      return { error: `Invalid JSON input: ${e.message}` };
    }
  } else if (args.input) {
    molecules = [args.input];
  } else if (args.smiles) {
    molecules = Array.isArray(args.smiles) ? args.smiles : [args.smiles];
  } else if (args.molecules) {
    molecules = Array.isArray(args.molecules) ? args.molecules : [args.molecules];
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (!molecules.length) {
    return { error: 'No input provided. Use --input <smiles> or --json \'{"input":"..."}\'' };
  }

  const options = {
    maxCandidates: args['max-candidates'] || args.max_candidates || 12,
  };
  const results = await Promise.all(molecules.map((mol) => repairOneSmiles(mol, options)));

  if (results.length === 1) return results[0];

  return {
    count: results.length,
    repaired: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

module.exports = {
  repairSmiles,
  repairOneSmiles,
  parseCheckmolLine,
  loadCheckmolPatterns,
  inferIntentFromRaw,
  trimUnpairedRingDigits,
  balanceBracketAndParenClosures,
  stripNonSmilesCharacters,
  replaceRWithC,
};
