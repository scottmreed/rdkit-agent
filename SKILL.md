---
name: rdkit-agent
description: Agent-first cheminformatics CLI powered by RDKit WASM for validating, converting, and analyzing chemical notation (SMILES, SMIRKS, InChI)
---

# rdkit_cli Agent Skill

## Identity

`rdkit_cli` is an agent-first cheminformatics CLI powered by RDKit WASM. It validates, converts, and analyzes chemical notation (SMILES, SMIRKS, InChI) with structured JSON output.

## Critical Invariants

### 1. ALWAYS validate before using chemistry strings

Before passing any SMILES or SMIRKS to any downstream tool, call `check_chemistry` first:

```bash
rdkit_cli check --smiles "c1ccccc1"
rdkit_cli check --smirks "[C:1][OH:2]>>[C:1]=O"
```

Or via the OpenAI tool:
```json
{
  "tool": "check_chemistry",
  "arguments": { "smiles": "c1ccccc1" }
}
```

If `overall_pass` is `false`, use `corrected_values` or `fix_suggestions` before proceeding.

### 2. Use --json flag for programmatic input

All commands accept structured JSON payloads:
```bash
rdkit_cli descriptors --json '{"molecules": ["CCO", "c1ccccc1"]}'
rdkit_cli convert --json '{"input": "CCO", "from": "smiles", "to": "inchi"}'
rdkit_cli filter --json '{"smiles": ["CCO", "CC(=O)Oc1ccccc1C(O)=O"], "mw_max": 200}'
```

Pass `-` to read from stdin:
```bash
echo '{"smiles":"CCO"}' | rdkit_cli descriptors --json -
```

### 3. Output is JSON when not TTY

When stdout is not a terminal (piped, redirected, subprocess):
- Default output format is JSON
- All results are JSON-serializable objects
- Exit codes: 0=success, 1=validation failure, 2=usage error, 3=RDKit error

When running in a terminal:
- Default output is human-readable text

Force JSON output:
```bash
rdkit_cli descriptors --smiles "CCO" --output json
```

### 4. Use --fields to limit output size

Reduce token usage by requesting only needed fields:
```bash
rdkit_cli descriptors --smiles "CCO" --fields "MW,logP,TPSA"
rdkit_cli check --smiles "CCO" --fields "overall_pass,corrected_values"
```

### 5. Use --limit for large result sets

```bash
rdkit_cli similarity --query "c1ccccc1" --targets "..." --top 5
rdkit_cli subsearch --query "[OH]" --targets "..." --limit 10
```

## Common SMILES Errors and Fixes

### Error: English word instead of SMILES
```
❌ benzene      → ✅ c1ccccc1
❌ toluene      → ✅ Cc1ccccc1
❌ aspirin      → ✅ CC(=O)Oc1ccccc1C(O)=O
❌ caffeine     → ✅ Cn1cnc2c1c(=O)n(C)c(=O)n2C
❌ ethanol      → ✅ CCO
❌ methanol     → ✅ CO
❌ acetone      → ✅ CC(C)=O
❌ glucose      → ✅ OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O
```

### Error: Molecular formula instead of SMILES
```
❌ H2O   → ✅ O
❌ CO2   → ✅ O=C=O
❌ NH3   → ✅ N
❌ CH4   → ✅ C
❌ NaCl  → ✅ [Na+].[Cl-]
❌ EtOH  → ✅ CCO (also an alias)
❌ DMSO  → ✅ CS(C)=O
❌ DMF   → ✅ CN(C)C=O
❌ THF   → ✅ C1CCOC1
❌ DCM   → ✅ ClCCl
```

### Error: Pericyclic reaction notation
```
❌ [4+2]   → This is electron-counting, not SMILES
❌ [2+2]   → Not valid SMILES
```
Electron-count notation has no SMILES equivalent. Describe the reaction in SMIRKS instead.

### Error: Unbalanced brackets
```
❌ [Na+     → ✅ [Na+]
❌ CC(=O    → ✅ CC(=O)
❌ c1cccc   → ✅ c1ccccc1  (ring not closed)
```

### Error: Bare ions without brackets
```
❌ Na   → ✅ [Na+]  or  [Na]
❌ K    → ✅ [K+]   or  [K]
❌ Cl-  → ✅ [Cl-]
```

### Error: LLM artifacts in SMILES
```
❌ "CCO"              → ✅ CCO  (quotes stripped)
❌ SMILES: CCO        → ✅ CCO  (prefix stripped)
❌ ```smiles\nCCO\n```→ ✅ CCO  (markdown block stripped)
❌ `CCO`              → ✅ CCO  (backtick stripped)
```

## Command Reference

### check - Pre-flight validation
```bash
# Validate SMILES
rdkit_cli check --smiles "CCO"

# Validate with correction reporting
rdkit_cli check --smiles "H2O"
# → corrected_values: { alias_correction: "O" }

# Validate SMIRKS
rdkit_cli check --smirks "[C:1][OH]>>[C:1]=O"

# Check reaction balance
rdkit_cli check --reactants "CC,OO" --products "CCO,O"
```

Output keys: `overall_pass`, `summary`, `checks`, `failed_checks`, `fix_suggestions`, `corrected_values`

### convert - Format conversion
```bash
rdkit_cli convert --from smiles --to inchi --input "CCO"
rdkit_cli convert --from smiles --to inchikey --input "c1ccccc1"
rdkit_cli convert --from smiles --to mol --input "CCO"
rdkit_cli convert --from smiles --to sdf --input "CCO"
```

### descriptors - Molecular properties
```bash
rdkit_cli descriptors --smiles "CCO"
# Returns: MW, logP, TPSA, HBD, HBA, rotatable_bonds, aromatic_rings, heavy_atoms
```

### balance - Reaction balance check
```bash
rdkit_cli balance --reactants "CCO,O=O" --products "CC=O,OO"
```

### fg - Functional group detection
```bash
rdkit_cli fg --smiles "CC(=O)Oc1ccccc1C(O)=O"
# Returns tiered functional-group assignments from curated SMARTS catalog
```

### repair-smiles - Malformed SMILES recovery
```bash
rdkit_cli repair-smiles --input "C1CC"
rdkit_cli repair-smiles --input "H2O"
```

### subsearch - Substructure search
```bash
rdkit_cli subsearch --query "[OH]" --targets "CCO,c1ccccc1,CC(O)=O"
rdkit_cli subsearch --query "c1ccccc1" --targets "Cc1ccccc1,CCO"
```

### fingerprint - Molecular fingerprints
```bash
rdkit_cli fingerprint --smiles "c1ccccc1" --type morgan --radius 2 --nbits 2048
```

### similarity - Tanimoto similarity
```bash
rdkit_cli similarity --query "c1ccccc1" --targets "Cc1ccccc1,CCO,c1ccc2ccccc2c1" --threshold 0.5 --top 5
```

### scaffold - Murcko scaffold
```bash
rdkit_cli scaffold --smiles "CC(=O)Oc1ccccc1C(O)=O"
```

### filter - Filter by properties
```bash
rdkit_cli filter --smiles "CCO,CC(=O)Oc1ccccc1C(O)=O" --mw-max 100 --logp-max 3
rdkit_cli filter --smiles "CCO" --lipinski  # Lipinski Ro5 filter
```

### draw - Render molecules
```bash
rdkit_cli draw --smiles "c1ccccc1" --output benzene.svg --format svg
rdkit_cli draw --smiles "c1ccccc1" --width 400 --height 400 --output large.svg
```

### stats - Dataset statistics
```bash
rdkit_cli stats --smiles "CCO,c1ccccc1,CC(=O)Oc1ccccc1C(O)=O"
# Returns: mean/median/std/min/max for each descriptor
```

### edit - Molecular transformations
```bash
rdkit_cli edit --smiles "[NH4+].[OH-]" --operation neutralize
rdkit_cli edit --smiles "[CH3:1][OH:2]" --operation strip-maps
rdkit_cli edit --smiles "CCO" --operation sanitize
rdkit_cli edit --smiles "CCO" --operation add-h
rdkit_cli edit --smiles "[H]OCC" --operation remove-h
```

### rings - Ring analysis
```bash
rdkit_cli rings --smiles "c1ccccc1"
# Returns: ring_count, aromatic_rings, saturated_rings, spiro_atoms, etc.
```

### schema - Inspect command schemas
```bash
rdkit_cli schema check
rdkit_cli schema descriptors
rdkit_cli schema list
```

### version - Version information
```bash
rdkit_cli version
```

## MCP Server Mode

Start the MCP stdio server to expose all commands as MCP tools:
```bash
rdkit_cli mcp
```

The server reads JSON-RPC 2.0 from stdin and writes responses to stdout. Add to Claude Desktop:
```json
{
  "mcpServers": {
    "rdkit_cli": {
      "command": "rdkit_cli",
      "args": ["mcp"]
    }
  }
}
```

## OpenAI Tool Integration

```javascript
const { CHECK_CHEMISTRY_TOOL, RDKIT_TOOLS, handleToolCall } = require('rdkit_cli');

// Use in OpenAI API call
const response = await openai.chat.completions.create({
  tools: RDKIT_TOOLS,
  // ...
});

// Handle tool calls
for (const toolCall of response.choices[0].message.tool_calls) {
  const result = await handleToolCall(toolCall.function.name, JSON.parse(toolCall.function.arguments));
  // ...
}
```

## Node.js API

```javascript
const { check, descriptors, convert, similarity, fg } = require('rdkit_cli');

// Pre-validate before use
const checkResult = await check({ smiles: 'CCO' });
if (!checkResult.overall_pass) {
  console.error(checkResult.fix_suggestions);
}

// Compute properties
const desc = await descriptors({ smiles: 'CCO' });
console.log(desc.MW, desc.logP);

// Find similar molecules
const sim = await similarity({
  query: 'c1ccccc1',
  targets: ['Cc1ccccc1', 'CCO', 'c1ccc2ccccc2c1'],
  threshold: 0.5
});
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation failure (overall_pass = false) |
| 2 | Usage error (bad arguments, missing input) |
| 3 | RDKit error (WASM not loaded, molecule parse failure) |
