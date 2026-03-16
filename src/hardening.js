'use strict';

const path = require('path');
const fs = require('fs');

// Alias map – loaded on first use so commands that never call applyAlias/isEnglishWord
// (e.g. schema, version) don't pay the readFileSync cost at module load.
let _aliases = null;
function getAliases() {
  if (!_aliases) {
    try {
      _aliases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'aliases.json'), 'utf8'));
    } catch (e) {
      _aliases = {};
    }
  }
  return _aliases;
}

// SMILES legal character set
const SMILES_LEGAL_CHARS = /^[A-Za-z0-9@+\-=\/#%\[\]().\\:*~!,;{}<>?_|^$& \t\n]+$/;

// Consecutive lowercase heuristic: 4+ consecutive lowercase letters that form a common English pattern
const CONSECUTIVE_LOWERCASE_RE = /[a-z]{5,}/;

// English words that are commonly confused with SMILES
const ENGLISH_WORD_RE = /^[a-z]{4,}$/i;

// LLM artifact patterns
const MARKDOWN_CODE_BLOCK_RE = /```(?:smiles|smi|mol)?\s*([\s\S]*?)```/i;
const SMILES_PREFIX_RE = /^(?:SMILES|smiles|Smiles)\s*[:=]\s*/;
const FORMULA_PREFIX_RE = /^(?:formula|Formula|FORMULA)\s*[:=]\s*/;

// Control characters
const CONTROL_CHAR_RE = /[\x00-\x1f]/;

// Percent encoding
const PERCENT_ENCODING_RE = /%[0-9A-Fa-f]{2}/;

// Pericyclic notation
const PERICYCLIC_RE = /\[\s*\d+\s*\+\s*\d+\s*\]/;

// Known English chemistry words that should not be used as SMILES
const CHEMISTRY_ENGLISH_WORDS = new Set([
  'benzene', 'toluene', 'aspirin', 'caffeine', 'ethanol', 'methanol',
  'acetone', 'glucose', 'alanine', 'glycine', 'phenol', 'aniline',
  'pyridine', 'pyrrole', 'furan', 'thiophene', 'imidazole', 'oxazole',
  'thiazole', 'indole', 'naphthalene', 'anthracene', 'pyrene', 'cholesterol',
  'morphine', 'cocaine', 'dopamine', 'serotonin', 'testosterone', 'estrogen',
  'penicillin', 'insulin', 'adrenaline', 'cortisol', 'histamine', 'nicotine',
  'alcohol', 'ketone', 'aldehyde', 'ester', 'ether', 'amide', 'amine',
  'alkane', 'alkene', 'alkyne', 'cyclohexane', 'cyclopentane', 'cyclobutane',
  'butane', 'propane', 'hexane', 'heptane', 'octane', 'pentane',
  'water', 'salt', 'acid', 'base', 'sugar', 'protein', 'lipid'
]);

/**
 * Strip LLM artifacts from a string
 */
function stripArtifacts(input) {
  if (typeof input !== 'string') return { value: String(input), corrections: [] };

  const corrections = [];
  let value = input.trim();

  // Strip markdown code blocks
  const mdMatch = value.match(MARKDOWN_CODE_BLOCK_RE);
  if (mdMatch) {
    corrections.push({ type: 'artifact_strip', detail: 'removed markdown code block' });
    value = mdMatch[1].trim();
  }

  // Strip SMILES: prefix
  if (SMILES_PREFIX_RE.test(value)) {
    corrections.push({ type: 'artifact_strip', detail: 'removed SMILES: prefix' });
    value = value.replace(SMILES_PREFIX_RE, '');
  }

  // Strip Formula: prefix
  if (FORMULA_PREFIX_RE.test(value)) {
    corrections.push({ type: 'artifact_strip', detail: 'removed Formula: prefix' });
    value = value.replace(FORMULA_PREFIX_RE, '');
  }

  // Strip surrounding quotes (single or double)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    corrections.push({ type: 'quote_strip', detail: 'removed surrounding quotes' });
    value = value.slice(1, -1);
  }

  // Strip backtick quotes
  if (value.startsWith('`') && value.endsWith('`')) {
    corrections.push({ type: 'quote_strip', detail: 'removed surrounding backticks' });
    value = value.slice(1, -1);
  }

  return { value: value.trim(), corrections };
}

/**
 * Check bracket matching for [], ()
 */
function checkBrackets(smiles) {
  const errors = [];
  let squareDepth = 0;
  let parenDepth = 0;

  for (let i = 0; i < smiles.length; i++) {
    const ch = smiles[i];
    if (ch === '[') squareDepth++;
    else if (ch === ']') {
      squareDepth--;
      if (squareDepth < 0) {
        errors.push(`Unexpected ']' at position ${i}`);
        squareDepth = 0;
      }
    }
    else if (ch === '(') parenDepth++;
    else if (ch === ')') {
      parenDepth--;
      if (parenDepth < 0) {
        errors.push(`Unexpected ')' at position ${i}`);
        parenDepth = 0;
      }
    }
  }

  if (squareDepth > 0) errors.push(`Unclosed '[' bracket (${squareDepth} unclosed)`);
  if (parenDepth > 0) errors.push(`Unclosed '(' bracket (${parenDepth} unclosed)`);

  return errors;
}

/**
 * Apply alias correction
 */
function applyAlias(input) {
  const aliases = getAliases();
  if (aliases[input] !== undefined) {
    return { corrected: true, value: aliases[input], alias: input };
  }
  // Case-insensitive lookup
  const lower = input.toLowerCase();
  for (const [key, val] of Object.entries(aliases)) {
    if (key.toLowerCase() === lower) {
      return { corrected: true, value: val, alias: key };
    }
  }
  return { corrected: false, value: input };
}

/**
 * Check if input looks like an English word rather than SMILES
 */
function isEnglishWord(input) {
  const cleaned = input.trim().toLowerCase();

  // Check against known chemistry words
  if (CHEMISTRY_ENGLISH_WORDS.has(cleaned)) {
    const aliases = getAliases();
    return { isWord: true, suggestion: aliases[cleaned] || aliases[input] || null };
  }

  // Consecutive lowercase heuristic: if the whole string is 5+ lowercase letters
  // with no SMILES-specific chars, it's likely English
  if (/^[a-z]{5,}$/.test(cleaned)) {
    // But allow common SMILES that are all lowercase like "ccoc" (ethyl ether fragment)
    // Check if it has ring-like patterns - purely alphabetic 5+ char lowercase that doesn't
    // look like a SMILES pattern (no digits, no SMILES atoms like cccc pattern)
    const smilesAtomPattern = /^[cnopsFBCINOPS]+$/;
    if (!smilesAtomPattern.test(input)) {
      return { isWord: true, suggestion: null };
    }
  }

  return { isWord: false };
}

/**
 * Sandbox output path to CWD
 */
function sandboxOutputPath(outputPath) {
  if (!outputPath) return { valid: true, value: outputPath };

  const cwd = process.cwd();
  const resolved = path.resolve(outputPath); // nosemgrep: path-join-resolve-traversal

  if (!resolved.startsWith(cwd)) {
    return {
      valid: false,
      error: `Output path '${outputPath}' is outside the current working directory. Resolved to: ${resolved}`,
      cwd
    };
  }

  return { valid: true, value: resolved };
}

/**
 * Main hardening function
 * @param {string} input - The input string to harden
 * @param {string} type - 'smiles' | 'smirks' | 'path' | 'general'
 * @returns {{ value: string, warnings: string[], corrections: object[], error: string|null }}
 */
function harden(input, type = 'smiles') {
  const warnings = [];
  const corrections = [];
  let error = null;

  if (type === 'path') {
    const result = sandboxOutputPath(input);
    if (!result.valid) {
      return { value: input, warnings, corrections, error: result.error };
    }
    return { value: result.value, warnings, corrections, error: null };
  }

  if (typeof input !== 'string') {
    input = String(input);
    warnings.push('Input was not a string; converted to string');
  }

  // Step 1: Strip artifacts
  const artifactResult = stripArtifacts(input);
  if (artifactResult.corrections.length > 0) {
    corrections.push(...artifactResult.corrections);
  }
  let value = artifactResult.value;

  // Step 2: Control character check
  if (CONTROL_CHAR_RE.test(value)) {
    error = 'Input contains control characters (\\x00-\\x1f). These are not valid in chemistry notation.';
    return { value: input, warnings, corrections, error };
  }

  // Step 3: Percent-encoding check
  if (PERCENT_ENCODING_RE.test(value)) {
    // Check if it's actually URL-encoded SMILES
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value) {
        corrections.push({ type: 'url_decode', detail: 'decoded percent-encoded characters' });
        value = decoded;
      }
    } catch (e) {
      error = 'Input appears to contain URL-encoded characters that could not be decoded.';
      return { value: input, warnings, corrections, error };
    }
  }

  // Step 4: Pericyclic notation check
  if (PERICYCLIC_RE.test(value)) {
    error = `Input contains pericyclic/electron-count notation like "[4+2]". This is not valid SMILES notation. ` +
            `Brackets in SMILES should contain atom specifications like [Na+] or [CH3+].`;
    return { value: input, warnings, corrections, error };
  }

  // Step 5: Try alias correction
  const aliasResult = applyAlias(value);
  if (aliasResult.corrected) {
    corrections.push({
      type: 'alias_correction',
      detail: `Converted alias '${aliasResult.alias}' to SMILES '${aliasResult.value}'`
    });
    value = aliasResult.value;
  }

  // Step 6: English word check (only if no alias was applied)
  if (!aliasResult.corrected) {
    const wordCheck = isEnglishWord(value);
    if (wordCheck.isWord) {
      const suggestion = wordCheck.suggestion ? ` Did you mean '${wordCheck.suggestion}'?` :
                         ` Use SMILES notation (e.g., 'c1ccccc1' for benzene).`;
      error = `Input '${value}' looks like an English word rather than SMILES notation.${suggestion}`;
      return { value: input, warnings, corrections, error };
    }
  }

  // Step 7: Bracket matching
  const bracketErrors = checkBrackets(value);
  if (bracketErrors.length > 0) {
    error = `Bracket matching error: ${bracketErrors.join('; ')}`;
    return { value, warnings, corrections, error };
  }

  return { value, warnings, corrections, error: null };
}

module.exports = {
  harden,
  stripArtifacts,
  applyAlias,
  checkBrackets,
  isEnglishWord,
  sandboxOutputPath,
  get ALIASES() { return getAliases(); }
};
