'use strict';

let rdkitInstance = null;
let rdkitLoading = null;
let rdkitLoadError = null;

/**
 * Get the RDKit WASM module, initializing it on first call.
 * Returns the initialized RDKit module.
 * Throws if rdkit-js is not installed or fails to load.
 */
async function getRDKit() {
  if (rdkitInstance) return rdkitInstance;
  if (rdkitLoadError) throw rdkitLoadError;

  if (rdkitLoading) {
    return rdkitLoading;
  }

  rdkitLoading = (async () => {
    let initRDKitModule;
    try {
      // Try the @rdkit/rdkit package first (newer)
      initRDKitModule = require('@rdkit/rdkit');
      if (typeof initRDKitModule !== 'function') {
        // Some versions export differently
        initRDKitModule = initRDKitModule.default || initRDKitModule.initRDKitModule;
      }
    } catch (e1) {
      try {
        // Fall back to rdkit-js
        initRDKitModule = require('rdkit-js');
      } catch (e2) {
        const err = new Error(
          'rdkit-js / @rdkit/rdkit is not installed. Run: npm install @rdkit/rdkit\n' +
          `Original errors:\n  @rdkit/rdkit: ${e1.message}\n  rdkit-js: ${e2.message}`
        );
        err.code = 'RDKIT_NOT_INSTALLED';
        rdkitLoadError = err;
        throw err;
      }
    }

    if (typeof initRDKitModule !== 'function') {
      const err = new Error(
        'rdkit-js module loaded but initRDKitModule is not a function. ' +
        `Got type: ${typeof initRDKitModule}. Check the package version.`
      );
      err.code = 'RDKIT_INIT_ERROR';
      rdkitLoadError = err;
      throw err;
    }

    try {
      rdkitInstance = await initRDKitModule();
      return rdkitInstance;
    } catch (e) {
      const err = new Error(`Failed to initialize RDKit WASM module: ${e.message}`);
      err.code = 'RDKIT_WASM_ERROR';
      err.cause = e;
      rdkitLoadError = err;
      throw err;
    }
  })();

  return rdkitLoading;
}

/**
 * Check if RDKit is available without throwing
 */
async function isRDKitAvailable() {
  try {
    await getRDKit();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get a molecule object from SMILES, with cleanup.
 * Returns { mol, valid, error }
 */
async function getMol(smiles) {
  const RDKit = await getRDKit();
  let mol = null;
  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) {
      if (mol) mol.delete();
      return { mol: null, valid: false, error: `Invalid molecule: ${smiles}` };
    }
    return { mol, valid: true, error: null };
  } catch (e) {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
    return { mol: null, valid: false, error: e.message };
  }
}

/**
 * Get a query molecule from SMARTS
 */
async function getQueryMol(smarts) {
  const RDKit = await getRDKit();
  let mol = null;
  try {
    mol = RDKit.get_qmol(smarts);
    if (!mol || !mol.is_valid()) {
      if (mol) mol.delete();
      return { mol: null, valid: false, error: `Invalid SMARTS: ${smarts}` };
    }
    return { mol, valid: true, error: null };
  } catch (e) {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
    return { mol: null, valid: false, error: e.message };
  }
}

/**
 * Safe molecule operation with automatic cleanup
 */
async function withMol(smiles, fn) {
  const { mol, valid, error } = await getMol(smiles);
  if (!valid) {
    return { success: false, error };
  }
  try {
    const result = await fn(mol);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Reset the cached RDKit instance (for testing)
 */
function resetRDKit() {
  rdkitInstance = null;
  rdkitLoading = null;
  rdkitLoadError = null;
}

module.exports = { getRDKit, isRDKitAvailable, getMol, getQueryMol, withMol, resetRDKit };
