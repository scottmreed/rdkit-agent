'use strict';

/**
 * Unit tests for src/tools/index.js — structural/export checks only.
 * No RDKit WASM required.
 */

const {
  CHECK_CHEMISTRY_TOOL,
  RDKIT_TOOLS,
  handleCheckToolCall,
  handleToolCall
} = require('../../src/tools');

describe('RDKIT_TOOLS exports', () => {
  it('exports CHECK_CHEMISTRY_TOOL as an OpenAI function tool', () => {
    expect(CHECK_CHEMISTRY_TOOL).toBeDefined();
    expect(CHECK_CHEMISTRY_TOOL.type).toBe('function');
    expect(CHECK_CHEMISTRY_TOOL.function.name).toBe('check_chemistry');
    expect(CHECK_CHEMISTRY_TOOL.function.parameters).toBeDefined();
    expect(CHECK_CHEMISTRY_TOOL.function.parameters.type).toBe('object');
  });

  it('exports RDKIT_TOOLS as a non-empty array', () => {
    expect(Array.isArray(RDKIT_TOOLS)).toBe(true);
    expect(RDKIT_TOOLS.length).toBeGreaterThan(0);
  });

  it('every tool in RDKIT_TOOLS has required OpenAI fields', () => {
    for (const tool of RDKIT_TOOLS) {
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.parameters).toBeDefined();
    }
  });

  it('RDKIT_TOOLS includes check_chemistry, convert_molecule, compute_descriptors, repair_smiles', () => {
    const names = RDKIT_TOOLS.map(t => t.function.name);
    expect(names).toContain('check_chemistry');
    expect(names).toContain('convert_molecule');
    expect(names).toContain('compute_descriptors');
    expect(names).toContain('repair_smiles');
  });

  it('exports handleCheckToolCall as a function', () => {
    expect(typeof handleCheckToolCall).toBe('function');
  });

  it('exports handleToolCall as a function', () => {
    expect(typeof handleToolCall).toBe('function');
  });
});

describe('handleToolCall dispatch', () => {
  it('returns an error object for unknown tool names', async () => {
    const result = await handleToolCall('nonexistent_tool', {});
    expect(result).toHaveProperty('error');
    expect(result.error).toMatch(/unknown tool/i);
  });
});
