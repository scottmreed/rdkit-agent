'use strict';

const fs = require('fs');
const path = require('path');
const { getRDKit } = require('../wasm');
const { harden, sandboxOutputPath } = require('../hardening');

/**
 * Draw a molecule to SVG or PNG
 */
async function drawMolecule(smiles, options) {
  options = options || {};
  const format = (options.format || 'svg').toLowerCase();
  const width = parseInt(options.width) || 300;
  const height = parseInt(options.height) || 300;

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

    const drawDetails = JSON.stringify({ width, height, addStereoAnnotation: true });

    let output;
    if (format === 'svg') {
      output = mol.get_svg_with_highlights(drawDetails);
      if (!output) {
        output = mol.get_svg(width, height);
      }
    } else if (format === 'png') {
      // PNG via canvas - rdkit-js supports this via get_png
      try {
        output = mol.get_png_with_highlights(drawDetails);
      } catch (e) {
        // Fallback to SVG if PNG not supported
        output = mol.get_svg(width, height);
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

    return {
      smiles: h.value,
      canonical_smiles: mol.get_smiles(),
      format,
      width,
      height,
      output
    };

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main draw command
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

  const result = await drawMolecule(smiles, { format, width, height });

  if (result.error) return result;

  // Write to file if output specified
  if (outputPath) {
    const sandboxed = sandboxOutputPath(outputPath);
    if (!sandboxed.valid) {
      return { error: sandboxed.error };
    }

    try {
      // Ensure directory exists
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
