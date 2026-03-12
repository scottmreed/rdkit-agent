# rdkit_cli

Agent-first cheminformatics CLI powered by RDKit WASM. Validates, converts, and analyzes chemical notation (SMILES, SMIRKS, InChI) with structured JSON output. Works as a CLI, Node.js library, and MCP server.

## Installation

```bash
npm install -g rdkit_cli
```

Requires Node.js ≥ 16. No native build steps — RDKit runs as WebAssembly.

## Quick Start

```bash
# Validate a SMILES string
rdkit_cli check --smiles "c1ccccc1"

# Compute molecular descriptors
rdkit_cli descriptors --smiles "CCO"

# Convert SMILES to InChI
rdkit_cli convert --from smiles --to inchi --input "CCO"

# Find similar molecules
rdkit_cli similarity --query "c1ccccc1" --targets "Cc1ccccc1,CCO,c1ccc2ccccc2c1" --threshold 0.5
```

Output is JSON when stdout is not a terminal (piped/redirected). Pass `--output json` to force it.

## Commands

| Command | Description |
|---------|-------------|
| `check` | Pre-flight validation for SMILES, SMIRKS, and reaction balance |
| `repair-smiles` | Deterministically repair/reconstruct malformed SMILES into valid canonical guesses |
| `convert` | Convert between SMILES, InChI, InChIKey, MOL, SDF |
| `descriptors` | Compute MW, logP, TPSA, HBD, HBA, rotatable bonds, rings |
| `balance` | Check atom balance for reactions |
| `fg` | Detect functional groups (tiered consuming SMARTS catalog) |
| `subsearch` | SMARTS substructure search |
| `fingerprint` | Generate Morgan or topological fingerprints |
| `similarity` | Tanimoto similarity search |
| `scaffold` | Extract Murcko scaffold |
| `filter` | Filter molecules by descriptor ranges (Lipinski Ro5, etc.) |
| `draw` | Render molecule to SVG |
| `stats` | Dataset statistics across descriptors |
| `edit` | Molecular transformations (neutralize, sanitize, add-h, etc.) |
| `rings` | Ring analysis (count, aromaticity, spiro atoms) |
| `schema` | Inspect JSON schemas for any command |
| `mcp` | Start MCP stdio server |
| `version` | Show version info |

### Common flags

```bash
--json '{"smiles":"CCO"}'   # Pass arguments as JSON object
--json -                    # Read JSON from stdin
--fields "MW,logP"          # Limit output to specific fields
--output json               # Force JSON output
```

### check

```bash
rdkit_cli check --smiles "CCO"
rdkit_cli check --smiles "H2O"          # → corrects alias to "O"
rdkit_cli check --smirks "[C:1][OH]>>[C:1]=O"
rdkit_cli check --reactants "CC,OO" --products "CCO,O"
```

Output keys: `overall_pass`, `summary`, `checks`, `failed_checks`, `fix_suggestions`, `corrected_values`

### repair-smiles

```bash
rdkit_cli repair-smiles --input "C1CC"                   # ring-closure repair
rdkit_cli repair-smiles --input "H2O"                    # alias/formula repair
rdkit_cli repair-smiles --json '{"molecules":["C1CC","Na+"]}'
```

Output keys: `success`, `canonical_smiles`, `strategy`, `confidence`, `intent`, `attempts`

### descriptors

```bash
rdkit_cli descriptors --smiles "CCO"
rdkit_cli descriptors --json '{"molecules":["CCO","c1ccccc1"]}'
rdkit_cli descriptors --smiles "CCO" --fields "MW,logP,TPSA"
```

### convert

```bash
rdkit_cli convert --from smiles --to inchi --input "CCO"
rdkit_cli convert --from smiles --to inchikey --input "c1ccccc1"
rdkit_cli convert --from smiles --to mol --input "CCO"
```

### similarity

```bash
rdkit_cli similarity --query "c1ccccc1" --targets "Cc1ccccc1,CCO" --threshold 0.5 --top 5
```

### filter

```bash
rdkit_cli filter --smiles "CCO,CC(=O)Oc1ccccc1C(O)=O" --mw-max 100 --logp-max 3
rdkit_cli filter --smiles "CCO,CC(=O)Oc1ccccc1C(O)=O" --lipinski
```

### draw

```bash
rdkit_cli draw --smiles "c1ccccc1" --output benzene.svg --format svg
rdkit_cli draw --smiles "c1ccccc1" --width 400 --height 400 --output large.svg
```

### edit

```bash
rdkit_cli edit --smiles "[NH4+].[OH-]" --operation neutralize
rdkit_cli edit --smiles "CCO" --operation add-h
rdkit_cli edit --smiles "[H]OCC" --operation remove-h
rdkit_cli edit --smiles "[CH3:1][OH:2]" --operation strip-maps
```

## Data Files

- `data/aliases.json`: Alias/formula normalization map used by hardening and validation (`H2O -> O`, `AcOH -> CC(O)=O`).
- `data/fg_patterns.json`: Curated tiered+consuming SMARTS set used by `fg` for stable, low-overlap functional-group assignment.
- `data/checkmol_smarts_part1.csv`: Broader checkmol-derived SMARTS catalog used by `repair-smiles` intent scoring (ring/chain/FG hint ranking), not by the main `fg` command.

## MCP Server (Claude Desktop)

Start the MCP stdio server to expose all commands as tools:

```bash
rdkit_cli mcp
```

Add to your Claude Desktop `claude_desktop_config.json`:

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

## Node.js API

```javascript
const { check, descriptors, convert, similarity, RDKIT_TOOLS, handleToolCall } = require('rdkit_cli');

// Always validate before using chemistry strings
const result = await check({ smiles: 'CCO' });
if (!result.overall_pass) {
  console.error(result.fix_suggestions);
}

// Compute descriptors
const desc = await descriptors({ smiles: 'CCO' });
console.log(desc.MW, desc.logP);

// Convert format
const inchi = await convert({ input: 'CCO', from: 'smiles', to: 'inchi' });

// Similarity search
const hits = await similarity({
  query: 'c1ccccc1',
  targets: ['Cc1ccccc1', 'CCO', 'c1ccc2ccccc2c1'],
  threshold: 0.5
});
```

### OpenAI Tool Integration

```javascript
const { RDKIT_TOOLS, handleToolCall } = require('rdkit_cli');

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  tools: RDKIT_TOOLS,
  messages: [{ role: 'user', content: 'Is CCO a valid SMILES?' }]
});

for (const toolCall of response.choices[0].message.tool_calls ?? []) {
  const result = await handleToolCall(
    toolCall.function.name,
    JSON.parse(toolCall.function.arguments)
  );
  // result is JSON-serializable
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation failure (`overall_pass = false`) |
| 2 | Usage error (bad arguments, missing input) |
| 3 | RDKit error (WASM not loaded, molecule parse failure) |

## Agent Use (SKILL.md)

For use with AI agents (Claude, GPT, etc.), see [SKILL.md](./SKILL.md) which ships with the package. It documents critical invariants, error patterns, and all command schemas in agent-optimized format.

## License

MIT
