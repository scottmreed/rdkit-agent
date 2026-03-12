'use strict';

const {
  parseCheckmolLine,
  loadCheckmolPatterns,
  inferIntentFromRaw,
  trimUnpairedRingDigits,
  balanceBracketAndParenClosures,
  stripNonSmilesCharacters,
  replaceRWithC,
} = require('../../src/commands/repair-smiles');

describe('repair-smiles utility helpers', () => {
  it('parses a checkmol CSV row with quoted SMARTS list', () => {
    const row = '003,carbonyl compound (aldehyde or ketone),"[C;X3](=O)[#6,H],[#6][C;X3](=O)[#6]"';
    const parsed = parseCheckmolLine(row);
    expect(parsed).toBeDefined();
    expect(parsed.id).toBe('003');
    expect(parsed.name).toMatch(/carbonyl/i);
    expect(Array.isArray(parsed.smarts)).toBe(true);
    expect(parsed.smarts.length).toBeGreaterThan(1);
  });

  it('loads multiple checkmol rows', () => {
    const csv = [
      'id,name,smarts',
      '003,carbonyl,"[C;X3](=O)[#6]"',
      '026,enol ether,"[CX3]=[CX3][OX2][#6]"',
    ].join('\n');
    const patterns = loadCheckmolPatterns(csv);
    expect(patterns.length).toBe(2);
  });

  it('infers intent hints from malformed raw text', () => {
    const intent = inferIntentFromRaw('C1CC(=O)N');
    expect(intent.expected_rings).toBe(0);
    expect(intent.estimated_atom_tokens).toBeGreaterThan(0);
    expect(intent.fg_hints).toContain('carbonyl');
    expect(intent.fg_hints).toContain('amine_like');
  });

  it('trims unpaired ring digits', () => {
    expect(trimUnpairedRingDigits('C1CC')).toBe('CCC');
    expect(trimUnpairedRingDigits('C1CC1')).toBeNull();
  });

  it('balances bracket and parenthesis closures', () => {
    expect(balanceBracketAndParenClosures('[Na+')).toBe('[Na+]');
    expect(balanceBracketAndParenClosures('CC(=O')).toBe('CC(=O)');
  });

  it('strips obvious non-SMILES characters', () => {
    expect(stripNonSmilesCharacters('SMILES: CCO')).toBe('SMILES:CCO');
  });

  it('replaces R with C for R-group placeholder, leaves Br unchanged', () => {
    expect(replaceRWithC('COOR')).toBe('COOC');
    expect(replaceRWithC('CC-1=CC=CC=C-1COOR')).toBe('CC-1=CC=CC=C-1COOC');
    expect(replaceRWithC('Br')).toBeNull();
    expect(replaceRWithC('CCO')).toBeNull();
  });
});
