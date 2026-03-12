'use strict';

const { harden, checkBrackets, applyAlias, isEnglishWord, stripArtifacts } = require('../hardening');
const { getRDKit } = require('../wasm');
const { getAtomCounts } = require('./balance');

// SMILES legal charset: atoms, bonds, branches, ring closures, stereo, charges.
const INVALID_SMILES_CHARS = /[^A-Za-z0-9@+\-=\/#%\[\]().\\:*~]/g;

const FIX_SUGGESTIONS = {
  input_required: 'Provide one check payload: --smiles, --smirks, --dbe, --state-progress, or --mechanism-step.',
  smiles_hardening_failed: 'Remove non-chemical text artifacts and submit only the SMILES string.',
  smiles_empty: 'Provide a non-empty SMILES string.',
  smiles_bracket_mismatch: 'Balance all [ ] and ( ) brackets in the SMILES string.',
  smiles_invalid_charset: 'Remove invalid characters; keep only valid SMILES tokens.',
  smiles_looks_like_word: 'Use explicit SMILES notation, not common-language molecule names.',
  smiles_ring_unclosed: 'Ensure each ring closure index appears exactly twice.',
  smiles_rdkit_parse_failed: 'Use valid SMILES syntax with proper atom/bond notation and valence.',
  smiles_canonicalization_failed: 'Retry with an explicit, fully bracketed SMILES representation.',
  smiles_valence_failed: 'Correct valence and charge assignments for bracketed atoms.',
  smirks_missing_arrow: 'SMIRKS must contain exactly one reaction arrow: reactants>>products.',
  smirks_multiple_arrows: 'Use a single >> separator between reactants and products.',
  smirks_reactants_empty: 'Include at least one valid reactant species.',
  smirks_products_empty: 'Include at least one valid product species.',
  smirks_invalid_species: 'Fix invalid species SMILES on the indicated SMIRKS side.',
  smirks_rdkit_parse_failed: 'Provide a parseable reaction core; keep CX metadata outside the reaction core.',
  atom_balance_invalid_species: 'Fix invalid species SMILES before running atom-balance checks.',
  atom_balance_unbalanced: 'Conserve atom counts across reactants and products (including counterions/byproducts).',
  dbe_missing_entries: 'Provide DBE entries in mapI-mapJ:delta form, separated by semicolons.',
  dbe_entry_missing_separator: 'Each DBE token must include a colon between pair and delta.',
  dbe_entry_missing_pair: 'Each DBE token must include a pair in mapI-mapJ format.',
  dbe_entry_non_numeric_map: 'Use numeric atom-map indices in every DBE token.',
  dbe_entry_non_integer_delta: 'Use an integer delta for every DBE token.',
  dbe_empty_after_parse: 'Provide at least one non-empty DBE token.',
  dbe_non_conserving: 'Ensure DBE deltas sum to zero, or run with non-strict policy if warning-only behavior is desired.',
  dbe_missing: 'Provide bond_electron_validation, explicit dbe entries, or a reaction_smirks dbe metadata block.',
  state_progress_missing: 'Provide progress booleans or both current_state and resulting_state arrays.',
  state_progress_no_change: 'Ensure resulting_state differs from current_state and reflects forward progress.',
  state_progress_unchanged_starting_materials: 'Transform at least one starting-material species in the resulting state.',
  mechanism_step_invalid_payload: 'Provide mechanism-step payload fields as JSON object properties.',
};

function suggestionFor(errorCode, fallbackMessage) {
  if (errorCode && FIX_SUGGESTIONS[errorCode]) {
    return FIX_SUGGESTIONS[errorCode];
  }
  if (fallbackMessage) {
    return `Resolve validation failure: ${fallbackMessage}`;
  }
  return 'Resolve validation failure and retry.';
}

function createCheck(options) {
  const payload = {
    name: String(options.name || 'unknown_check'),
    pass: Boolean(options.pass),
    message: String(options.message || ''),
    backend: 'rdkit_cli',
    method: String(options.method || 'check'),
  };

  if (!payload.pass && options.error_code) {
    payload.error_code = String(options.error_code);
  }
  if (options.layer !== undefined) {
    payload.layer = options.layer;
  }
  if (options.skipped) {
    payload.skipped = true;
  }
  if (options.corrected !== undefined) {
    payload.corrected = Boolean(options.corrected);
  }
  if (options.corrected_value !== undefined) {
    payload.corrected_value = options.corrected_value;
  }
  if (options.details && typeof options.details === 'object') {
    payload.details = options.details;
  }
  if (options.diagnostics && typeof options.diagnostics === 'object') {
    payload.diagnostics = options.diagnostics;
  }
  return payload;
}

function buildResult(checks, options) {
  const opts = options || {};
  const failed = checks.filter((item) => item && item.pass === false && !item.skipped);
  const warnings = checks.filter((item) => item && item.skipped === true);

  const correctedValues = {};
  for (const item of checks) {
    if (item && item.corrected && item.corrected_value !== undefined) {
      correctedValues[item.name] = item.corrected_value;
    }
  }

  const seenSuggestions = new Set();
  const fixSuggestions = [];
  for (const item of failed) {
    const suggestion = suggestionFor(item.error_code, item.message);
    if (!seenSuggestions.has(suggestion)) {
      seenSuggestions.add(suggestion);
      fixSuggestions.push(suggestion);
    }
  }

  const failedChecks = failed.map((item) => ({
    name: item.name,
    error_code: item.error_code || null,
    message: item.message,
    details: item.details || {},
  }));

  const failedCheckNames = failedChecks.map((item) => item.name);
  const overallPass = failedChecks.length === 0;

  let summary;
  if (overallPass) {
    summary = `Validation passed${warnings.length > 0 ? ' (with warnings)' : ''}`;
  } else {
    summary = `Validation failed: ${failedCheckNames.join(', ')}`;
  }

  return {
    overall_pass: overallPass,
    summary,
    mode: String(opts.mode || 'smiles'),
    backend: 'rdkit_cli',
    method: String(opts.method || `check.${String(opts.mode || 'smiles')}`),
    checks,
    failed_checks: failedChecks,
    failed_check_names: failedCheckNames,
    warnings,
    fix_suggestions: fixSuggestions,
    corrected_values: correctedValues,
    diagnostics: (opts.diagnostics && typeof opts.diagnostics === 'object') ? opts.diagnostics : {},
  };
}

function parseCsvOrArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function stripCxMetadata(text) {
  const raw = String(text || '').trim();
  const removed = [];
  const core = raw.replace(/\|[^|]*\|/g, (chunk) => {
    removed.push(chunk);
    return '';
  }).replace(/\s+/g, ' ').trim();

  return {
    raw,
    core,
    metadata_blocks: removed,
  };
}

function multisetSignature(items) {
  const counts = {};
  for (const item of items) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return JSON.stringify(Object.keys(counts).sort().map((key) => [key, counts[key]]));
}

/**
 * Layer 1: Pure syntax check, no RDKit.
 */
function syntaxCheck(smiles) {
  const checks = [];

  const bracketErrors = checkBrackets(smiles);
  if (bracketErrors.length > 0) {
    checks.push(createCheck({
      layer: 1,
      name: 'bracket_matching',
      pass: false,
      error_code: 'smiles_bracket_mismatch',
      message: bracketErrors.join('; '),
      method: 'check.smiles.syntax',
      details: { bracket_errors: bracketErrors },
    }));
  } else {
    checks.push(createCheck({
      layer: 1,
      name: 'bracket_matching',
      pass: true,
      message: 'All brackets balanced',
      method: 'check.smiles.syntax',
    }));
  }

  const invalidChars = smiles.match(INVALID_SMILES_CHARS);
  if (invalidChars) {
    const unique = Array.from(new Set(invalidChars));
    checks.push(createCheck({
      layer: 1,
      name: 'charset_validation',
      pass: false,
      error_code: 'smiles_invalid_charset',
      message: `Invalid SMILES characters found: ${unique.map((c) => `'${c}'`).join(', ')}`,
      method: 'check.smiles.syntax',
      details: { invalid_chars: unique },
    }));
  } else {
    checks.push(createCheck({
      layer: 1,
      name: 'charset_validation',
      pass: true,
      message: 'All characters are valid SMILES characters',
      method: 'check.smiles.syntax',
    }));
  }

  const wordCheck = isEnglishWord(smiles);
  if (wordCheck.isWord) {
    const suggestion = wordCheck.suggestion ? ` Did you mean: ${wordCheck.suggestion}` : '';
    checks.push(createCheck({
      layer: 1,
      name: 'english_word_check',
      pass: false,
      error_code: 'smiles_looks_like_word',
      message: `Input looks like an English word, not SMILES notation.${suggestion}`,
      method: 'check.smiles.syntax',
      details: { alias_suggestion: wordCheck.suggestion || null },
    }));
  } else {
    checks.push(createCheck({
      layer: 1,
      name: 'english_word_check',
      pass: true,
      message: 'Input does not appear to be an English word',
      method: 'check.smiles.syntax',
    }));
  }

  const ringClosures = {};
  for (let i = 0; i < smiles.length; i += 1) {
    const ch = smiles[i];
    if (ch === '%' && i + 2 < smiles.length && /[0-9]/.test(smiles[i + 1]) && /[0-9]/.test(smiles[i + 2])) {
      const num = smiles.slice(i + 1, i + 3);
      if (ringClosures[num] !== undefined) {
        delete ringClosures[num];
      } else {
        ringClosures[num] = i;
      }
      i += 2;
      continue;
    }
    if (/[0-9]/.test(ch) && (i === 0 || smiles[i - 1] !== '%')) {
      if (ringClosures[ch] !== undefined) {
        delete ringClosures[ch];
      } else {
        ringClosures[ch] = i;
      }
    }
  }
  const unclosed = Object.keys(ringClosures);
  if (unclosed.length > 0) {
    checks.push(createCheck({
      layer: 1,
      name: 'ring_closure_parity',
      pass: false,
      error_code: 'smiles_ring_unclosed',
      message: `Unclosed ring bonds: ${unclosed.join(', ')}`,
      method: 'check.smiles.syntax',
      details: { unclosed_ring_labels: unclosed },
    }));
  } else {
    checks.push(createCheck({
      layer: 1,
      name: 'ring_closure_parity',
      pass: true,
      message: 'Ring closures are balanced',
      method: 'check.smiles.syntax',
    }));
  }

  return checks;
}

/**
 * Layer 2: Alias correction.
 */
function aliasCheck(smiles) {
  const result = applyAlias(smiles);
  if (result.corrected) {
    return createCheck({
      layer: 2,
      name: 'alias_correction',
      pass: true,
      corrected: true,
      corrected_value: result.value,
      method: 'check.smiles.alias',
      message: `Alias '${result.alias}' corrected to SMILES: ${result.value}`,
      details: { alias: result.alias },
    });
  }
  return createCheck({
    layer: 2,
    name: 'alias_correction',
    pass: true,
    corrected: false,
    method: 'check.smiles.alias',
    message: 'No alias correction needed',
  });
}

/**
 * Layer 3: Heuristics (no RDKit).
 */
function heuristicCheck(smiles) {
  const checks = [];
  let value = smiles;

  const artifactResult = stripArtifacts(smiles);
  if (artifactResult.corrections.length > 0) {
    value = artifactResult.value;
    checks.push(createCheck({
      layer: 3,
      name: 'artifact_strip',
      pass: true,
      corrected: true,
      corrected_value: value,
      method: 'check.smiles.heuristic',
      message: `Stripped artifacts: ${artifactResult.corrections.map((c) => c.detail).join(', ')}`,
      details: { corrections: artifactResult.corrections },
    }));
  } else {
    checks.push(createCheck({
      layer: 3,
      name: 'artifact_strip',
      pass: true,
      corrected: false,
      method: 'check.smiles.heuristic',
      message: 'No artifacts detected',
    }));
  }

  const bareChargeRe = /^([A-Z][a-z]?)([+\-])$/;
  const bareMatch = value.match(bareChargeRe);
  if (bareMatch) {
    const elem = bareMatch[1];
    const charge = bareMatch[2];
    const corrected = `[${elem}${charge}]`;
    checks.push(createCheck({
      layer: 3,
      name: 'charge_reorder',
      pass: true,
      corrected: true,
      corrected_value: corrected,
      method: 'check.smiles.heuristic',
      message: `Bare charge notation '${value}' -> '${corrected}'`,
    }));
    value = corrected;
  } else {
    checks.push(createCheck({
      layer: 3,
      name: 'charge_reorder',
      pass: true,
      corrected: false,
      method: 'check.smiles.heuristic',
      message: 'No bare charge notation detected',
    }));
  }

  const bareIonRe = /^(Li|Na|K|Rb|Cs|Mg|Ca|Sr|Ba|Fe|Cu|Zn|Al|Mn|Co|Ni|Cr|Mo|Ag|Au|Pt|Pd)$/;
  const bareIonMatch = value.match(bareIonRe);
  if (bareIonMatch) {
    const corrected = `[${bareIonMatch[1]}]`;
    checks.push(createCheck({
      layer: 3,
      name: 'bare_ion_bracketing',
      pass: true,
      corrected: true,
      corrected_value: corrected,
      method: 'check.smiles.heuristic',
      message: `Bare ion '${value}' -> '${corrected}'`,
    }));
    value = corrected;
  } else {
    checks.push(createCheck({
      layer: 3,
      name: 'bare_ion_bracketing',
      pass: true,
      corrected: false,
      method: 'check.smiles.heuristic',
      message: 'No bare ion notation detected',
    }));
  }

  return { checks, corrected_value: value !== smiles ? value : null };
}

/**
 * Layer 4: RDKit validation.
 */
async function rdkitCheck(smiles) {
  let RDKit;
  try {
    RDKit = await getRDKit();
  } catch (e) {
    return [createCheck({
      layer: 4,
      name: 'rdkit_availability',
      pass: false,
      skipped: true,
      method: 'check.smiles.rdkit',
      message: `RDKit not available: ${e.message}`,
      diagnostics: { backend: 'none' },
    })];
  }

  const checks = [];
  let mol = null;

  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) {
      checks.push(createCheck({
        layer: 4,
        name: 'rdkit_parse',
        pass: false,
        error_code: 'smiles_rdkit_parse_failed',
        method: 'check.smiles.rdkit',
        message: 'RDKit could not parse this SMILES string',
      }));
      return checks;
    }

    checks.push(createCheck({
      layer: 4,
      name: 'rdkit_parse',
      pass: true,
      method: 'check.smiles.rdkit',
      message: 'RDKit parsed molecule successfully',
    }));

    try {
      const canonical = mol.get_smiles();
      const canonicalCheck = createCheck({
        layer: 4,
        name: 'canonicalization',
        pass: true,
        method: 'check.smiles.rdkit',
        message: `Canonical SMILES: ${canonical}`,
        details: { canonical_smiles: canonical },
      });
      canonicalCheck.canonical_smiles = canonical;
      checks.push(canonicalCheck);
    } catch (e) {
      checks.push(createCheck({
        layer: 4,
        name: 'canonicalization',
        pass: false,
        error_code: 'smiles_canonicalization_failed',
        method: 'check.smiles.rdkit',
        message: `Canonicalization failed: ${e.message}`,
      }));
    }

    try {
      const descJson = mol.get_descriptors();
      const descs = descJson ? JSON.parse(descJson) : null;
      if (descs) {
        checks.push(createCheck({
          layer: 4,
          name: 'valence_check',
          pass: true,
          method: 'check.smiles.rdkit',
          message: 'Valence check passed',
        }));
      }
    } catch (e) {
      checks.push(createCheck({
        layer: 4,
        name: 'valence_check',
        pass: false,
        error_code: 'smiles_valence_failed',
        method: 'check.smiles.rdkit',
        message: `Valence error: ${e.message}`,
      }));
    }
  } catch (e) {
    checks.push(createCheck({
      layer: 4,
      name: 'rdkit_parse',
      pass: false,
      error_code: 'smiles_rdkit_parse_failed',
      method: 'check.smiles.rdkit',
      message: `RDKit error: ${e.message}`,
    }));
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }

  return checks;
}

function parseDbeEntries(entries, options) {
  const opts = options || {};
  const enforceConservation = opts.enforceConservation !== false;

  const raw = String(entries || '').trim();
  if (!raw) {
    const err = new Error('dbe metadata block is empty');
    err.code = 'dbe_missing_entries';
    throw err;
  }

  const parsed = [];
  let totalDelta = 0;
  const tokens = raw.split(';');

  for (const token of tokens) {
    const candidate = token.trim();
    if (!candidate) {
      continue;
    }

    if (!candidate.includes(':')) {
      const err = new Error(`Entry '${candidate}' is missing the ':' separator`);
      err.code = 'dbe_entry_missing_separator';
      err.details = { token: candidate };
      throw err;
    }

    const pairAndDelta = candidate.split(':');
    const pairPart = pairAndDelta.shift();
    const deltaPart = pairAndDelta.join(':');

    if (!pairPart || !pairPart.includes('-')) {
      const err = new Error(`Entry '${candidate}' must include a pair in the form mapI-mapJ`);
      err.code = 'dbe_entry_missing_pair';
      err.details = { token: candidate };
      throw err;
    }

    const pairBits = pairPart.split('-');
    if (pairBits.length !== 2) {
      const err = new Error(`Entry '${candidate}' must include exactly one pair separator '-'`);
      err.code = 'dbe_entry_missing_pair';
      err.details = { token: candidate };
      throw err;
    }

    const iPart = pairBits[0].trim();
    const jPart = pairBits[1].trim();
    if (!/^\d+$/.test(iPart) || !/^\d+$/.test(jPart)) {
      const err = new Error(`Entry '${candidate}' must reference numeric atom-map indices`);
      err.code = 'dbe_entry_non_numeric_map';
      err.details = { token: candidate };
      throw err;
    }

    const deltaText = String(deltaPart || '').trim();
    if (!/^[+\-]?\d+$/.test(deltaText)) {
      const err = new Error(`Entry '${candidate}' has a non-integer delta`);
      err.code = 'dbe_entry_non_integer_delta';
      err.details = { token: candidate };
      throw err;
    }

    const delta = parseInt(deltaText, 10);
    parsed.push({
      map_i: parseInt(iPart, 10),
      map_j: parseInt(jPart, 10),
      delta,
      pair: `${iPart}-${jPart}`,
      type: iPart === jPart ? 'lone_pair' : 'bond',
    });
    totalDelta += delta;
  }

  if (parsed.length === 0) {
    const err = new Error('dbe metadata block did not contain any entries');
    err.code = 'dbe_empty_after_parse';
    throw err;
  }

  if (enforceConservation && totalDelta !== 0) {
    const err = new Error(`Bond-electron deltas must sum to zero (observed ${totalDelta})`);
    err.code = 'dbe_non_conserving';
    err.details = { total_delta: totalDelta };
    throw err;
  }

  return {
    entries: parsed,
    total_delta: totalDelta,
    valid: totalDelta === 0,
  };
}

function extractDbeFromSmirksMetadata(smirks) {
  const stripped = stripCxMetadata(smirks);
  const blocks = stripped.metadata_blocks || [];
  for (const block of blocks) {
    const normalized = String(block || '').replace(/^\|/, '').replace(/\|$/, '').trim();
    if (!/^dbe:/i.test(normalized)) {
      continue;
    }
    const entry = normalized.split(':');
    entry.shift();
    return entry.join(':').trim();
  }
  return '';
}

async function validateSpeciesWithRDKit(speciesList, sideName) {
  const diagnostics = [];
  let RDKit;
  try {
    RDKit = await getRDKit();
  } catch (e) {
    return {
      ok: false,
      error_code: 'smirks_rdkit_parse_failed',
      message: `RDKit not available: ${e.message}`,
      skipped: true,
      diagnostics: [{ side: sideName, smiles: null, error: e.message }],
    };
  }

  for (const species of speciesList) {
    let mol = null;
    try {
      mol = RDKit.get_mol(species);
      if (!mol || (typeof mol.is_valid === 'function' && !mol.is_valid())) {
        diagnostics.push({ side: sideName, smiles: species, error: 'invalid_species' });
      }
    } catch (e) {
      diagnostics.push({ side: sideName, smiles: species, error: e.message });
    } finally {
      if (mol) {
        try { mol.delete(); } catch (_) {}
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      error_code: 'smirks_invalid_species',
      message: `Invalid SMIRKS ${sideName} species: ${diagnostics.map((d) => d.smiles).join(', ')}`,
      diagnostics,
    };
  }

  return { ok: true, diagnostics: [] };
}

/**
 * Validate SMIRKS reaction string.
 */
async function checkSmirks(smirks) {
  const checks = [];

  const hardened = harden(smirks, 'smirks');
  if (hardened.error) {
    checks.push(createCheck({
      layer: 0,
      name: 'smirks_hardening',
      pass: false,
      error_code: 'smiles_hardening_failed',
      method: 'check.smirks',
      message: hardened.error,
      details: { input: String(smirks || '') },
    }));
    return buildResult(checks, { mode: 'smirks', method: 'check.smirks' });
  }

  const stripped = stripCxMetadata(hardened.value);
  const core = stripped.core;

  const arrowCount = (core.match(/>>/g) || []).length;
  if (arrowCount === 0) {
    checks.push(createCheck({
      layer: 1,
      name: 'smirks_format',
      pass: false,
      error_code: 'smirks_missing_arrow',
      method: 'check.smirks',
      message: 'SMIRKS must contain " >> " separator between reactants and products',
      details: { core },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: { metadata_blocks_removed: stripped.metadata_blocks, core },
    });
  }
  if (arrowCount > 1) {
    checks.push(createCheck({
      layer: 1,
      name: 'smirks_format',
      pass: false,
      error_code: 'smirks_multiple_arrows',
      method: 'check.smirks',
      message: 'SMIRKS should have exactly one " >> " separator',
      details: { core, arrow_count: arrowCount },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: { metadata_blocks_removed: stripped.metadata_blocks, core },
    });
  }

  checks.push(createCheck({
    layer: 1,
    name: 'smirks_format',
    pass: true,
    method: 'check.smirks',
    message: 'SMIRKS format looks correct',
  }));

  const bracketErrors = checkBrackets(core);
  if (bracketErrors.length > 0) {
    checks.push(createCheck({
      layer: 1,
      name: 'bracket_matching',
      pass: false,
      error_code: 'smiles_bracket_mismatch',
      method: 'check.smirks',
      message: bracketErrors.join('; '),
      details: { bracket_errors: bracketErrors },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: { metadata_blocks_removed: stripped.metadata_blocks, core },
    });
  }

  checks.push(createCheck({
    layer: 1,
    name: 'bracket_matching',
    pass: true,
    method: 'check.smirks',
    message: 'Brackets balanced',
  }));

  const parts = core.split('>>');
  const reactants = (parts[0] || '').split('.').map((item) => String(item || '').trim()).filter(Boolean);
  const products = (parts[1] || '').split('.').map((item) => String(item || '').trim()).filter(Boolean);

  if (reactants.length === 0) {
    checks.push(createCheck({
      layer: 2,
      name: 'side_species',
      pass: false,
      error_code: 'smirks_reactants_empty',
      method: 'check.smirks',
      message: 'SMIRKS reactants side is empty',
      details: { core },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: { metadata_blocks_removed: stripped.metadata_blocks, core },
    });
  }
  if (products.length === 0) {
    checks.push(createCheck({
      layer: 2,
      name: 'side_species',
      pass: false,
      error_code: 'smirks_products_empty',
      method: 'check.smirks',
      message: 'SMIRKS products side is empty',
      details: { core },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: { metadata_blocks_removed: stripped.metadata_blocks, core },
    });
  }

  const reactantCheck = await validateSpeciesWithRDKit(reactants, 'reactants');
  if (!reactantCheck.ok) {
    checks.push(createCheck({
      layer: 4,
      name: 'side_species',
      pass: false,
      error_code: reactantCheck.error_code || 'smirks_invalid_species',
      method: 'check.smirks',
      message: reactantCheck.message,
      skipped: reactantCheck.skipped,
      details: { invalid_species: reactantCheck.diagnostics || [] },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: {
        metadata_blocks_removed: stripped.metadata_blocks,
        core,
        invalid_species: reactantCheck.diagnostics || [],
      },
    });
  }

  const productCheck = await validateSpeciesWithRDKit(products, 'products');
  if (!productCheck.ok) {
    checks.push(createCheck({
      layer: 4,
      name: 'side_species',
      pass: false,
      error_code: productCheck.error_code || 'smirks_invalid_species',
      method: 'check.smirks',
      message: productCheck.message,
      skipped: productCheck.skipped,
      details: { invalid_species: productCheck.diagnostics || [] },
    }));
    return buildResult(checks, {
      mode: 'smirks',
      method: 'check.smirks',
      diagnostics: {
        metadata_blocks_removed: stripped.metadata_blocks,
        core,
        invalid_species: productCheck.diagnostics || [],
      },
    });
  }

  checks.push(createCheck({
    layer: 4,
    name: 'side_species',
    pass: true,
    method: 'check.smirks',
    message: 'All reactant/product species parsed successfully',
    details: { reactant_count: reactants.length, product_count: products.length },
  }));

  let rxnParseCheck;
  let RDKit;
  try {
    RDKit = await getRDKit();
    if (typeof RDKit.get_rxn === 'function') {
      let rxn = null;
      try {
        rxn = RDKit.get_rxn(core);
        let isValid = false;
        if (rxn) {
          if (typeof rxn.is_valid === 'function') {
            isValid = Boolean(rxn.is_valid());
          } else if (typeof rxn.validate === 'function') {
            const validateResult = rxn.validate();
            isValid = validateResult === 0 || validateResult === true || validateResult === undefined;
          } else {
            // If object was created and no explicit validator exists, treat parse as successful.
            isValid = true;
          }
        }
        rxnParseCheck = createCheck({
          layer: 4,
          name: 'rdkit_rxn_parse',
          pass: isValid,
          error_code: isValid ? undefined : 'smirks_rdkit_parse_failed',
          method: 'check.smirks.rdkit_rxn',
          message: isValid ? 'RDKit parsed reaction core successfully' : 'RDKit failed to parse reaction core',
        });
      } finally {
        if (rxn) {
          try { rxn.delete(); } catch (_) {}
        }
      }
    } else {
      rxnParseCheck = createCheck({
        layer: 4,
        name: 'rdkit_rxn_parse',
        pass: true,
        skipped: true,
        method: 'check.smirks.rdkit_rxn',
        message: 'RDKit reaction parser API unavailable; species-level parse used instead',
      });
    }
  } catch (e) {
    rxnParseCheck = createCheck({
      layer: 4,
      name: 'rdkit_rxn_parse',
      pass: false,
      skipped: true,
      method: 'check.smirks.rdkit_rxn',
      message: `RDKit reaction parsing unavailable: ${e.message}`,
    });
  }

  checks.push(rxnParseCheck);

  return buildResult(checks, {
    mode: 'smirks',
    method: 'check.smirks',
    diagnostics: {
      metadata_blocks_removed: stripped.metadata_blocks,
      core,
      reactants,
      products,
    },
  });
}

async function aggregateAtomCounts(smilesList, sideName) {
  const counts = {};
  const invalidSpecies = [];

  for (const smi of smilesList) {
    try {
      const perSpecies = await getAtomCounts(smi);
      for (const pair of Object.entries(perSpecies)) {
        const element = pair[0];
        const amount = pair[1];
        counts[element] = (counts[element] || 0) + amount;
      }
    } catch (e) {
      invalidSpecies.push({ side: sideName, smiles: smi, error: e.message });
    }
  }

  return { counts, invalidSpecies };
}

/**
 * Check element balance between reactants and products.
 */
async function checkBalance(reactants, products) {
  const checks = [];
  const reactantList = parseCsvOrArray(reactants);
  const productList = parseCsvOrArray(products);

  if (reactantList.length === 0 || productList.length === 0) {
    checks.push(createCheck({
      name: 'atom_balance',
      pass: false,
      error_code: 'input_required',
      method: 'check.balance',
      message: 'Both reactants and products are required for atom-balance validation',
      details: { reactants: reactantList, products: productList },
    }));
    return buildResult(checks, { mode: 'balance', method: 'check.balance' });
  }

  const reactantCountsPayload = await aggregateAtomCounts(reactantList, 'reactants');
  const productCountsPayload = await aggregateAtomCounts(productList, 'products');
  const invalidSpecies = reactantCountsPayload.invalidSpecies.concat(productCountsPayload.invalidSpecies);

  if (invalidSpecies.length > 0) {
    checks.push(createCheck({
      name: 'atom_balance',
      pass: false,
      error_code: 'atom_balance_invalid_species',
      method: 'check.balance',
      message: `Invalid species for atom balance: ${invalidSpecies.map((item) => item.smiles).join(', ')}`,
      details: {
        invalid_species: invalidSpecies,
        sanitized_current: reactantList.filter((item) => !invalidSpecies.find((x) => x.side === 'reactants' && x.smiles === item)),
        sanitized_resulting: productList.filter((item) => !invalidSpecies.find((x) => x.side === 'products' && x.smiles === item)),
      },
    }));
    return buildResult(checks, {
      mode: 'balance',
      method: 'check.balance',
      diagnostics: { invalid_species: invalidSpecies },
    });
  }

  const reactantCounts = reactantCountsPayload.counts;
  const productCounts = productCountsPayload.counts;

  const allElements = new Set(Object.keys(reactantCounts).concat(Object.keys(productCounts)));
  const imbalances = [];

  for (const element of allElements) {
    const reactantCount = reactantCounts[element] || 0;
    const productCount = productCounts[element] || 0;
    if (reactantCount !== productCount) {
      imbalances.push({
        element,
        reactants: reactantCount,
        products: productCount,
        delta: productCount - reactantCount,
      });
    }
  }

  if (imbalances.length > 0) {
    const detail = imbalances
      .map((item) => `${item.element}: ${item.reactants}->${item.products} (Δ${item.delta >= 0 ? '+' : ''}${item.delta})`)
      .join(', ');

    checks.push(createCheck({
      name: 'atom_balance',
      pass: false,
      error_code: 'atom_balance_unbalanced',
      method: 'check.balance',
      message: `Atom imbalance detected: ${detail}`,
      details: {
        balanced: false,
        imbalances,
        reactant_counts: reactantCounts,
        product_counts: productCounts,
      },
    }));
  } else {
    checks.push(createCheck({
      name: 'atom_balance',
      pass: true,
      method: 'check.balance',
      message: 'Reaction is atom-balanced',
      details: {
        balanced: true,
        deficit: {},
        surplus: {},
        reactant_counts: reactantCounts,
        product_counts: productCounts,
      },
    }));
  }

  return buildResult(checks, {
    mode: 'balance',
    method: 'check.balance',
    diagnostics: {
      reactants: reactantList,
      products: productList,
      reactant_counts: reactantCounts,
      product_counts: productCounts,
    },
  });
}

async function checkDBE(rawEntries, args) {
  const checks = [];
  const strictFlag = (args && Object.prototype.hasOwnProperty.call(args, 'strict'))
    ? Boolean(args.strict)
    : true;

  const entries = String(rawEntries || '').trim();
  if (!entries) {
    checks.push(createCheck({
      name: 'dbe_metadata',
      pass: false,
      error_code: 'dbe_missing_entries',
      method: 'check.dbe',
      message: 'dbe metadata block is empty',
      details: { dbe: entries, policy: strictFlag ? 'strict' : 'soft' },
    }));
    return buildResult(checks, { mode: 'dbe', method: 'check.dbe' });
  }

  try {
    const parsed = parseDbeEntries(entries, { enforceConservation: strictFlag });
    checks.push(createCheck({
      name: 'dbe_metadata',
      pass: true,
      method: 'check.dbe',
      message: 'dbe metadata parsed successfully',
      details: {
        valid: parsed.valid,
        policy: strictFlag ? 'strict' : 'soft',
        warning_only: false,
        total_delta: parsed.total_delta,
        dbe: entries,
        entries: parsed.entries,
      },
    }));
    return buildResult(checks, {
      mode: 'dbe',
      method: 'check.dbe',
      diagnostics: { parsed_entries: parsed.entries.length, total_delta: parsed.total_delta },
    });
  } catch (e) {
    if ((e && e.code === 'dbe_non_conserving') && !strictFlag) {
      const nonStrictParsed = parseDbeEntries(entries, { enforceConservation: false });
      checks.push(createCheck({
        name: 'dbe_metadata',
        pass: true,
        method: 'check.dbe',
        message: e.message,
        details: {
          valid: false,
          policy: 'soft',
          warning_only: true,
          total_delta: nonStrictParsed.total_delta,
          dbe: entries,
          entries: nonStrictParsed.entries,
          error_code: 'dbe_non_conserving',
          error: e.message,
        },
      }));
      return buildResult(checks, {
        mode: 'dbe',
        method: 'check.dbe',
        diagnostics: { parsed_entries: nonStrictParsed.entries.length, total_delta: nonStrictParsed.total_delta },
      });
    }

    checks.push(createCheck({
      name: 'dbe_metadata',
      pass: false,
      error_code: (e && e.code) ? e.code : 'dbe_missing_entries',
      method: 'check.dbe',
      message: e && e.message ? e.message : 'Unable to parse dbe metadata',
      details: {
        dbe: entries,
        policy: strictFlag ? 'strict' : 'soft',
        error: e && e.message ? e.message : 'Unable to parse dbe metadata',
        token: e && e.details && e.details.token ? e.details.token : undefined,
        total_delta: e && e.details && e.details.total_delta !== undefined ? e.details.total_delta : undefined,
      },
    }));

    return buildResult(checks, { mode: 'dbe', method: 'check.dbe' });
  }
}

async function checkStateProgress(args) {
  const checks = [];

  const unchangedRaw = (args && Object.prototype.hasOwnProperty.call(args, 'unchanged_starting_materials_detected'))
    ? args.unchanged_starting_materials_detected
    : args && args['unchanged-starting-materials-detected'];
  const changedRaw = (args && Object.prototype.hasOwnProperty.call(args, 'resulting_state_changed'))
    ? args.resulting_state_changed
    : args && args['resulting-state-changed'];

  let unchanged = parseBooleanLike(unchangedRaw);
  let resultingChanged = parseBooleanLike(changedRaw);
  let source = 'booleans';

  const currentState = parseCsvOrArray(args && (args.current_state || args['current-state']));
  const resultingState = parseCsvOrArray(args && (args.resulting_state || args['resulting-state']));

  if (unchanged === null || resultingChanged === null) {
    if (currentState.length > 0 || resultingState.length > 0) {
      const currentSignature = multisetSignature(currentState);
      const resultingSignature = multisetSignature(resultingState);
      const sameState = currentSignature === resultingSignature;
      unchanged = sameState;
      resultingChanged = !sameState;
      source = 'state_arrays';
    }
  }

  if (unchanged === null || resultingChanged === null) {
    checks.push(createCheck({
      name: 'state_progress',
      pass: false,
      error_code: 'state_progress_missing',
      method: 'check.state_progress',
      message: 'state-progress requires booleans or current_state/resulting_state arrays',
      details: {
        unchanged_starting_materials_detected: unchangedRaw,
        resulting_state_changed: changedRaw,
        current_state: currentState,
        resulting_state: resultingState,
      },
    }));
    return buildResult(checks, { mode: 'state_progress', method: 'check.state_progress' });
  }

  const pass = !unchanged && resultingChanged;
  let errorCode;
  let message;
  if (pass) {
    message = 'State progress check passed';
  } else if (unchanged && !resultingChanged) {
    errorCode = 'state_progress_no_change';
    message = 'Resulting state did not change from current state';
  } else {
    errorCode = 'state_progress_unchanged_starting_materials';
    message = 'Unchanged starting materials detected or resulting state did not progress';
  }

  checks.push(createCheck({
    name: 'state_progress',
    pass,
    error_code: errorCode,
    method: 'check.state_progress',
    message,
    details: {
      unchanged_starting_materials_detected: unchanged,
      resulting_state_changed: resultingChanged,
      source,
      current_state: currentState,
      resulting_state: resultingState,
    },
  }));

  return buildResult(checks, {
    mode: 'state_progress',
    method: 'check.state_progress',
    diagnostics: {
      source,
      current_state_count: currentState.length,
      resulting_state_count: resultingState.length,
    },
  });
}

async function checkMechanismStep(args) {
  const checks = [];
  const diagnostics = {};

  if (!args || typeof args !== 'object') {
    checks.push(createCheck({
      name: 'mechanism_step',
      pass: false,
      error_code: 'mechanism_step_invalid_payload',
      method: 'check.mechanism_step',
      message: 'mechanism-step payload must be an object',
    }));
    return buildResult(checks, { mode: 'mechanism_step', method: 'check.mechanism_step' });
  }

  const currentState = parseCsvOrArray(args.current_state || args['current-state']);
  const resultingState = parseCsvOrArray(args.resulting_state || args['resulting-state']);

  const atomResult = await checkBalance(currentState, resultingState);
  const atomCheck = atomResult.checks.find((item) => item.name === 'atom_balance');
  if (atomCheck) {
    atomCheck.method = 'check.mechanism_step.atom_balance';
    checks.push(atomCheck);
  }
  diagnostics.atom_balance = {
    backend: atomResult.backend,
    method: atomResult.method,
    overall_pass: atomResult.overall_pass,
    failed_check_names: atomResult.failed_check_names,
  };

  const dbePolicyStrict = (Object.prototype.hasOwnProperty.call(args, 'strict')) ? Boolean(args.strict) : true;
  const rawBondValidation = args.bond_electron_validation;

  if (rawBondValidation && typeof rawBondValidation === 'object') {
    const valid = Boolean(rawBondValidation.valid);
    const passed = valid || !dbePolicyStrict;
    checks.push(createCheck({
      name: 'dbe_metadata',
      pass: passed,
      error_code: passed ? undefined : 'dbe_non_conserving',
      method: 'check.mechanism_step.dbe',
      message: String(rawBondValidation.message || (valid ? 'bond_electron_validation valid' : 'bond_electron_validation invalid')),
      details: {
        valid,
        policy: dbePolicyStrict ? 'strict' : 'soft',
        warning_only: !valid && passed,
        total_delta: rawBondValidation.total_delta,
        dbe: rawBondValidation.dbe,
        dbe_source: rawBondValidation.dbe_source,
        error: rawBondValidation.error,
      },
    }));
    diagnostics.dbe_source = 'bond_electron_validation';
  } else {
    let dbeEntries = String(args.dbe || '').trim();
    if (!dbeEntries) {
      dbeEntries = extractDbeFromSmirksMetadata(args.reaction_smirks || args.smirks || '');
    }

    if (dbeEntries) {
      const dbeResult = await checkDBE(dbeEntries, { strict: dbePolicyStrict });
      const dbeCheck = dbeResult.checks.find((item) => item.name === 'dbe_metadata');
      if (dbeCheck) {
        dbeCheck.method = 'check.mechanism_step.dbe';
        checks.push(dbeCheck);
      }
      diagnostics.dbe_source = 'dbe_entries';
      diagnostics.dbe = {
        overall_pass: dbeResult.overall_pass,
        failed_check_names: dbeResult.failed_check_names,
      };
    } else {
      checks.push(createCheck({
        name: 'dbe_metadata',
        pass: false,
        error_code: 'dbe_missing',
        method: 'check.mechanism_step.dbe',
        message: 'No bond_electron_validation payload or DBE metadata provided',
        details: {
          policy: dbePolicyStrict ? 'strict' : 'soft',
        },
      }));
      diagnostics.dbe_source = 'missing';
    }
  }

  const progressResult = await checkStateProgress({
    unchanged_starting_materials_detected: args.unchanged_starting_materials_detected,
    'unchanged-starting-materials-detected': args['unchanged-starting-materials-detected'],
    resulting_state_changed: args.resulting_state_changed,
    'resulting-state-changed': args['resulting-state-changed'],
    current_state: currentState,
    resulting_state: resultingState,
  });
  const progressCheck = progressResult.checks.find((item) => item.name === 'state_progress');
  if (progressCheck) {
    progressCheck.method = 'check.mechanism_step.state_progress';
    checks.push(progressCheck);
  }
  diagnostics.state_progress = {
    overall_pass: progressResult.overall_pass,
    failed_check_names: progressResult.failed_check_names,
  };

  return buildResult(checks, {
    mode: 'mechanism_step',
    method: 'check.mechanism_step',
    diagnostics,
  });
}

/**
 * Main check command.
 */
async function check(args) {
  const payload = args || {};

  // Priority order for explicit modes.
  if (payload.mechanism_step || payload['mechanism-step']) {
    return checkMechanismStep(payload);
  }

  if (
    payload.state_progress || payload['state-progress'] ||
    payload.current_state || payload['current-state'] ||
    payload.resulting_state || payload['resulting-state'] ||
    Object.prototype.hasOwnProperty.call(payload, 'unchanged_starting_materials_detected') ||
    Object.prototype.hasOwnProperty.call(payload, 'resulting_state_changed') ||
    Object.prototype.hasOwnProperty.call(payload, 'unchanged-starting-materials-detected') ||
    Object.prototype.hasOwnProperty.call(payload, 'resulting-state-changed')
  ) {
    return checkStateProgress(payload);
  }

  if (payload.dbe !== undefined) {
    return checkDBE(payload.dbe, payload);
  }

  if (payload.balance !== undefined || (payload.reactants && payload.products)) {
    const reactants = parseCsvOrArray(payload.reactants || (payload.balance && payload.balance.reactants));
    const products = parseCsvOrArray(payload.products || (payload.balance && payload.balance.products));
    return checkBalance(reactants, products);
  }

  if (payload.smirks) {
    return checkSmirks(payload.smirks);
  }

  const smiles = payload.smiles || (payload._ && payload._[0]) || payload.input;
  if (!smiles) {
    return buildResult([createCheck({
      layer: 0,
      name: 'input_required',
      pass: false,
      error_code: 'input_required',
      method: 'check.smiles',
      message: 'No input provided. Use --smiles, --smirks, --dbe, --state-progress, or --mechanism-step.',
    })], { mode: 'smiles', method: 'check.smiles' });
  }

  const hardenResult = harden(smiles, 'smiles');
  if (hardenResult.error) {
    const hardeningMessage = String(hardenResult.error || '');
    const hardeningName = /bracket/i.test(hardeningMessage) ? 'bracket_matching' : 'hardening';
    const hardeningCode = /bracket/i.test(hardeningMessage) ? 'smiles_bracket_mismatch' : 'smiles_hardening_failed';
    return buildResult([createCheck({
      layer: 0,
      name: hardeningName,
      pass: false,
      error_code: hardeningCode,
      method: 'check.smiles',
      message: hardeningMessage,
      details: { input: String(smiles) },
    })], { mode: 'smiles', method: 'check.smiles' });
  }

  const hardenedSmiles = String(hardenResult.value || '').trim();
  if (!hardenedSmiles) {
    return buildResult([createCheck({
      layer: 0,
      name: 'smiles_nonempty',
      pass: false,
      error_code: 'smiles_empty',
      method: 'check.smiles',
      message: 'SMILES empty after hardening/cleaning',
    })], { mode: 'smiles', method: 'check.smiles' });
  }

  const allChecks = [];

  const syntaxChecks = syntaxCheck(hardenedSmiles);
  allChecks.push(...syntaxChecks);

  const hardFails = syntaxChecks.filter((item) =>
    item.pass === false &&
    (item.name === 'bracket_matching' || item.name === 'english_word_check')
  );

  if (hardFails.length > 0 && !payload['--continue']) {
    return buildResult(allChecks, {
      mode: 'smiles',
      method: 'check.smiles',
      diagnostics: {
        hardened: hardenedSmiles,
        stopped_at: 'syntax',
      },
    });
  }

  const aliasResult = aliasCheck(hardenedSmiles);
  allChecks.push(aliasResult);

  let workingSmiles = aliasResult.corrected ? aliasResult.corrected_value : hardenedSmiles;

  const heuristicResult = heuristicCheck(workingSmiles);
  allChecks.push(...heuristicResult.checks);
  if (heuristicResult.corrected_value) {
    workingSmiles = heuristicResult.corrected_value;
  }

  if (!payload['dry-run'] && !payload['no-rdkit']) {
    const rdkitChecks = await rdkitCheck(workingSmiles);
    allChecks.push(...rdkitChecks);
  }

  return buildResult(allChecks, {
    mode: 'smiles',
    method: 'check.smiles',
    diagnostics: {
      hardened: hardenedSmiles,
      working_smiles: workingSmiles,
      hardening_corrections: hardenResult.corrections || [],
    },
  });
}

module.exports = {
  check,
  checkBalance,
  checkSmirks,
  checkDBE,
  checkStateProgress,
  checkMechanismStep,
  parseDbeEntries,
  syntaxCheck,
  aliasCheck,
  heuristicCheck,
  rdkitCheck,
  stripCxMetadata,
};
