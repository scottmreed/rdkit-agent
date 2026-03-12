'use strict';

const { formatOutput, toCSV, toTSV, toNDJSON, toText, filterFields } = require('../../src/output');

describe('output - JSON format', () => {
  test('formats object as JSON', () => {
    const data = { key: 'value', num: 42 };
    const output = formatOutput(data, { format: 'json' });
    expect(output).toBe(JSON.stringify(data, null, 2));
  });

  test('formats array as JSON', () => {
    const data = [{ a: 1 }, { a: 2 }];
    const output = formatOutput(data, { format: 'json' });
    expect(output).toContain('"a": 1');
    expect(output).toContain('"a": 2');
  });
});

describe('output - CSV format', () => {
  test('converts array of objects to CSV', () => {
    const data = [
      { name: 'benzene', mw: 78.11 },
      { name: 'toluene', mw: 92.14 }
    ];
    const csv = toCSV(data);
    expect(csv).toContain('name,mw');
    expect(csv).toContain('benzene,78.11');
    expect(csv).toContain('toluene,92.14');
  });

  test('wraps values with commas in quotes', () => {
    const data = [{ name: 'a,b', val: 1 }];
    const csv = toCSV(data);
    expect(csv).toContain('"a,b"');
  });

  test('escapes double quotes in values', () => {
    const data = [{ name: 'a"b', val: 1 }];
    const csv = toCSV(data);
    expect(csv).toContain('""');
  });

  test('handles empty array', () => {
    const csv = toCSV([]);
    expect(csv).toBe('');
  });

  test('formats with formatOutput', () => {
    const data = [{ smiles: 'CCO', MW: 46.07 }];
    const output = formatOutput(data, { format: 'csv' });
    expect(output).toContain('smiles,MW');
    expect(output).toContain('CCO,46.07');
  });

  test('respects fields option', () => {
    const data = [{ smiles: 'CCO', MW: 46.07, logP: -0.14 }];
    const output = formatOutput(data, { format: 'csv', fields: ['smiles', 'MW'] });
    expect(output).toContain('smiles,MW');
    expect(output).not.toContain('logP');
  });
});

describe('output - TSV format', () => {
  test('converts array of objects to TSV', () => {
    const data = [
      { name: 'benzene', mw: 78.11 }
    ];
    const tsv = toTSV(data);
    expect(tsv).toContain('name\tmw');
    expect(tsv).toContain('benzene\t78.11');
  });

  test('replaces tabs in values', () => {
    const data = [{ name: 'a\tb', val: 1 }];
    const tsv = toTSV(data);
    // Tab in value should be replaced with space
    expect(tsv.split('\n')[1]).not.toContain('\t\t');
  });
});

describe('output - NDJSON format', () => {
  test('converts array to NDJSON', () => {
    const data = [{ a: 1 }, { a: 2 }];
    const ndjson = toNDJSON(data);
    const lines = ndjson.split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ a: 2 });
  });

  test('converts single object to NDJSON', () => {
    const data = { a: 1 };
    const ndjson = toNDJSON(data);
    expect(JSON.parse(ndjson)).toEqual({ a: 1 });
  });

  test('formats with formatOutput', () => {
    const data = [{ smiles: 'CCO' }, { smiles: 'c1ccccc1' }];
    const output = formatOutput(data, { format: 'ndjson' });
    const lines = output.split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).smiles).toBe('CCO');
  });
});

describe('output - text format', () => {
  test('renders object as text', () => {
    const data = { name: 'benzene', mw: 78.11 };
    const text = toText(data);
    expect(text).toContain('name');
    expect(text).toContain('benzene');
    expect(text).toContain('mw');
    expect(text).toContain('78.11');
  });

  test('renders null as "null"', () => {
    const text = toText(null);
    expect(text).toContain('null');
  });

  test('renders empty array', () => {
    const text = toText([]);
    expect(text).toContain('empty');
  });

  test('renders nested objects', () => {
    const data = { outer: { inner: 'value' } };
    const text = toText(data);
    expect(text).toContain('outer');
    expect(text).toContain('inner');
    expect(text).toContain('value');
  });
});

describe('output - field filtering', () => {
  test('filters single object fields', () => {
    const data = { a: 1, b: 2, c: 3 };
    const filtered = filterFields(data, ['a', 'c']);
    expect(filtered).toEqual({ a: 1, c: 3 });
    expect(filtered.b).toBeUndefined();
  });

  test('filters array of objects', () => {
    const data = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
    const filtered = filterFields(data, ['a']);
    expect(filtered[0]).toEqual({ a: 1 });
    expect(filtered[1]).toEqual({ a: 3 });
  });

  test('returns data unchanged when no fields specified', () => {
    const data = { a: 1, b: 2 };
    const filtered = filterFields(data, null);
    expect(filtered).toEqual(data);
  });

  test('returns data unchanged when empty fields', () => {
    const data = { a: 1, b: 2 };
    const filtered = filterFields(data, []);
    expect(filtered).toEqual(data);
  });
});

describe('output - limit option', () => {
  test('limits array results', () => {
    const data = [1, 2, 3, 4, 5];
    const output = formatOutput(data, { format: 'json', limit: 3 });
    const parsed = JSON.parse(output);
    expect(parsed.length).toBe(3);
  });

  test('no limit for non-array', () => {
    const data = { a: 1 };
    const output = formatOutput(data, { format: 'json', limit: 1 });
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(data);
  });
});
