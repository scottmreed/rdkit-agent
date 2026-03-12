'use strict';

const { FG_PATTERNS, normalizeFGPatterns } = require('../../src/commands/fg');

describe('fg pattern catalog', () => {
  test('normalizes pattern entries with tier/consume defaults', () => {
    const normalized = normalizeFGPatterns([
      { name: 'x', smarts: '[#6]' },
      { name: 'y', smarts: ['[#8]'], tier: 2, consume: false },
    ]);

    expect(normalized).toEqual([
      { name: 'x', smarts: ['[#6]'], tier: 1, consume: true },
      { name: 'y', smarts: ['[#8]'], tier: 2, consume: false },
    ]);
  });

  test('uses tiered curated catalog', () => {
    expect(Array.isArray(FG_PATTERNS)).toBe(true);
    expect(FG_PATTERNS.length).toBeGreaterThan(20);
    expect(FG_PATTERNS.some(p => p.name === 'nitro')).toBe(true);
    expect(FG_PATTERNS.some(p => p.name === 'aromatic_ring' && p.consume === false)).toBe(true);
  });

  test('removes known-bad labels from legacy set', () => {
    const names = new Set(FG_PATTERNS.map(p => p.name));
    expect(names.has('allene_oxide')).toBe(false);
    expect(names.has('pyrazine_ring')).toBe(false);
    expect(names.has('resorcinol')).toBe(false);
    expect(names.has('hydroquinone')).toBe(false);
    expect(names.has('carbene')).toBe(false);
  });
});
