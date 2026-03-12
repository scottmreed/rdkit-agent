'use strict';

const SCHEMAS = {
  check: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'CheckInput',
    type: 'object',
    properties: {
      smiles: { type: 'string', description: 'SMILES string to validate' },
      smirks: { type: 'string', description: 'SMIRKS reaction string to validate' },
      balance: {
        type: 'object',
        properties: {
          reactants: { type: 'array', items: { type: 'string' } },
          products: { type: 'array', items: { type: 'string' } }
        }
      },
      dbe: { type: 'string', description: 'DBE notation to validate' },
      state_progress: { type: 'boolean', description: 'Run state-progress validation mode' },
      mechanism_step: { type: 'boolean', description: 'Run aggregate mechanism-step validation mode' },
      current_state: { type: 'array', items: { type: 'string' } },
      resulting_state: { type: 'array', items: { type: 'string' } },
      unchanged_starting_materials_detected: { type: 'boolean' },
      resulting_state_changed: { type: 'boolean' },
      bond_electron_validation: { type: 'object' },
      strict: { type: 'boolean', default: false }
    },
    output: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'CheckOutput',
      type: 'object',
      properties: {
        overall_pass: { type: 'boolean' },
        summary: { type: 'string' },
        mode: { type: 'string' },
        backend: { type: 'string' },
        method: { type: 'string' },
        checks: { type: 'array', items: { type: 'object' } },
        failed_checks: { type: 'array', items: { type: 'object' } },
        failed_check_names: { type: 'array', items: { type: 'string' } },
        fix_suggestions: { type: 'array', items: { type: 'string' } },
        corrected_values: { type: 'object' },
        diagnostics: { type: 'object' }
      },
      required: ['overall_pass', 'summary', 'mode', 'backend', 'method', 'checks', 'failed_checks', 'failed_check_names', 'fix_suggestions']
    }
  },

  'repair-smiles': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'RepairSmilesInput',
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Single malformed SMILES candidate' },
      smiles: { type: 'string', description: 'Alias for input' },
      molecules: { type: 'array', items: { type: 'string' }, description: 'Batch malformed SMILES candidates' },
      max_candidates: { type: 'integer', minimum: 1, default: 12, description: 'Maximum generated repair attempts per molecule' }
    }
  },

  convert: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ConvertInput',
    type: 'object',
    properties: {
      molecules: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of molecules to convert'
      },
      input: { type: 'string', description: 'Single molecule to convert' },
      from: {
        type: 'string',
        enum: ['smiles', 'inchi', 'mol', 'sdf', 'smarts'],
        description: 'Input format'
      },
      to: {
        type: 'string',
        enum: ['smiles', 'inchi', 'inchikey', 'mol', 'sdf', 'smarts', 'json'],
        description: 'Output format'
      }
    },
    required: ['from', 'to']
  },

  descriptors: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'DescriptorsInput',
    type: 'object',
    properties: {
      molecules: { type: 'array', items: { type: 'string' } },
      smiles: { type: 'string' }
    },
    output: {
      title: 'DescriptorsOutput',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          smiles: { type: 'string' },
          MW: { type: 'number' },
          logP: { type: 'number' },
          TPSA: { type: 'number' },
          HBD: { type: 'integer' },
          HBA: { type: 'integer' },
          rotatable_bonds: { type: 'integer' },
          aromatic_rings: { type: 'integer' },
          heavy_atoms: { type: 'integer' }
        }
      }
    }
  },

  balance: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'BalanceInput',
    type: 'object',
    properties: {
      reactants: { type: 'array', items: { type: 'string' } },
      products: { type: 'array', items: { type: 'string' } }
    },
    required: ['reactants', 'products']
  },

  fg: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'FGInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      molecules: { type: 'array', items: { type: 'string' } }
    }
  },

  subsearch: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'SubsearchInput',
    type: 'object',
    properties: {
      query: { type: 'string', description: 'SMARTS query' },
      targets: { type: 'array', items: { type: 'string' } },
      file: { type: 'string', description: 'SDF file path' }
    },
    required: ['query']
  },

  fingerprint: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'FingerprintInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      type: { type: 'string', enum: ['morgan', 'rdkit'], default: 'morgan' },
      radius: { type: 'integer', default: 2, minimum: 1 },
      nbits: { type: 'integer', default: 2048, minimum: 64 }
    },
    required: ['smiles']
  },

  similarity: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'SimilarityInput',
    type: 'object',
    properties: {
      query: { type: 'string' },
      targets: { type: 'array', items: { type: 'string' } },
      threshold: { type: 'number', default: 0.7, minimum: 0, maximum: 1 },
      top: { type: 'integer', default: 10, minimum: 1 }
    },
    required: ['query', 'targets']
  },

  scaffold: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ScaffoldInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      molecules: { type: 'array', items: { type: 'string' } },
      generic: { type: 'boolean', default: false, description: 'Return generic scaffold' }
    }
  },

  filter: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'FilterInput',
    type: 'object',
    properties: {
      smiles: { type: 'array', items: { type: 'string' } },
      mw_min: { type: 'number' },
      mw_max: { type: 'number' },
      logp_min: { type: 'number' },
      logp_max: { type: 'number' },
      hba_max: { type: 'integer' },
      hbd_max: { type: 'integer' },
      tpsa_max: { type: 'number' },
      rotatable_bonds_max: { type: 'integer' }
    }
  },

  draw: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'DrawInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      output: { type: 'string' },
      format: { type: 'string', enum: ['svg', 'png'], default: 'svg' },
      width: { type: 'integer', default: 300 },
      height: { type: 'integer', default: 300 }
    },
    required: ['smiles']
  },

  stats: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'StatsInput',
    type: 'object',
    properties: {
      smiles: { type: 'array', items: { type: 'string' } },
      file: { type: 'string' }
    }
  },

  edit: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'EditInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      operation: {
        type: 'string',
        enum: ['neutralize', 'strip-maps', 'sanitize', 'add-h', 'remove-h']
      }
    },
    required: ['smiles', 'operation']
  },

  rings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'RingsInput',
    type: 'object',
    properties: {
      smiles: { type: 'string' },
      molecules: { type: 'array', items: { type: 'string' } }
    }
  },

  version: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'VersionOutput',
    type: 'object',
    properties: {
      rdkit_cli: { type: 'string' },
      rdkit_js: { type: 'string' },
      node: { type: 'string' },
      platform: { type: 'string' }
    }
  }
};

/**
 * Get JSON Schema for a given command name
 * @param {string} commandName
 * @returns {object} JSON Schema object
 */
function getSchema(commandName) {
  return SCHEMAS[commandName] || null;
}

/**
 * List all available command schemas
 */
function listSchemas() {
  return Object.keys(SCHEMAS);
}

module.exports = { getSchema, listSchemas, SCHEMAS };
