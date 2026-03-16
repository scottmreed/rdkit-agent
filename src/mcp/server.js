'use strict';

const readline = require('readline');
const { handleToolCall, RDKIT_TOOLS } = require('../tools');
const { check } = require('../commands/check');
const { convert } = require('../commands/convert');
const { descriptors } = require('../commands/descriptors');
const { balance } = require('../commands/balance');
const { fg } = require('../commands/fg');
const { repairSmiles } = require('../commands/repair-smiles');
const { subsearch } = require('../commands/subsearch');
const { fingerprint } = require('../commands/fingerprint');
const { similarity } = require('../commands/similarity');
const { scaffold } = require('../commands/scaffold');
const { filter } = require('../commands/filter');
const { draw } = require('../commands/draw');
const { stats } = require('../commands/stats');
const { edit } = require('../commands/edit');
const { rings } = require('../commands/rings');
const { react } = require('../commands/react');
const { stereo } = require('../commands/stereo');
const { tautomers } = require('../commands/tautomers');
const { atomMap } = require('../commands/atom-map');
const { version } = require('../commands/version');

// MCP Tool definitions
const MCP_TOOLS = [
  {
    name: 'check_chemistry',
    description: 'Pre-validate chemistry notation (SMILES, SMIRKS) before using it. ' +
      'Always call this BEFORE submitting any chemistry string.',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string', description: 'SMILES string to validate' },
        smirks: { type: 'string', description: 'SMIRKS reaction string to validate' },
        reactants: { type: 'array', items: { type: 'string' } },
        products: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'convert_molecule',
    description: 'Convert molecules between formats: SMILES, InChI, InChIKey, MOL, SDF',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } },
        from: { type: 'string', enum: ['smiles', 'inchi', 'mol', 'sdf'] },
        to: { type: 'string', enum: ['smiles', 'inchi', 'inchikey', 'mol', 'sdf', 'json'] }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'compute_descriptors',
    description: 'Compute molecular descriptors: MW, logP, TPSA, HBD, HBA, rotatable bonds',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'check_balance',
    description: 'Check atom conservation between reactant and product SMILES',
    inputSchema: {
      type: 'object',
      properties: {
        reactants: { type: 'array', items: { type: 'string' } },
        products: { type: 'array', items: { type: 'string' } }
      },
      required: ['reactants', 'products']
    }
  },
  {
    name: 'detect_functional_groups',
    description: 'Detect functional groups using tiered consuming SMARTS patterns',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } }
      },
      required: ['smiles']
    }
  },
  {
    name: 'repair_smiles',
    description: 'Attempt deterministic repair/reconstruction of malformed SMILES',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        smiles: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } },
        max_candidates: { type: 'integer' }
      }
    }
  },
  {
    name: 'substructure_search',
    description: 'SMARTS substructure search',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        targets: { type: 'array', items: { type: 'string' } }
      },
      required: ['query', 'targets']
    }
  },
  {
    name: 'generate_fingerprint',
    description: 'Generate Morgan or RDKit fingerprints',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        type: { type: 'string', enum: ['morgan', 'rdkit'] },
        radius: { type: 'integer' },
        nbits: { type: 'integer' }
      },
      required: ['smiles']
    }
  },
  {
    name: 'similarity_search',
    description: 'Tanimoto similarity search',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        targets: { type: 'array', items: { type: 'string' } },
        threshold: { type: 'number' },
        top: { type: 'integer' }
      },
      required: ['query', 'targets']
    }
  },
  {
    name: 'extract_scaffold',
    description: 'Extract Murcko scaffold from a molecule',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        generic: { type: 'boolean' }
      },
      required: ['smiles']
    }
  },
  {
    name: 'filter_molecules',
    description: 'Filter molecules by descriptor criteria (MW, logP, HBD, HBA, TPSA)',
    inputSchema: {
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
  },
  {
    name: 'draw_molecule',
    description: 'Render molecule to SVG',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        format: { type: 'string', enum: ['svg', 'png'] },
        width: { type: 'integer' },
        height: { type: 'integer' }
      },
      required: ['smiles']
    }
  },
  {
    name: 'analyze_rings',
    description: 'Analyze ring systems in a molecule',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'get_version',
    description: 'Get version information',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'apply_reaction',
    description: 'Apply a reaction SMIRKS to one or more reactant SMILES and return product SMILES. ' +
      'Returns NOT_SUPPORTED_IN_WASM if the WASM build lacks reaction support.',
    inputSchema: {
      type: 'object',
      properties: {
        smirks: { type: 'string', description: 'Reaction SMIRKS e.g. "[C:1][OH]>>[C:1]Br"' },
        reactants: { type: 'array', items: { type: 'string' }, description: 'Reactant SMILES list' }
      },
      required: ['smirks', 'reactants']
    }
  },
  {
    name: 'analyze_stereochemistry',
    description: 'Analyse stereocenters (tetrahedral + E/Z) in a molecule',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        molecules: { type: 'array', items: { type: 'string' } }
      },
      required: ['smiles']
    }
  },
  {
    name: 'enumerate_tautomers',
    description: 'Enumerate tautomers of a molecule. ' +
      'Returns NOT_SUPPORTED_IN_WASM if TautomerEnumerator is not in the current WASM build.',
    inputSchema: {
      type: 'object',
      properties: {
        smiles: { type: 'string' },
        limit: { type: 'integer', default: 10 }
      },
      required: ['smiles']
    }
  },
  {
    name: 'atom_map_tool',
    description: 'Add, remove, check, or list atom mapping numbers. ' +
      'Subcommands: add | remove | check | list',
    inputSchema: {
      type: 'object',
      properties: {
        subcommand: { type: 'string', enum: ['add', 'remove', 'check', 'list'] },
        smiles: { type: 'string' },
        smirks: { type: 'string' }
      },
      required: ['subcommand']
    }
  }
];

/**
 * Dispatch an MCP tool call to the appropriate command
 */
async function dispatchMcpTool(name, input) {
  const args = input || {};

  switch (name) {
    case 'check_chemistry': return check(args);
    case 'convert_molecule': return convert(args);
    case 'compute_descriptors': return descriptors(args);
    case 'check_balance': return balance(args);
    case 'detect_functional_groups': return fg(args);
    case 'repair_smiles': return repairSmiles(args);
    case 'substructure_search': return subsearch(args);
    case 'generate_fingerprint': return fingerprint(args);
    case 'similarity_search': return similarity(args);
    case 'extract_scaffold': return scaffold(args);
    case 'filter_molecules': return filter(args);
    case 'draw_molecule': return draw(args);
    case 'dataset_stats': return stats(args);
    case 'edit_molecule': return edit(args);
    case 'analyze_rings': return rings(args);
    case 'get_version': return version(args);
    case 'apply_reaction': return react(args);
    case 'analyze_stereochemistry': return stereo(args);
    case 'enumerate_tautomers': return tautomers(args);
    case 'atom_map_tool': return atomMap(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Send a JSON-RPC response to stdout
 */
function sendResponse(id, result) {
  const response = {
    jsonrpc: '2.0',
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Send a JSON-RPC error to stdout
 */
function sendError(id, code, message, data) {
  const response = {
    jsonrpc: '2.0',
    id,
    error: { code, message, data }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Handle a single JSON-RPC request
 */
async function handleRequest(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'rdkit_cli',
            version: '0.1.0'
          }
        });
        break;

      case 'tools/list':
        sendResponse(id, { tools: MCP_TOOLS });
        break;

      case 'tools/call': {
        const { name, arguments: toolArgs } = params;
        if (!name) {
          sendError(id, -32602, 'Missing tool name');
          return;
        }
        try {
          const result = await dispatchMcpTool(name, toolArgs);
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          });
        } catch (e) {
          sendResponse(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: e.message })
            }],
            isError: true
          });
        }
        break;
      }

      case 'notifications/initialized':
        // No response needed for notifications
        break;

      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    sendError(id, -32603, `Internal error: ${e.message}`);
  }
}

/**
 * Start the MCP stdio server
 */
function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: null,
    terminal: false
  });

  rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;

    let request;
    try {
      request = JSON.parse(line);
    } catch (e) {
      sendError(null, -32700, `Parse error: ${e.message}`);
      return;
    }

    await handleRequest(request);
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Log to stderr so it doesn't interfere with stdout JSON-RPC
  process.stderr.write('rdkit_cli MCP server started (stdio mode)\n');
}

module.exports = { startServer, dispatchMcpTool, MCP_TOOLS };

// Run if called directly
if (require.main === module) {
  startServer();
}
