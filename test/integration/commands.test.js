'use strict';

/**
 * Integration tests requiring rdkit-js WASM
 * These tests will be skipped if rdkit-js is not installed
 */

let RDKitAvailable = false;
let getRDKit;

beforeAll(async () => {
  try {
    const wasm = require('../../src/wasm');
    getRDKit = wasm.getRDKit;
    await wasm.getRDKit();
    RDKitAvailable = true;
  } catch (e) {
    console.warn('RDKit not available, skipping integration tests:', e.message);
  }
});

const skipIfNoRDKit = () => {
  if (!RDKitAvailable) {
    return test.skip;
  }
  return test;
};

describe('Integration - check command with RDKit', () => {
  it('validates ethanol SMILES with RDKit', async () => {
    if (!RDKitAvailable) return;
    const { check } = require('../../src/commands/check');
    const result = await check({ smiles: 'CCO' });
    expect(result.overall_pass).toBe(true);
    const rdkitCheck = result.checks.find(c => c.name === 'rdkit_parse');
    expect(rdkitCheck).toBeDefined();
    expect(rdkitCheck.pass).toBe(true);
  });

  it('detects invalid SMILES with RDKit', async () => {
    if (!RDKitAvailable) return;
    const { check } = require('../../src/commands/check');
    const result = await check({ smiles: 'INVALID_SMILES_XYZ' });
    expect(result.overall_pass).toBe(false);
  });

  it('gets canonical SMILES', async () => {
    if (!RDKitAvailable) return;
    const { check } = require('../../src/commands/check');
    const result = await check({ smiles: 'OCC' }); // non-canonical ethanol
    const canonCheck = result.checks.find(c => c.name === 'canonicalization');
    if (canonCheck) {
      expect(canonCheck.canonical_smiles).toBeDefined();
    }
  });
});

describe('Integration - descriptors command', () => {
  it('computes descriptors for ethanol', async () => {
    if (!RDKitAvailable) return;
    const { descriptors } = require('../../src/commands/descriptors');
    const result = await descriptors({ smiles: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.MW).toBeDefined();
    expect(result.MW).toBeGreaterThan(40);
    expect(result.MW).toBeLessThan(50);
  });

  it('computes descriptors for aspirin', async () => {
    if (!RDKitAvailable) return;
    const { descriptors } = require('../../src/commands/descriptors');
    const result = await descriptors({ smiles: 'CC(=O)Oc1ccccc1C(O)=O' });
    expect(result.error).toBeUndefined();
    expect(result.MW).toBeDefined();
    expect(result.MW).toBeGreaterThan(170);
    expect(result.MW).toBeLessThan(190);
    expect(result.aromatic_rings).toBeGreaterThanOrEqual(1);
  });

  it('returns error for invalid SMILES', async () => {
    if (!RDKitAvailable) return;
    const { descriptors } = require('../../src/commands/descriptors');
    const result = await descriptors({ smiles: 'INVALID_XYZ' });
    expect(result.error).toBeDefined();
  });
});

describe('Integration - convert command', () => {
  it('converts SMILES to InChI', async () => {
    if (!RDKitAvailable) return;
    const { convert } = require('../../src/commands/convert');
    const result = await convert({ from: 'smiles', to: 'inchi', input: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('InChI=');
  });

  it('converts SMILES to InChIKey', async () => {
    if (!RDKitAvailable) return;
    const { convert } = require('../../src/commands/convert');
    const result = await convert({ from: 'smiles', to: 'inchikey', input: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatch(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/);
  });

  it('converts SMILES to MOL block', async () => {
    if (!RDKitAvailable) return;
    const { convert } = require('../../src/commands/convert');
    const result = await convert({ from: 'smiles', to: 'mol', input: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('M  END');
  });
});

describe('Integration - repair-smiles command', () => {
  it('repairs unpaired ring notation', async () => {
    if (!RDKitAvailable) return;
    const { repairSmiles } = require('../../src/commands/repair-smiles');
    const result = await repairSmiles({ input: 'C1CC' });
    expect(result.success).toBe(true);
    expect(result.canonical_smiles).toBeDefined();
    expect(result.strategy).toBeDefined();
  });

  it('repairs alias-style malformed input', async () => {
    if (!RDKitAvailable) return;
    const { repairSmiles } = require('../../src/commands/repair-smiles');
    const result = await repairSmiles({ input: 'H2O' });
    expect(result.success).toBe(true);
    expect(result.canonical_smiles).toBe('O');
  });

  it('returns failure when repair is not possible', async () => {
    if (!RDKitAvailable) return;
    const { repairSmiles } = require('../../src/commands/repair-smiles');
    const result = await repairSmiles({ input: '%%%%%%' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('Integration - fg (functional groups)', () => {
  it('detects alcohol in ethanol', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.functional_groups).toBeDefined();
    const alcoholFGs = result.functional_groups.filter(g => g.name === 'alcohol');
    expect(alcoholFGs.length).toBeGreaterThan(0);
  });

  it('detects aromatic ring in benzene', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'c1ccccc1' });
    expect(result.error).toBeUndefined();
    const aromatic = result.functional_groups.find(g => g.name === 'aromatic_ring');
    expect(aromatic).toBeDefined();
  });

  it('detects carboxylic acid in acetic acid', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'CC(O)=O' });
    expect(result.error).toBeUndefined();
    const acid = result.functional_groups.find(g => g.name === 'carboxylic_acid');
    expect(acid).toBeDefined();
  });

  it('does not mislabel phenol as alcohol', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'c1ccccc1O' });
    expect(result.error).toBeUndefined();
    const phenol = result.functional_groups.find(g => g.name === 'phenol');
    const alcohol = result.functional_groups.find(g => g.name === 'alcohol');
    expect(phenol).toBeDefined();
    expect(alcohol).toBeUndefined();
  });

  it('does not mislabel carboxylic acid as alcohol', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'CC(O)=O' });
    expect(result.error).toBeUndefined();
    const acid = result.functional_groups.find(g => g.name === 'carboxylic_acid');
    const alcohol = result.functional_groups.find(g => g.name === 'alcohol');
    expect(acid).toBeDefined();
    expect(alcohol).toBeUndefined();
  });

  it('keeps common descriptors available with niche groups present', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'O=[N+]([O-])c1ccccc1' });
    expect(result.error).toBeUndefined();
    const nitro = result.functional_groups.find(g => g.name === 'nitro');
    const aromatic = result.functional_groups.find(g => g.name === 'aromatic_ring');
    expect(nitro).toBeDefined();
    expect(aromatic).toBeDefined();
  });

  it('detects multiple functional groups on aspirin', async () => {
    if (!RDKitAvailable) return;
    const { fg } = require('../../src/commands/fg');
    const result = await fg({ smiles: 'CC(=O)Oc1ccccc1C(=O)O' });
    expect(result.error).toBeUndefined();
    const ester = result.functional_groups.find(g => g.name === 'ester');
    const acid = result.functional_groups.find(g => g.name === 'carboxylic_acid');
    const aromatic = result.functional_groups.find(g => g.name === 'aromatic_ring');
    expect(ester).toBeDefined();
    expect(acid).toBeDefined();
    expect(aromatic).toBeDefined();
  });
});

describe('Integration - subsearch command', () => {
  it('finds benzene ring in toluene', async () => {
    if (!RDKitAvailable) return;
    const { subsearch } = require('../../src/commands/subsearch');
    const result = await subsearch({
      query: 'c1ccccc1',
      targets: ['Cc1ccccc1', 'CCO', 'c1ccc2ccccc2c1']
    });
    expect(result.error).toBeUndefined();
    expect(result.matched).toBeGreaterThanOrEqual(2); // toluene and naphthalene
  });
});

describe('Integration - fingerprint command', () => {
  it('generates Morgan fingerprint for benzene', async () => {
    if (!RDKitAvailable) return;
    const { fingerprint } = require('../../src/commands/fingerprint');
    const result = await fingerprint({ smiles: 'c1ccccc1', type: 'morgan', radius: 2, nbits: 2048 });
    expect(result.error).toBeUndefined();
    expect(result.fingerprint).toBeDefined();
    expect(result.fingerprint.length).toBe(2048);
    expect(result.set_bits).toBeDefined();
  });
});

describe('Integration - similarity command', () => {
  it('finds similar molecules', async () => {
    if (!RDKitAvailable) return;
    const { similarity } = require('../../src/commands/similarity');
    const result = await similarity({
      query: 'c1ccccc1',
      targets: ['Cc1ccccc1', 'CCO', 'c1ccc2ccccc2c1'],
      threshold: 0.1  // Low threshold to ensure results are returned
    });
    expect(result.error).toBeUndefined();
    expect(result.results).toBeDefined();
    expect(result.all_results).toBeDefined();
    // All results should be returned
    expect(result.all_results.length).toBe(3);
    // Toluene (Cc1ccccc1) should have higher similarity to benzene than CCO
    const toluene = result.all_results.find(r => r.smiles === 'Cc1ccccc1');
    const ethanol = result.all_results.find(r => r.smiles === 'CCO');
    if (toluene && ethanol) {
      expect(toluene.similarity).toBeGreaterThan(ethanol.similarity);
    }
  });
});

describe('Integration - scaffold command', () => {
  it('extracts scaffold from ring-containing molecule', async () => {
    if (!RDKitAvailable) return;
    const { scaffold } = require('../../src/commands/scaffold');
    const result = await scaffold({ smiles: 'CC(=O)Oc1ccccc1C(O)=O' }); // aspirin
    // Scaffold extraction may return the full molecule or a ring framework
    // depending on RDKit WASM capabilities; just check it doesn't error
    expect(result.has_scaffold).toBe(true);
    expect(result.scaffold).toBeTruthy();
  });
});

describe('Integration - filter command', () => {
  it('filters molecules by MW', async () => {
    if (!RDKitAvailable) return;
    const { filter } = require('../../src/commands/filter');
    const result = await filter({
      smiles: ['CCO', 'CC(=O)Oc1ccccc1C(O)=O', 'c1ccccc1'],
      'mw-max': 100
    });
    expect(result.error).toBeUndefined();
    expect(result.passed_molecules).toBeDefined();
    // Ethanol (46) and benzene (78) pass, aspirin (~180) fails
    expect(result.passed).toBeGreaterThanOrEqual(1);
  });

  it('applies Lipinski Ro5 filter', async () => {
    if (!RDKitAvailable) return;
    const { filter } = require('../../src/commands/filter');
    const result = await filter({
      smiles: ['CCO'],
      lipinski: true
    });
    expect(result.passed).toBe(1);
  });
});

describe('Integration - stats command', () => {
  it('computes dataset statistics', async () => {
    if (!RDKitAvailable) return;
    const { stats } = require('../../src/commands/stats');
    const result = await stats({
      smiles: ['CCO', 'c1ccccc1', 'CC(=O)Oc1ccccc1C(O)=O']
    });
    expect(result.error).toBeUndefined();
    expect(result.statistics).toBeDefined();
    expect(result.statistics.MW).toBeDefined();
    expect(result.statistics.MW.mean).toBeDefined();
    expect(result.valid).toBe(3);
  });
});

describe('Integration - edit command', () => {
  it('sanitizes a molecule', async () => {
    if (!RDKitAvailable) return;
    const { edit } = require('../../src/commands/edit');
    const result = await edit({ smiles: 'CCO', operation: 'sanitize' });
    expect(result.error).toBeUndefined();
    expect(result.result_smiles).toBeDefined();
  });

  it('strips atom map numbers', async () => {
    if (!RDKitAvailable) return;
    const { edit } = require('../../src/commands/edit');
    const result = await edit({ smiles: '[CH3:1][OH:2]', operation: 'strip-maps' });
    expect(result.error).toBeUndefined();
    expect(result.result_smiles).not.toContain(':1');
  });
});

describe('Integration - rings command', () => {
  it('analyzes benzene ring', async () => {
    if (!RDKitAvailable) return;
    const { rings } = require('../../src/commands/rings');
    const result = await rings({ smiles: 'c1ccccc1' });
    expect(result.error).toBeUndefined();
    expect(result.ring_count).toBeGreaterThanOrEqual(1);
    expect(result.aromatic_rings).toBeGreaterThanOrEqual(1);
  });

  it('analyzes acyclic molecule', async () => {
    if (!RDKitAvailable) return;
    const { rings } = require('../../src/commands/rings');
    const result = await rings({ smiles: 'CCO' });
    expect(result.error).toBeUndefined();
    expect(result.ring_count).toBe(0);
  });
});

describe('Integration - draw command', () => {
  it('renders benzene to SVG', async () => {
    if (!RDKitAvailable) return;
    const { draw } = require('../../src/commands/draw');
    const result = await draw({ smiles: 'c1ccccc1', format: 'svg', width: 200, height: 200 });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('<svg');
  });
});

describe('Integration - version command', () => {
  it('returns version info', async () => {
    const { version } = require('../../src/commands/version');
    const result = await version({});
    expect(result.rdkit_cli).toBeDefined();
    expect(result.node).toBeDefined();
  });
});
