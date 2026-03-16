'use strict';

const fs = require('fs');
const path = require('path');
const { getRDKit } = require('../wasm');
const { harden, sandboxOutputPath } = require('../hardening');

/**
 * Convert a CSS hex colour (#rrggbb or #rgb) to an [r, g, b] array with values in 0–1.
 * Returns null if the string is not a recognised hex colour.
 */
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  hex = hex.trim();
  // Expand shorthand #rgb → #rrggbb
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}

/**
 * Build the drawDetails JSON object accepted by get_svg_with_highlights / get_png_with_highlights.
 *
 * @param {object} opts
 * @param {number}  opts.width
 * @param {number}  opts.height
 * @param {object}  [opts.highlightAtoms]  - { atomIdx(string) : hexColor }
 * @param {object}  [opts.highlightBonds]  - { bondIdx(string) : hexColor }
 * @param {number}  [opts.highlightRadius] - default 0.3
 * @returns {string} JSON string
 */
function buildDrawDetails(opts) {
  const details = {
    width: opts.width,
    height: opts.height,
    addStereoAnnotation: true
  };

  if (opts.highlightAtoms && Object.keys(opts.highlightAtoms).length > 0) {
    const atoms = [];
    const colours = {};
    for (const [idxStr, colour] of Object.entries(opts.highlightAtoms)) {
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx)) continue;
      atoms.push(idx);
      const rgb = hexToRgb(colour);
      if (rgb) colours[String(idx)] = rgb;
    }
    if (atoms.length > 0) {
      details.atoms = atoms;
      details.atomColours = colours;
    }
  }

  if (opts.highlightBonds && Object.keys(opts.highlightBonds).length > 0) {
    const bonds = [];
    const colours = {};
    for (const [idxStr, colour] of Object.entries(opts.highlightBonds)) {
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx)) continue;
      bonds.push(idx);
      const rgb = hexToRgb(colour);
      if (rgb) colours[String(idx)] = rgb;
    }
    if (bonds.length > 0) {
      details.bonds = bonds;
      details.bondColours = colours;
    }
  }

  if (opts.highlightRadius !== undefined && opts.highlightRadius !== null) {
    const r = parseFloat(opts.highlightRadius);
    if (!isNaN(r)) details.highlightRadius = r;
  }

  return JSON.stringify(details);
}

/**
 * Draw a molecule to SVG or PNG.
 *
 * @param {string} smiles
 * @param {object} [options]
 * @param {string}  [options.format]           'svg' | 'png'
 * @param {number}  [options.width]
 * @param {number}  [options.height]
 * @param {object}  [options.highlightAtoms]   { "0": "#ff0000", ... }
 * @param {object}  [options.highlightBonds]   { "1": "#00ff00", ... }
 * @param {number}  [options.highlightRadius]  default 0.3
 * @returns {Promise<object>}
 */
async function drawMolecule(smiles, options) {
  options = options || {};
  const format = (options.format || 'svg').toLowerCase();
  const width = parseInt(options.width) || 300;
  const height = parseInt(options.height) || 300;
  const highlightAtoms = options.highlightAtoms || null;
  const highlightBonds = options.highlightBonds || null;
  const highlightRadius = options.highlightRadius !== undefined ? options.highlightRadius : null;

  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) {
    return { smiles, error: h.error };
  }

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    const drawDetails = buildDrawDetails({
      width, height,
      highlightAtoms,
      highlightBonds,
      highlightRadius
    });

    let output;
    if (format === 'svg') {
      output = mol.get_svg_with_highlights(drawDetails);
      if (!output) {
        output = mol.get_svg(width, height);
      }
    } else if (format === 'png') {
      try {
        output = mol.get_png_with_highlights(drawDetails);
      } catch (e) {
        // Fallback to SVG if PNG not supported
        output = mol.get_svg_with_highlights(drawDetails) || mol.get_svg(width, height);
        return {
          smiles: h.value,
          format: 'svg',
          warning: 'PNG not supported in this environment, fell back to SVG',
          output
        };
      }
    } else {
      return { smiles, error: `Unsupported format: ${format}. Use svg or png.` };
    }

    const result = {
      smiles: h.value,
      canonical_smiles: mol.get_smiles(),
      format,
      width,
      height,
      output
    };

    if (highlightAtoms || highlightBonds) {
      result.highlights = {
        atoms: highlightAtoms || {},
        bonds: highlightBonds || {}
      };
    }

    return result;

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Parse a JSON string flag into an object, returning null on failure.
 */
function parseJsonFlag(value, flagName) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return { _parseError: `Invalid JSON for ${flagName}: ${e.message}` };
  }
}

/**
 * Main draw command.
 */
async function draw(args) {
  const smiles = args.smiles || (args._ && args._[0]);
  if (!smiles) {
    return { error: 'No SMILES provided. Use --smiles <smiles>' };
  }

  const format = (args.format || 'svg').toLowerCase();
  const width = parseInt(args.width) || 300;
  const height = parseInt(args.height) || 300;
  const outputPath = args.output;

  // Parse highlight flags
  const highlightAtoms = parseJsonFlag(args['highlight-atoms'], '--highlight-atoms');
  const highlightBonds = parseJsonFlag(args['highlight-bonds'], '--highlight-bonds');
  const highlightRadius = args['highlight-radius'] !== undefined
    ? parseFloat(args['highlight-radius'])
    : undefined;

  if (highlightAtoms && highlightAtoms._parseError) {
    return { error: highlightAtoms._parseError };
  }
  if (highlightBonds && highlightBonds._parseError) {
    return { error: highlightBonds._parseError };
  }

  const result = await drawMolecule(smiles, {
    format, width, height,
    highlightAtoms,
    highlightBonds,
    highlightRadius
  });

  if (result.error) return result;

  // Write to file if output specified
  if (outputPath) {
    const sandboxed = sandboxOutputPath(outputPath);
    if (!sandboxed.valid) {
      return { error: sandboxed.error };
    }

    try {
      const dir = path.dirname(sandboxed.value);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (format === 'png' && Buffer.isBuffer(result.output)) {
        fs.writeFileSync(sandboxed.value, result.output);
      } else {
        fs.writeFileSync(sandboxed.value, result.output, 'utf8');
      }

      return {
        ...result,
        output_file: sandboxed.value,
        output: `[Written to ${sandboxed.value}]`
      };
    } catch (e) {
      return { error: `Failed to write output: ${e.message}` };
    }
  }

  return result;
}

module.exports = { draw, drawMolecule };
