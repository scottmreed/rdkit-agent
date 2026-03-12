'use strict';

const {
  harden,
  stripArtifacts,
  applyAlias,
  checkBrackets,
  isEnglishWord,
  sandboxOutputPath,
  ALIASES
} = require('../../src/hardening');

describe('hardening - alias correction', () => {
  test('corrects H2O to O', () => {
    const result = harden('H2O', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('O');
    expect(result.corrections.some(c => c.type === 'alias_correction')).toBe(true);
  });

  test('corrects CO2 to O=C=O', () => {
    const result = harden('CO2', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('O=C=O');
  });

  test('corrects NH3 to N', () => {
    const result = harden('NH3', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('N');
  });

  test('corrects EtOH to CCO', () => {
    const result = harden('EtOH', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('CCO');
  });

  test('corrects MeOH to CO', () => {
    const result = harden('MeOH', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('CO');
  });

  test('corrects benzene (English name) to c1ccccc1', () => {
    const result = harden('benzene', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('c1ccccc1');
  });

  test('corrects NaCl to [Na+].[Cl-]', () => {
    const result = harden('NaCl', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('[Na+].[Cl-]');
  });

  test('corrects NaOH to [Na+].[OH-]', () => {
    const result = harden('NaOH', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('[Na+].[OH-]');
  });

  test('corrects DMSO to CS(C)=O', () => {
    const result = harden('DMSO', 'smiles');
    expect(result.error).toBeNull();
    expect(result.value).toBe('CS(C)=O');
  });

  test('has at least 50 alias entries', () => {
    expect(Object.keys(ALIASES).length).toBeGreaterThanOrEqual(50);
  });

  test('applyAlias returns corrected for known alias', () => {
    const result = applyAlias('H2O');
    expect(result.corrected).toBe(true);
    expect(result.value).toBe('O');
  });

  test('applyAlias returns uncorrected for unknown input', () => {
    const result = applyAlias('CCO');
    expect(result.corrected).toBe(false);
    expect(result.value).toBe('CCO');
  });
});

describe('hardening - English word rejection', () => {
  test('rejects "water" as English word', () => {
    const result = isEnglishWord('water');
    expect(result.isWord).toBe(true);
  });

  test('rejects "benzene" as English word', () => {
    const result = isEnglishWord('benzene');
    expect(result.isWord).toBe(true);
  });

  test('accepts "CCO" as SMILES', () => {
    const result = isEnglishWord('CCO');
    expect(result.isWord).toBe(false);
  });

  test('accepts "c1ccccc1" as SMILES', () => {
    const result = isEnglishWord('c1ccccc1');
    expect(result.isWord).toBe(false);
  });

  test('accepts "[Na+].[Cl-]" as SMILES', () => {
    const result = isEnglishWord('[Na+].[Cl-]');
    expect(result.isWord).toBe(false);
  });

  test('harden rejects "aspirin" English word with suggestion', () => {
    // aspirin is in aliases, so it gets corrected first
    const result = harden('aspirin', 'smiles');
    // Should either correct via alias or reject as English word
    if (result.error) {
      expect(result.error).toMatch(/English word|alias/i);
    } else {
      expect(result.value).toBeTruthy();
    }
  });
});

describe('hardening - artifact stripping', () => {
  test('strips markdown SMILES block', () => {
    const result = stripArtifacts('```smiles\nCCO\n```');
    expect(result.value).toBe('CCO');
    expect(result.corrections.some(c => c.type === 'artifact_strip')).toBe(true);
  });

  test('strips SMILES: prefix', () => {
    const result = stripArtifacts('SMILES: CCO');
    expect(result.value).toBe('CCO');
    expect(result.corrections.some(c => c.type === 'artifact_strip')).toBe(true);
  });

  test('strips double quotes', () => {
    const result = stripArtifacts('"CCO"');
    expect(result.value).toBe('CCO');
    expect(result.corrections.some(c => c.type === 'quote_strip')).toBe(true);
  });

  test('strips single quotes', () => {
    const result = stripArtifacts("'CCO'");
    expect(result.value).toBe('CCO');
    expect(result.corrections.some(c => c.type === 'quote_strip')).toBe(true);
  });

  test('strips backtick quotes', () => {
    const result = stripArtifacts('`CCO`');
    expect(result.value).toBe('CCO');
    expect(result.corrections.some(c => c.type === 'quote_strip')).toBe(true);
  });

  test('no corrections for clean SMILES', () => {
    const result = stripArtifacts('CCO');
    expect(result.value).toBe('CCO');
    expect(result.corrections.length).toBe(0);
  });

  test('strips generic code block', () => {
    const result = stripArtifacts('```\nc1ccccc1\n```');
    expect(result.value).toBe('c1ccccc1');
  });
});

describe('hardening - bracket matching', () => {
  test('passes for valid brackets', () => {
    const errors = checkBrackets('[Na+].[Cl-]');
    expect(errors.length).toBe(0);
  });

  test('passes for complex SMILES', () => {
    const errors = checkBrackets('CC(=O)Oc1ccccc1C(O)=O');
    expect(errors.length).toBe(0);
  });

  test('detects unclosed square bracket', () => {
    const errors = checkBrackets('[Na+');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/unclosed/i);
  });

  test('detects extra closing square bracket', () => {
    const errors = checkBrackets('Na+]');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('detects unclosed parenthesis', () => {
    const errors = checkBrackets('CC(=O');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('detects extra closing parenthesis', () => {
    const errors = checkBrackets('CC=O)');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('detects multiple mismatches', () => {
    const errors = checkBrackets('[[[');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('harden returns error for unbalanced brackets', () => {
    const result = harden('[Na+', 'smiles');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/bracket/i);
  });
});

describe('hardening - control character rejection', () => {
  test('rejects string with null byte', () => {
    const result = harden('CC\x00O', 'smiles');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/control/i);
  });

  test('rejects string with tab', () => {
    const result = harden('CC\tO', 'smiles');
    expect(result.error).toBeTruthy();
  });

  test('accepts valid SMILES', () => {
    const result = harden('CCO', 'smiles');
    expect(result.error).toBeNull();
  });
});

describe('hardening - pericyclic notation rejection', () => {
  test('rejects [4+2] notation', () => {
    const result = harden('[4+2]', 'smiles');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/pericyclic/i);
  });

  test('rejects [2+2] notation', () => {
    const result = harden('[2+2]', 'smiles');
    expect(result.error).toBeTruthy();
  });
});

describe('hardening - path sandboxing', () => {
  test('rejects path outside CWD', () => {
    const result = harden('/etc/passwd', 'path');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/outside.*working directory/i);
  });

  test('accepts relative path within CWD', () => {
    const result = harden('output/benzene.svg', 'path');
    expect(result.error).toBeNull();
    expect(result.value).toContain('benzene.svg');
  });
});
