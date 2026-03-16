'use strict';

const { check } = require('../commands/check');

/**
 * OpenAI function-calling format tool definition for check_chemistry
 */
const CHECK_CHEMISTRY_TOOL = {
  type: 'function',
  function: {
    name: 'check_chemistry',
    description: 'Pre-validate chemistry notation (SMILES, SMIRKS, or reaction balance) before using it. ' +
      'Call this BEFORE submitting any chemistry string to other tools to avoid errors. ' +
      'Returns validation results, corrections, and suggestions.',
    parameters: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        smiles: {
          type: 'string',
          description: 'SMILES string to validate (e.g., "CCO" for ethanol, "c1ccccc1" for benzene)'
        },
        smirks: {
          type: 'string',
          description: 'SMIRKS reaction string to validate (e.g., "[C:1][OH:2]>>[C:1]=[O:2]")'
        },
        reactants: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of reactant SMILES for balance check'
        },
        products: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of product SMILES for balance check'
        },
        strict: {
          type: 'boolean',
          default: false,
          description: 'Enable strict validation mode'
        }
      },
      anyOf: [
        { required: ['smiles'] },
        { required: ['smirks'] },
        { required: ['reactants', 'products'] }
      ]
    }
  }
};

/**
 * Tool definitions for all commands in OpenAI format
 */
const RDKIT_TOOLS = [
  CHECK_CHEMISTRY_TOOL,
  {
    type: 'function',
    function: {
      name: 'convert_molecule',
      description: 'Convert molecules between formats: SMILES, InChI, InChIKey, MOL, SDF',
      parameters: {
        type: 'object',
        properties: {
          molecules: { type: 'array', items: { type: 'string' }, description: 'Molecules to convert' },
          input: { type: 'string', description: 'Single molecule to convert' },
          from: { type: 'string', enum: ['smiles', 'inchi', 'mol', 'sdf'], description: 'Input format' },
          to: { type: 'string', enum: ['smiles', 'inchi', 'inchikey', 'mol', 'sdf', 'json'], description: 'Output format' }
        },
        required: ['from', 'to']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compute_descriptors',
      description: 'Compute molecular descriptors: MW, logP, TPSA, HBD, HBA, rotatable bonds, aromatic rings, heavy atoms',
      parameters: {
        type: 'object',
        properties: {
          smiles: { type: 'string', description: 'SMILES string' },
          molecules: { type: 'array', items: { type: 'string' }, description: 'Multiple SMILES strings' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'detect_functional_groups',
      description: 'Detect functional groups in a molecule using tiered consuming SMARTS patterns',
      parameters: {
        type: 'object',
        properties: {
          smiles: { type: 'string', description: 'SMILES string' },
          molecules: { type: 'array', items: { type: 'string' } }
        },
        required: ['smiles']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'repair_smiles',
      description: 'Attempt deterministic repair/reconstruction of malformed SMILES and return a valid canonical guess when possible',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Malformed SMILES candidate' },
          smiles: { type: 'string', description: 'Alias for input' },
          molecules: { type: 'array', items: { type: 'string' }, description: 'Batch malformed SMILES candidates' },
          max_candidates: { type: 'integer', description: 'Maximum repair attempts per input' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'similarity_search',
      description: 'Tanimoto similarity search: find molecules similar to a query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query SMILES' },
          targets: { type: 'array', items: { type: 'string' }, description: 'Target SMILES list' },
          threshold: { type: 'number', default: 0.7, minimum: 0, maximum: 1 },
          top: { type: 'integer', default: 10 }
        },
        required: ['query', 'targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'substructure_search',
      description: 'SMARTS substructure search in a list of molecules',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SMARTS query pattern' },
          targets: { type: 'array', items: { type: 'string' }, description: 'Target SMILES' }
        },
        required: ['query', 'targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'filter_molecules',
      description: 'Filter molecules by descriptor ranges (Lipinski Ro5, etc.)',
      parameters: {
        type: 'object',
        properties: {
          smiles: { type: 'array', items: { type: 'string' } },
          mw_max: { type: 'number' },
          logp_max: { type: 'number' },
          hba_max: { type: 'integer' },
          hbd_max: { type: 'integer' },
          tpsa_max: { type: 'number' }
        },
        required: ['smiles']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_reaction',
      description: 'Apply a reaction SMIRKS to one or more reactant SMILES and return product SMILES. ' +
        'Requires RDKit WASM with reaction support (get_rxn). ' +
        'Returns NOT_SUPPORTED_IN_WASM error if the current build lacks reaction chemistry.',
      parameters: {
        type: 'object',
        properties: {
          smirks: {
            type: 'string',
            description: 'Reaction SMIRKS, e.g. "[C:1][OH]>>[C:1]Br"'
          },
          reactants: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of reactant SMILES to apply the reaction to'
          }
        },
        required: ['smirks', 'reactants']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_stereochemistry',
      description: 'Analyse stereocenters in a molecule: tetrahedral chirality, E/Z double bonds, ' +
        'specified vs unspecified stereo, CIP codes when available.',
      parameters: {
        type: 'object',
        properties: {
          smiles: { type: 'string', description: 'SMILES string' },
          molecules: { type: 'array', items: { type: 'string' }, description: 'Multiple SMILES' }
        },
        required: ['smiles']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'atom_map_tool',
      description: 'Add, remove, check, or list atom mapping numbers in a SMILES/SMIRKS. ' +
        'Subcommands: add (auto-assign), remove (strip all), check (validate SMIRKS mapping), list (atom_idx → map_num).',
      parameters: {
        type: 'object',
        properties: {
          subcommand: {
            type: 'string',
            enum: ['add', 'remove', 'check', 'list'],
            description: 'Sub-command to run'
          },
          smiles: { type: 'string', description: 'SMILES string (for add / remove / list)' },
          smirks: { type: 'string', description: 'Reaction SMIRKS (for check)' }
        },
        required: ['subcommand']
      }
    }
  }
];

/**
 * Handle a check_chemistry tool call
 * @param {object} args - Tool call arguments
 * @returns {Promise<object>} Check result
 */
async function handleCheckToolCall(args) {
  try {
    const result = await check(args);
    return result;
  } catch (e) {
    return {
      overall_pass: false,
      summary: `Error during validation: ${e.message}`,
      checks: [{ layer: 0, name: 'error', pass: false, message: e.message }],
      failed_checks: [{ layer: 0, name: 'error', pass: false, message: e.message }],
      fix_suggestions: [],
      corrected_values: {}
    };
  }
}

/**
 * Handle any tool call by name
 */
async function handleToolCall(name, args) {
  switch (name) {
    case 'check_chemistry':
      return handleCheckToolCall(args);

    case 'convert_molecule': {
      const { convert } = require('../commands/convert');
      return convert(args);
    }

    case 'compute_descriptors': {
      const { descriptors } = require('../commands/descriptors');
      return descriptors(args);
    }

    case 'detect_functional_groups': {
      const { fg } = require('../commands/fg');
      return fg(args);
    }

    case 'repair_smiles': {
      const { repairSmiles } = require('../commands/repair-smiles');
      return repairSmiles(args);
    }

    case 'similarity_search': {
      const { similarity } = require('../commands/similarity');
      return similarity(args);
    }

    case 'substructure_search': {
      const { subsearch } = require('../commands/subsearch');
      return subsearch(args);
    }

    case 'filter_molecules': {
      const { filter } = require('../commands/filter');
      return filter(args);
    }

    case 'apply_reaction': {
      const { reactionApply } = require('../commands/react');
      return reactionApply(args);
    }

    case 'analyze_stereochemistry': {
      const { analyzeStereo } = require('../commands/stereo');
      if (args.molecules && Array.isArray(args.molecules)) {
        const results = await Promise.all(args.molecules.map(s => analyzeStereo(s)));
        return { count: results.length, results };
      }
      return analyzeStereo(args.smiles || args.input);
    }

    case 'atom_map_tool': {
      const { atomMap } = require('../commands/atom-map');
      return atomMap(args);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { CHECK_CHEMISTRY_TOOL, RDKIT_TOOLS, handleCheckToolCall, handleToolCall };
