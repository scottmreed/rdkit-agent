'use strict';

/**
 * Unit tests for src/mcp/server.js — structural/export checks only.
 * No RDKit WASM required.
 */

const { MCP_TOOLS, dispatchMcpTool } = require('../../src/mcp/server');

describe('MCP_TOOLS definitions', () => {
  it('exports MCP_TOOLS as a non-empty array', () => {
    expect(Array.isArray(MCP_TOOLS)).toBe(true);
    expect(MCP_TOOLS.length).toBeGreaterThan(0);
  });

  it('every MCP tool has a name, description, and inputSchema', () => {
    for (const tool of MCP_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('includes expected core tools', () => {
    const names = MCP_TOOLS.map(t => t.name);
    expect(names).toContain('check_chemistry');
    expect(names).toContain('convert_molecule');
    expect(names).toContain('compute_descriptors');
    expect(names).toContain('repair_smiles');
    expect(names).toContain('similarity_search');
    expect(names).toContain('substructure_search');
  });

  it('all tool names are unique', () => {
    const names = MCP_TOOLS.map(t => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe('dispatchMcpTool', () => {
  it('exports dispatchMcpTool as a function', () => {
    expect(typeof dispatchMcpTool).toBe('function');
  });

  it('throws for unknown tool names', async () => {
    await expect(dispatchMcpTool('nonexistent_tool', {})).rejects.toThrow(/unknown tool/i);
  });
});
