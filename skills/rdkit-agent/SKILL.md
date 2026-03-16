---
name: rdkit-agent
description: Agent-first cheminformatics CLI powered by RDKit WASM for validating, converting, and analyzing chemical notation (SMILES, SMIRKS, InChI)
---

# rdkit-agent Skill

You have access to `rdkit-agent`, an agent-first cheminformatics CLI powered by RDKit compiled to WebAssembly. Use it whenever you need to validate, convert, or analyze chemical notation (SMILES, SMIRKS, InChI).

## Why use this instead of Python rdkit

- **~1 ms per call** (warm) vs 200–500 ms for a Python subprocess cold-start
- No Python runtime, no native build, no conda environment — pure Node.js
- WASM is initialized once per process (24 ms), then negligible overhead per call
- Structured JSON output by default when stdout is not a TTY
- All commands exit with machine-readable codes: 0=success, 1=validation failure, 2=usage error, 3=RDKit error

Cold start breakdown: ~110 ms total (Node.js startup ~85 ms + WASM init ~24 ms). Subsequent calls in the same process: ~1 ms.

## Critical Invariants

### 1. Always validate before using chemistry strings

```bash
rdkit-agent check --smiles "c1ccccc1"
rdkit-agent check --smirks "[C:1][OH:2]>>[C:1]=O"
```

If `overall_pass` is `false`, read `corrected_values` or `fix_suggestions` before proceeding. Do not pass unvalidated SMILES to downstream commands.

### 2. Use --json for programmatic input

All commands accept a JSON payload — safer than shell quoting:

```bash
rdkit-agent descriptors --json '{"molecules":["CCO","c1ccccc1"]}'
rdkit-agent convert --json '{"input":"CCO","from":"smiles","to":"inchi"}'
rdkit-agent filter --json '{"smiles":["CCO","CC(=O)Oc1ccccc1C(O)=O"],"mw_max":200}'
echo '{"smiles":"CCO"}' | rdkit-agent descriptors --json -
```

### 3. Output is auto-JSON when not TTY

When you run rdkit-agent in a subprocess or pipe, output is JSON automatically. Use `--output json` to force it from a terminal.

### 4. Limit output size

```bash
rdkit-agent descriptors --smiles "CCO" --fields "MW,logP,TPSA"
rdkit-agent similarity --query "c1ccccc1" --targets "..." --top 5
rdkit-agent subsearch --query "[OH]" --targets "..." --limit 10
```

## Command Reference

| Command | One-liner |
|---------|-----------|
| `check` | `rdkit-agent check --smiles "CCO"` |
| `repair-smiles` | `rdkit-agent repair-smiles --input "C1CC"` |
| `convert` | `rdkit-agent convert --from smiles --to inchi --input "CCO"` |
| `descriptors` | `rdkit-agent descriptors --smiles "CCO"` |
| `balance` | `rdkit-agent balance --reactants "CCO,O=O" --products "CC=O,OO"` |
| `fg` | `rdkit-agent fg --smiles "CC(=O)Oc1ccccc1C(O)=O"` |
| `subsearch` | `rdkit-agent subsearch --query "[OH]" --targets "CCO,c1ccccc1"` |
| `fingerprint` | `rdkit-agent fingerprint --smiles "c1ccccc1" --type morgan --radius 2` |
| `similarity` | `rdkit-agent similarity --query "c1ccccc1" --targets "Cc1ccccc1,CCO" --threshold 0.5` |
| `scaffold` | `rdkit-agent scaffold --smiles "CC(=O)Oc1ccccc1C(O)=O"` |
| `filter` | `rdkit-agent filter --smiles "CCO,CC(=O)Oc1ccccc1C(O)=O" --lipinski` |
| `draw` | `rdkit-agent draw --smiles "c1ccccc1" --output benzene.svg --format svg` |
| `stats` | `rdkit-agent stats --smiles "CCO,c1ccccc1,CC(=O)Oc1ccccc1C(O)=O"` |
| `edit` | `rdkit-agent edit --smiles "[NH4+].[OH-]" --operation neutralize` |
| `rings` | `rdkit-agent rings --smiles "c1ccccc1"` |
| `react` | `rdkit-agent react --smirks "[C:1][OH]>>[C:1]Br" --reactants "CCO"` |
| `stereo` | `rdkit-agent stereo --smiles "CC(O)C(N)C"` |
| `tautomers` | `rdkit-agent tautomers --smiles "OC1=CC=CC=C1" --limit 10"` |
| `atom-map` | `rdkit-agent atom-map add --smiles "CCO"` |
| `schema` | `rdkit-agent schema check` |
| `mcp` | `rdkit-agent mcp` (starts MCP stdio server) |
| `version` | `rdkit-agent version` |

## Common SMILES Errors to Avoid

### English name instead of SMILES
```
❌ benzene   → ✅ c1ccccc1
❌ toluene   → ✅ Cc1ccccc1
❌ aspirin   → ✅ CC(=O)Oc1ccccc1C(O)=O
❌ ethanol   → ✅ CCO
❌ caffeine  → ✅ Cn1cnc2c1c(=O)n(C)c(=O)n2C
```

### Molecular formula instead of SMILES
```
❌ H2O  → ✅ O
❌ CO2  → ✅ O=C=O
❌ NH3  → ✅ N
❌ NaCl → ✅ [Na+].[Cl-]
❌ DMSO → ✅ CS(C)=O
❌ DMF  → ✅ CN(C)C=O
❌ THF  → ✅ C1CCOC1
```

### LLM-generated artifacts
```
❌ "CCO"            → ✅ CCO   (strip quotes)
❌ SMILES: CCO      → ✅ CCO   (strip prefix)
❌ ```smiles\nCCO```→ ✅ CCO   (strip markdown)
❌ `CCO`            → ✅ CCO   (strip backticks)
```

### Structural errors
```
❌ [Na+          → ✅ [Na+]       (unclosed bracket)
❌ CC(=O         → ✅ CC(=O)      (unclosed branch)
❌ c1cccc        → ✅ c1ccccc1    (unclosed ring)
❌ Na            → ✅ [Na+]       (bare metal)
❌ Cl-           → ✅ [Cl-]       (bare ion)
```

Use `rdkit-agent repair-smiles` to attempt automatic recovery.

## WASM Limitations

Two features are unavailable in the standard `@rdkit/rdkit` WASM build. Both return a structured error with `code: "NOT_SUPPORTED_IN_WASM"` rather than silently failing:

| Feature | Status |
|---------|--------|
| `tautomers` | Not available — use Python `rdMolStandardize.TautomerEnumerator` |
| `stereo --enumerate` | Not available — use Python `EnumerateStereoisomers` |
| `react` | Available in `@rdkit/rdkit >= 2022.03` |

## MCP Server Mode

To expose all commands as MCP tools for Claude Desktop:

```bash
rdkit-agent mcp
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rdkit-agent": {
      "command": "rdkit-agent",
      "args": ["mcp"]
    }
  }
}
```

## Node.js API

```javascript
const { check, descriptors, convert, similarity, RDKIT_TOOLS, handleToolCall } = require('rdkit-agent');

const valid = await check({ smiles: 'CCO' });
if (!valid.overall_pass) throw new Error(valid.fix_suggestions.join(', '));

const desc = await descriptors({ smiles: 'CCO' });
// { MW: 46.07, logP: -0.18, TPSA: 20.23, ... }
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation failure (`overall_pass = false`) |
| 2 | Usage error (bad arguments, missing input) |
| 3 | RDKit error (WASM not loaded, molecule parse failure) |
