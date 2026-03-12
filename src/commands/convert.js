'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

const SUPPORTED_FORMATS = ['smiles', 'inchi', 'inchikey', 'mol', 'sdf', 'smarts', 'json'];

/**
 * Convert a single molecule from one format to another
 */
async function convertOne(input, fromFormat, toFormat) {
  const RDKit = await getRDKit();
  let mol = null;

  try {
    // Parse input
    switch (fromFormat) {
      case 'smiles':
      case 'smarts': {
        const h = harden(input, 'smiles');
        if (h.error) throw new Error(h.error);
        mol = fromFormat === 'smarts' ? RDKit.get_qmol(h.value) : RDKit.get_mol(h.value);
        break;
      }
      case 'inchi':
        mol = RDKit.get_mol_from_input(input, { removeHs: true });
        if (!mol || !mol.is_valid()) {
          // Try via inchi directly
          mol = RDKit.get_mol(`InChI=${input.startsWith('InChI=') ? '' : ''}${input}`);
        }
        break;
      case 'mol':
      case 'sdf':
        mol = RDKit.get_mol_from_input(input);
        break;
      default:
        throw new Error(`Unsupported input format: ${fromFormat}`);
    }

    if (!mol || !mol.is_valid()) {
      throw new Error(`Failed to parse molecule from ${fromFormat}: ${input.slice(0, 50)}`);
    }

    // Generate output
    let result;
    switch (toFormat) {
      case 'smiles':
        result = mol.get_smiles();
        break;
      case 'inchi':
        result = mol.get_inchi();
        break;
      case 'inchikey': {
        const inchiStr = mol.get_inchi();
        result = RDKit.get_inchikey_for_inchi(inchiStr);
        break;
      }
      case 'mol':
        result = mol.get_molblock();
        break;
      case 'sdf':
        result = mol.get_molblock() + '$$$$\n';
        break;
      case 'smarts':
        result = mol.get_smarts();
        break;
      case 'json':
        result = mol.get_json();
        break;
      default:
        throw new Error(`Unsupported output format: ${toFormat}`);
    }

    return { success: true, input, from: fromFormat, to: toFormat, output: result };

  } catch (e) {
    return { success: false, input: input.slice(0, 80), from: fromFormat, to: toFormat, error: e.message };
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main convert command
 */
async function convert(args) {
  const fromFormat = (args.from || 'smiles').toLowerCase();
  const toFormat = (args.to || 'smiles').toLowerCase();

  if (!SUPPORTED_FORMATS.includes(fromFormat)) {
    return { error: `Unsupported input format '${fromFormat}'. Supported: ${SUPPORTED_FORMATS.join(', ')}` };
  }
  if (!SUPPORTED_FORMATS.includes(toFormat)) {
    return { error: `Unsupported output format '${toFormat}'. Supported: ${SUPPORTED_FORMATS.join(', ')}` };
  }

  // Get input molecules
  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.molecules) molecules = parsed.molecules;
      else if (parsed.input) molecules = [parsed.input];
      else if (Array.isArray(parsed)) molecules = parsed;
    } catch (e) {
      return { error: `Invalid JSON input: ${e.message}` };
    }
  } else if (args.input) {
    molecules = [args.input];
  } else if (args.molecules) {
    molecules = Array.isArray(args.molecules) ? args.molecules : [args.molecules];
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (molecules.length === 0) {
    return { error: 'No input molecules provided. Use --input <value> or --json \'{"molecules":[...],"from":"smiles","to":"inchi"}\'' };
  }

  const results = await Promise.all(molecules.map(m => convertOne(m, fromFormat, toFormat)));

  if (results.length === 1) {
    return results[0];
  }

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return {
    count: results.length,
    successful: successful.length,
    failed: failed.length,
    results
  };
}

module.exports = { convert, convertOne, SUPPORTED_FORMATS };
