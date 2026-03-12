'use strict';

const fs = require('fs');
const { computeDescriptors } = require('./descriptors');

/**
 * Compute statistics for a numeric array
 */
function computeStats(values) {
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return { count: 0, min: null, max: null, mean: null, median: null, std: null };

  const sorted = [...filtered].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const median = n % 2 === 0
    ? (sorted[n/2 - 1] + sorted[n/2]) / 2
    : sorted[Math.floor(n/2)];

  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);

  return {
    count: n,
    min: Math.round(sorted[0] * 1000) / 1000,
    max: Math.round(sorted[n-1] * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    std: Math.round(std * 1000) / 1000,
    q1: Math.round(sorted[Math.floor(n * 0.25)] * 1000) / 1000,
    q3: Math.round(sorted[Math.floor(n * 0.75)] * 1000) / 1000
  };
}

/**
 * Main stats command
 */
async function stats(args) {
  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      molecules = parsed.smiles || parsed.molecules || (Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.smiles) {
    molecules = Array.isArray(args.smiles) ? args.smiles : args.smiles.split(',').map(s => s.trim());
  } else if (args.file) {
    try {
      const content = fs.readFileSync(args.file, 'utf8');
      molecules = content.split('\n').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
    } catch (e) {
      return { error: `Could not read file: ${e.message}` };
    }
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (molecules.length === 0) {
    return { error: 'No molecules provided. Use --smiles <smiles,...> or --file <path>' };
  }

  const descriptorsList = await Promise.all(molecules.map(computeDescriptors));
  const valid = descriptorsList.filter(d => !d.error);
  const invalid = descriptorsList.filter(d => d.error);

  if (valid.length === 0) {
    return {
      error: 'No valid molecules',
      invalid_count: invalid.length,
      errors: invalid.map(d => d.error)
    };
  }

  const descriptorFields = ['MW', 'logP', 'TPSA', 'HBD', 'HBA', 'rotatable_bonds', 'aromatic_rings', 'heavy_atoms'];
  const statistics = {};

  for (const field of descriptorFields) {
    const values = valid.map(d => d[field]);
    statistics[field] = computeStats(values);
  }

  return {
    total: molecules.length,
    valid: valid.length,
    invalid: invalid.length,
    statistics,
    invalid_molecules: invalid.length > 0 ? invalid.map(d => ({ smiles: d.smiles, error: d.error })) : undefined
  };
}

module.exports = { stats, computeStats };
