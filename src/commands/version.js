'use strict';

const path = require('path');

/**
 * Version command
 */
async function version(args) {
  let pkg;
  try {
    pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  } catch (e) {
    pkg = { version: '0.1.0' };
  }

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

  // Get @rdkit/rdkit package version
  let rdkitNpmVersion = 'unknown';
  try {
    const rdkitPkg = require(path.join(require.resolve('@rdkit/rdkit'), '..', '..', 'package.json'));
    rdkitNpmVersion = rdkitPkg.version;
  } catch (e) {
    try {
      const rdkitPkg = require(path.join(require.resolve('rdkit-js'), '..', '..', 'package.json'));
      rdkitNpmVersion = rdkitPkg.version;
    } catch (_) {}
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
