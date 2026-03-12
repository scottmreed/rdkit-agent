'use strict';

/**
 * rdkit_cli Node.js API
 *
 * This module exports the main programmatic API for using rdkit_cli from Node.js.
 * All functions are async and return JSON-serializable objects.
 *
 * Example:
 *   const { check, descriptors, convert } = require('rdkit_cli');
 *   const result = await check({ smiles: 'CCO' });
 */

const { check, checkBalance, checkSmirks } = require('./commands/check');
const { repairSmiles, repairOneSmiles } = require('./commands/repair-smiles');
const { convert, convertOne } = require('./commands/convert');
const { descriptors, computeDescriptors } = require('./commands/descriptors');
const { balance } = require('./commands/balance');
const { fg, detectFG } = require('./commands/fg');
const { subsearch } = require('./commands/subsearch');
const { fingerprint, generateFingerprint } = require('./commands/fingerprint');
const { similarity, tanimoto } = require('./commands/similarity');
const { scaffold, extractScaffold } = require('./commands/scaffold');
const { filter } = require('./commands/filter');
const { draw, drawMolecule } = require('./commands/draw');
const { stats } = require('./commands/stats');
const { edit, editMolecule } = require('./commands/edit');
const { rings, analyzeRings } = require('./commands/rings');
const { version } = require('./commands/version');
const { plugin } = require('./commands/plugin');
const { schemaCmd } = require('./commands/schema-cmd');

const { getRDKit, isRDKitAvailable, getMol, getQueryMol, withMol } = require('./wasm');
const { harden, applyAlias, checkBrackets, stripArtifacts } = require('./hardening');
const { formatOutput, printOutput, printError } = require('./output');
const { getSchema, listSchemas } = require('./schema');
const { CHECK_CHEMISTRY_TOOL, RDKIT_TOOLS, handleCheckToolCall, handleToolCall } = require('./tools');

module.exports = {
  // Commands
  check,
  checkBalance,
  checkSmirks,
  repairSmiles,
  repairOneSmiles,
  convert,
  convertOne,
  descriptors,
  computeDescriptors,
  balance,
  fg,
  detectFG,
  subsearch,
  fingerprint,
  generateFingerprint,
  similarity,
  tanimoto,
  scaffold,
  extractScaffold,
  filter,
  draw,
  drawMolecule,
  stats,
  edit,
  editMolecule,
  rings,
  analyzeRings,
  version,
  plugin,
  schemaCmd,

  // WASM utilities
  getRDKit,
  isRDKitAvailable,
  getMol,
  getQueryMol,
  withMol,

  // Hardening utilities
  harden,
  applyAlias,
  checkBrackets,
  stripArtifacts,

  // Output utilities
  formatOutput,
  printOutput,
  printError,

  // Schema utilities
  getSchema,
  listSchemas,

  // OpenAI tool definitions
  CHECK_CHEMISTRY_TOOL,
  RDKIT_TOOLS,
  handleCheckToolCall,
  handleToolCall
};
