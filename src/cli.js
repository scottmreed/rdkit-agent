'use strict';

const minimist = require('minimist');
const { printOutput, printError } = require('./output');

// Command modules
const commands = {
  check: () => require('./commands/check').check,
  'repair-smiles': () => require('./commands/repair-smiles').repairSmiles,
  convert: () => require('./commands/convert').convert,
  descriptors: () => require('./commands/descriptors').descriptors,
  balance: () => require('./commands/balance').balance,
  fg: () => require('./commands/fg').fg,
  subsearch: () => require('./commands/subsearch').subsearch,
  fingerprint: () => require('./commands/fingerprint').fingerprint,
  similarity: () => require('./commands/similarity').similarity,
  scaffold: () => require('./commands/scaffold').scaffold,
  filter: () => require('./commands/filter').filter,
  draw: () => require('./commands/draw').draw,
  stats: () => require('./commands/stats').stats,
  edit: () => require('./commands/edit').edit,
  rings: () => require('./commands/rings').rings,
  schema: () => require('./commands/schema-cmd').schemaCmd,
  version: () => require('./commands/version').version,
  plugin: () => require('./commands/plugin').plugin,
  mcp: () => async (args) => {
    const { startServer } = require('./mcp/server');
    startServer();
    return null; // MCP server runs indefinitely
  }
};

// Global flag definitions
const GLOBAL_FLAGS = {
  boolean: [
    'json-output', 'dry-run', 'strict', 'quiet', 'help', 'h', 'version', 'v', 'lipinski', 'ro5', 'generic', 'include-all',
    'state-progress', 'mechanism-step', 'unchanged-starting-materials-detected', 'resulting-state-changed',
  ],
  string: [
    'output', 'fields', 'format', 'limit', 'smiles', 'smirks', 'from', 'to', 'query', 'targets', 'reactants', 'products',
    'input', 'operation', 'type', 'radius', 'nbits', 'threshold', 'top', 'width', 'height', 'file', 'command',
    'package', 'subcommand', 'molecules', 'dbe', 'current-state', 'resulting-state', 'max-candidates',
  ],
  alias: {
    h: 'help',
    v: 'version',
    q: 'quiet',
    o: 'output',
    f: 'format',
    n: 'limit'
  }
};

const HELP_TEXT = `
rdkit_cli - Agent-first cheminformatics CLI

Usage: rdkit_cli <command> [options]

Commands:
  check         Pre-flight chemistry validation (SMILES, SMIRKS, balance, DBE, state-progress, mechanism-step)
  repair-smiles Attempt deterministic repair/reconstruction of malformed SMILES
  convert       Convert between SMILES, InChI, MOL, SDF formats
  descriptors   Compute molecular descriptors (MW, logP, TPSA, HBD, HBA, ...)
  balance       Check reaction atom balance
  fg            Detect functional groups (tiered SMARTS patterns)
  subsearch     SMARTS substructure search
  fingerprint   Generate Morgan/RDKit fingerprints
  similarity    Tanimoto similarity search
  scaffold      Extract Murcko scaffold
  filter        Filter molecules by descriptor ranges
  draw          Render molecule to SVG/PNG
  stats         Dataset statistics
  edit          Molecular transformations (neutralize, sanitize, add-h, ...)
  rings         Ring system analysis
  schema        Dump JSON Schema for a command
  version       Show version information
  plugin        Plugin management
  mcp           Start MCP stdio server

Global options:
  --output, -o  Output format: json (default when not TTY), text, csv, tsv, ndjson
  --fields      Comma-separated fields to include in output
  --limit, -n   Limit number of results
  --dry-run     Validate input without calling RDKit
  --strict      Enable strict validation
  --quiet, -q   Suppress warnings
  --json        Parse argument as JSON payload
  --help, -h    Show help
  --version, -v Show version

Examples:
  rdkit_cli check --smiles "c1ccccc1"
  rdkit_cli check --smiles "benzene"   # Will correct alias
  rdkit_cli check --smirks "[CH3:1][Br:2]>>[CH3:1][Cl:3] |mech:v1;lp:3>1;sigma:1-2>2|"
  rdkit_cli check --dbe "1-2:+2;1-1:-2"
  rdkit_cli check --state-progress --current-state "CCO,[Cl-]" --resulting-state "CCCl,[OH-]"
  rdkit_cli check --mechanism-step --current-state "CCBr,[Cl-]" --resulting-state "CCCl,[Br-]" --dbe "2-3:-2;2-4:+2"
  rdkit_cli repair-smiles --input "C1CC"
  rdkit_cli descriptors --smiles "CCO"
  rdkit_cli convert --from smiles --to inchi --input "CCO"
  rdkit_cli similarity --query "c1ccccc1" --targets "Cc1ccccc1,c1ccc2ccccc2c1" --threshold 0.5
  rdkit_cli filter --smiles "CCO,CC(C)=O" --mw-max 500 --logp-max 5
  rdkit_cli draw --smiles "c1ccccc1" --output benzene.svg
  echo '{"smiles":"CCO"}' | rdkit_cli descriptors --json -

Exit codes:
  0  Success
  1  Validation failure
  2  Usage error
  3  RDKit error
`.trim();

/**
 * Parse a JSON stdin pipe
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }

    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      if (!data.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        // Not JSON, return as string (SMILES list maybe)
        const lines = data.split('\n').map(s => s.trim()).filter(Boolean);
        resolve(lines.length === 1 ? lines[0] : lines);
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Determine output format from args and TTY
 */
function getOutputFormat(args) {
  if (args.format) return args.format;
  if (args.output && ['json', 'csv', 'tsv', 'ndjson', 'text'].includes(args.output)) return args.output;
  return process.stdout.isTTY ? 'text' : 'json';
}

/**
 * Main CLI entry point
 */
async function main(argv) {
  const args = minimist(argv || process.argv.slice(2), GLOBAL_FLAGS);

  // Handle --version flag
  if (args.version && !args._[0]) {
    const { version } = require('./commands/version');
    const versionData = await version(args);
    printOutput(versionData, { format: getOutputFormat(args) });
    return 0;
  }

  // Handle --help flag or no command
  const commandName = args._[0];
  if (!commandName || args.help) {
    if (commandName && commandName !== 'help') {
      // Command-specific help
      process.stdout.write(`Help for command '${commandName}' - use --help for general help\n`);
    } else {
      process.stdout.write(HELP_TEXT + '\n');
    }
    return 0;
  }

  // Get the command handler
  const commandLoader = commands[commandName];
  if (!commandLoader) {
    printError(`Unknown command: '${commandName}'. Run 'rdkit_cli --help' for available commands.`, {
      format: getOutputFormat(args)
    });
    return 2;
  }

  // Remove the command name from args._
  args._ = args._.slice(1);

  // Handle --json flag: parse JSON payload
  if (args.json === '-' || args.json === true) {
    try {
      const stdinData = await readStdin();
      if (stdinData) {
        if (typeof stdinData === 'object' && !Array.isArray(stdinData)) {
          // Merge JSON object into args
          Object.assign(args, stdinData);
        } else {
          args.json = stdinData;
        }
      }
    } catch (e) {
      printError(`Failed to read stdin: ${e.message}`, { format: 'json' });
      return 2;
    }
  } else if (typeof args.json === 'string' && args.json !== '-') {
    try {
      const parsed = JSON.parse(args.json);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const jsonFlag = args.json;
        Object.assign(args, parsed); // nosemgrep: insecure-object-assign (CLI context, no HTTP response)
        args.json = jsonFlag; // keep original for reference
      }
    } catch (e) {
      printError(`Invalid --json value: ${e.message}`, { format: 'json' });
      return 2;
    }
  }

  // Parse --fields as array
  if (typeof args.fields === 'string') {
    args.fields = args.fields.split(',').map(f => f.trim()).filter(Boolean);
  }

  // Parse --limit
  if (args.limit) {
    args.limit = parseInt(args.limit);
  }

  const outputFormat = getOutputFormat(args);
  const outputOptions = {
    format: outputFormat,
    fields: args.fields,
    limit: args.limit
  };

  // Run the command
  let exitCode = 0;
  try {
    const commandFn = commandLoader();
    const result = await commandFn(args);

    // null result = command handles its own output (e.g. MCP server)
    if (result === null) return 0;

    // Check for error result
    if (result && result.error) {
      if (!args.quiet) {
        printError(result.error, { format: outputFormat });
      }
      exitCode = 2;
    } else if (result && result.overall_pass === false) {
      // Check command failed
      printOutput(result, outputOptions);
      exitCode = 1;
    } else {
      printOutput(result, outputOptions);
    }

  } catch (e) {
    if (e.code === 'RDKIT_NOT_INSTALLED' || e.code === 'RDKIT_WASM_ERROR') {
      printError(`RDKit error: ${e.message}`, { format: outputFormat });
      exitCode = 3;
    } else {
      printError(`Unexpected error: ${e.message}\n${e.stack || ''}`, { format: outputFormat });
      exitCode = 1;
    }
  }

  return exitCode;
}

module.exports = { main };
