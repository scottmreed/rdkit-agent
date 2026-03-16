'use strict';

const path = require('path');

/**
 * Read the @rdkit/rdkit npm package version from disk (no WASM init).
 */
function readRdkitNpmVersion() {
  try {
    const rdkitPkg = require(path.join(require.resolve('@rdkit/rdkit'), '..', '..', 'package.json'));
    return rdkitPkg.version;
  } catch (e) {
    try {
      const rdkitPkg = require(path.join(require.resolve('rdkit-js'), '..', '..', 'package.json'));
      return rdkitPkg.version;
    } catch (_) {
      return 'unknown';
    }
  }
}

/**
 * Version command.
 *
 * --full  Also loads the RDKit WASM module to report its runtime version.
 *         Without --full, WASM is never initialised so the command is instant.
 */
async function version(args) {
  let pkg;
  try {
    pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  } catch (e) {
    pkg = { version: '0.1.0' };
  }

  const rdkitNpmVersion = readRdkitNpmVersion();

  // Fast path: skip WASM entirely unless --full is requested.
  if (!args || !args.full) {
    return {
      rdkit_cli: pkg.version,
      rdkit_js: rdkitNpmVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }

  // Full path: load WASM to get the runtime version string.
  let rdkitVersion = 'unknown';
  let rdkitStatus = 'unknown';

  try {
    const wasm = require('../wasm');
    const RDKit = await wasm.getRDKit();
    try {
      rdkitVersion = RDKit.version ? RDKit.version() : 'unknown';
    } catch (e) {
      rdkitVersion = 'loaded (version unavailable)';
    }
    rdkitStatus = 'available';
  } catch (e) {
    rdkitVersion = 'not available';
    rdkitStatus = e.code === 'RDKIT_NOT_INSTALLED' ? 'not installed' : 'error';
  }

  return {
    rdkit_cli: pkg.version,
    rdkit_js: rdkitNpmVersion,
    rdkit_wasm: rdkitVersion,
    rdkit_status: rdkitStatus,
    node: process.version,
    platform: process.platform,
    arch: process.arch
  };
}

module.exports = { version };
