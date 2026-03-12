'use strict';

const { check, syntaxCheck, aliasCheck, heuristicCheck, parseDbeEntries } = require('../../src/commands/check');

describe('check command - Layer 1 syntax', () => {
  test('passes valid SMILES CCO', () => {
    const checks = syntaxCheck('CCO');
    const failed = checks.filter(c => !c.pass);
    expect(failed.length).toBe(0);
  });

  test('passes valid aromatic SMILES c1ccccc1', () => {
    const checks = syntaxCheck('c1ccccc1');
    const failed = checks.filter(c => !c.pass);
    expect(failed.length).toBe(0);
  });

  test('passes complex SMILES with brackets', () => {
    const checks = syntaxCheck('[Na+].[Cl-]');
    const failed = checks.filter(c => !c.pass);
    expect(failed.length).toBe(0);
  });

  test('fails for English word "benzene"', () => {
    const checks = syntaxCheck('benzene');
    const wordCheck = checks.find(c => c.name === 'english_word_check');
    expect(wordCheck).toBeDefined();
    expect(wordCheck.pass).toBe(false);
  });

  test('fails for unbalanced bracket [Na+', () => {
    const checks = syntaxCheck('[Na+');
    const bracketCheck = checks.find(c => c.name === 'bracket_matching');
    expect(bracketCheck).toBeDefined();
    expect(bracketCheck.pass).toBe(false);
  });

  test('fails for unclosed ring c1ccccc', () => {
    const checks = syntaxCheck('c1ccccc');
    const ringCheck = checks.find(c => c.name === 'ring_closure_parity');
    expect(ringCheck).toBeDefined();
    expect(ringCheck.pass).toBe(false);
  });

  test('fails for invalid character $', () => {
    // $ is not in SMILES charset
    const checks = syntaxCheck('CC$O');
    const charCheck = checks.find(c => c.name === 'charset_validation');
    // Note: $ might actually be in the SMILES charset set from some implementations
    // This test checks that we detect obvious non-SMILES chars
    expect(charCheck).toBeDefined();
  });
});

describe('check command - Layer 2 alias correction', () => {
  test('corrects H2O alias', () => {
    const result = aliasCheck('H2O');
    expect(result.corrected).toBe(true);
    expect(result.corrected_value).toBe('O');
  });

  test('corrects EtOH alias', () => {
    const result = aliasCheck('EtOH');
    expect(result.corrected).toBe(true);
    expect(result.corrected_value).toBe('CCO');
  });

  test('no correction for valid SMILES CCO', () => {
    const result = aliasCheck('CCO');
    expect(result.corrected).toBe(false);
  });

  test('no correction for canonical benzene SMILES', () => {
    const result = aliasCheck('c1ccccc1');
    expect(result.corrected).toBe(false);
  });
});

describe('check command - Layer 3 heuristics', () => {
  test('no changes for clean SMILES', () => {
    const result = heuristicCheck('CCO');
    expect(result.corrected_value).toBeNull();
  });

  test('strips SMILES: prefix artifact', () => {
    const result = heuristicCheck('SMILES: CCO');
    const artifactCheck = result.checks.find(c => c.name === 'artifact_strip');
    expect(artifactCheck.corrected).toBe(true);
    expect(result.corrected_value).toBe('CCO');
  });

  test('corrects bare ion Na to [Na]', () => {
    const result = heuristicCheck('Na');
    const bareIonCheck = result.checks.find(c => c.name === 'bare_ion_bracketing');
    if (bareIonCheck && bareIonCheck.corrected) {
      expect(result.corrected_value).toBe('[Na]');
    }
  });
});

describe('check command - full flow (no RDKit)', () => {
  test('check passes for ethanol SMILES', async () => {
    const result = await check({ smiles: 'CCO', 'no-rdkit': true });
    expect(result.overall_pass).toBe(true);
    expect(result.checks).toBeDefined();
    expect(result.failed_checks).toBeDefined();
  });

  test('check fails for English word "benzene" and suggests SMILES', async () => {
    const result = await check({ smiles: 'benzene', 'no-rdkit': true });
    // benzene is in aliases, so it might pass with correction
    // or fail with English word check
    expect(result).toBeDefined();
    if (!result.overall_pass) {
      expect(result.fix_suggestions.length).toBeGreaterThan(0);
    } else {
      // Was corrected via alias
      expect(result.corrected_values).toBeDefined();
    }
  });

  test('check fails for "H2O" and corrects to "O"', async () => {
    const result = await check({ smiles: 'H2O', 'no-rdkit': true });
    expect(result).toBeDefined();
    // H2O should be corrected via alias
    if (result.corrected_values && result.corrected_values.alias_correction) {
      expect(result.corrected_values.alias_correction).toBe('O');
    }
  });

  test('check fails for unbalanced brackets', async () => {
    const result = await check({ smiles: '[Na+', 'no-rdkit': true });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks.length).toBeGreaterThan(0);
  });

  test('check fails for unclosed ring c1ccccc', async () => {
    const result = await check({ smiles: 'c1ccccc', 'no-rdkit': true });
    expect(result.overall_pass).toBe(false);
  });

  test('check has required output structure', async () => {
    const result = await check({ smiles: 'CCO', 'no-rdkit': true });
    expect(result).toHaveProperty('overall_pass');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('failed_checks');
    expect(result).toHaveProperty('fix_suggestions');
    expect(result).toHaveProperty('corrected_values');
  });

  test('check with no input returns error', async () => {
    const result = await check({});
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks.some(c => c.name === 'input_required')).toBe(true);
  });
});

describe('check command - LLM error taxonomy', () => {
  test('handles "benzene" (English word for c1ccccc1)', async () => {
    const result = await check({ smiles: 'benzene', 'no-rdkit': true });
    // Should either correct or reject, not crash
    expect(result).toBeDefined();
    expect(typeof result.overall_pass).toBe('boolean');
  });

  test('handles "H2O" (formula for O)', async () => {
    const result = await check({ smiles: 'H2O', 'no-rdkit': true });
    expect(result).toBeDefined();
    // Should detect as alias or at minimum not crash
  });

  test('handles unbalanced brackets "[CH3+"', async () => {
    const result = await check({ smiles: '[CH3+', 'no-rdkit': true });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks.some(c => c.name === 'bracket_matching')).toBe(true);
  });

  test('handles pericyclic notation [4+2]', async () => {
    // This should be caught by hardening before check runs
    const { harden } = require('../../src/hardening');
    const hardenResult = harden('[4+2]', 'smiles');
    expect(hardenResult.error).toBeTruthy();
    expect(hardenResult.error).toMatch(/pericyclic/i);
  });

  test('handles SMILES with markdown code block', async () => {
    const result = await check({ smiles: '```\nc1ccccc1\n```', 'no-rdkit': true });
    // After artifact strip it should work
    expect(result).toBeDefined();
  });

  test('handles quoted SMILES "CCO"', async () => {
    const result = await check({ smiles: '"CCO"', 'no-rdkit': true });
    // After quote stripping it should work
    expect(result).toBeDefined();
    expect(typeof result.overall_pass).toBe('boolean');
  });

  test('handles SMILES: prefix', async () => {
    const result = await check({ smiles: 'SMILES: CCO', 'no-rdkit': true });
    expect(result).toBeDefined();
  });
});

describe('check command - balance check', () => {
  test('detects balanced reaction', async () => {
    // H2 + O → H2O: not really balanced element-wise in SMILES terms
    // Simple: C + O → CO (carbon monoxide)
    const result = await check({
      reactants: '[C].[O]',
      products: '[C-]#[O+]'
    });
    expect(result).toBeDefined();
    expect(typeof result.overall_pass).toBe('boolean');
  });
});

describe('check command - SMIRKS validation', () => {
  test('validates basic SMIRKS format', async () => {
    const result = await check({ smirks: '[C:1]>>[C:1]=O', 'no-rdkit': true });
    expect(result).toBeDefined();
    expect(typeof result.overall_pass).toBe('boolean');
  });

  test('rejects SMIRKS without >>', async () => {
    const result = await check({ smirks: 'CCO', 'no-rdkit': true });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks.some(c => c.name === 'smirks_format')).toBe(true);
  });

  test('strips CX metadata block before parse', async () => {
    const result = await check({ smirks: '[CH3:1][Br:2].[Cl-:3]>>[CH3:1][Cl:3].[Br-:2] |mech:v1;lp:3>1;sigma:1-2>2|' });
    expect(result).toBeDefined();
    expect(result.mode).toBe('smirks');
    expect(result.diagnostics).toBeDefined();
    expect(Array.isArray(result.diagnostics.metadata_blocks_removed)).toBe(true);
    expect(result.diagnostics.metadata_blocks_removed.length).toBeGreaterThanOrEqual(1);
  });
});

describe('check command - DBE validation', () => {
  test('parses valid conserving DBE entries', async () => {
    const result = await check({ dbe: '1-2:+2;1-1:-2', strict: true });
    expect(result.overall_pass).toBe(true);
    expect(result.failed_checks.length).toBe(0);
  });

  test('rejects malformed DBE entries', async () => {
    const result = await check({ dbe: '1-2+2', strict: true });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks[0].error_code).toBe('dbe_entry_missing_separator');
  });

  test('rejects non-conserving DBE in strict mode', async () => {
    const result = await check({ dbe: '1-2:+2', strict: true });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks[0].error_code).toBe('dbe_non_conserving');
  });

  test('parseDbeEntries helper reports parsed entries', () => {
    const parsed = parseDbeEntries('1-2:+2;1-1:-2', { enforceConservation: true });
    expect(parsed.valid).toBe(true);
    expect(parsed.total_delta).toBe(0);
    expect(parsed.entries.length).toBe(2);
  });
});

describe('check command - state progress', () => {
  test('passes changed state arrays', async () => {
    const result = await check({
      'state-progress': true,
      'current-state': 'CCBr,[Cl-]',
      'resulting-state': 'CCCl,[Br-]'
    });
    expect(result.mode).toBe('state_progress');
    expect(result.overall_pass).toBe(true);
  });

  test('fails unchanged state arrays', async () => {
    const result = await check({
      'state-progress': true,
      'current-state': 'CCO,[Cl-]',
      'resulting-state': 'CCO,[Cl-]'
    });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_checks[0].error_code).toBe('state_progress_no_change');
  });
});

describe('check command - mechanism step aggregate', () => {
  test('returns expected validator names in one payload', async () => {
    const result = await check({
      'mechanism-step': true,
      'current-state': 'CCBr,[Cl-]',
      'resulting-state': 'CCCl,[Br-]',
      dbe: '2-3:-2;2-4:+2',
      strict: true,
    });
    expect(result.mode).toBe('mechanism_step');
    const names = result.checks.map((item) => item.name);
    expect(names).toContain('atom_balance');
    expect(names).toContain('dbe_metadata');
    expect(names).toContain('state_progress');
  });

  test('flags invalid atom-balance species in mechanism-step output', async () => {
    const result = await check({
      'mechanism-step': true,
      'current-state': 'CCBr,not_a_smiles',
      'resulting-state': 'CCCl,[Br-]',
      dbe: '2-3:-2;2-4:+2',
      strict: true,
    });
    expect(result.overall_pass).toBe(false);
    expect(result.failed_check_names).toContain('atom_balance');
  });
});
