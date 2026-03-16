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
| `draw` | Render molecule to SVG/PNG with optional atom/bond highlighting |
| `stats` | Dataset statistics across descriptors |
| `edit` | Molecular transformations (neutralize, sanitize, add-h, etc.) |
| `rings` | Ring analysis (count, aromaticity, spiro atoms) |
| `react` | Apply a reaction SMIRKS to reactant SMILES → product SMILES |
| `stereo` | Stereocentre analysis (tetrahedral + E/Z, CIP codes, specified vs unspecified) |
| `tautomers` | Enumerate tautomers *(see WASM Limitations)* |
| `atom-map` | Atom mapping: `add` / `remove` / `check` / `list` sub-commands |
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

# Highlight atoms 0 and 1 in red, atom 3 in blue
rdkit_cli draw --smiles "c1ccccc1" \
  --highlight-atoms '{"0":"#ff0000","1":"#ff0000","3":"#0000ff"}' \
  --highlight-radius 0.4

# Highlight bond 1 in green
rdkit_cli draw --smiles "c1ccccc1" \
  --highlight-bonds '{"1":"#00ff00"}'
```

`--highlight-atoms` and `--highlight-bonds` accept JSON objects mapping index (string) → CSS hex colour. `--highlight-radius` sets the highlight circle size (default 0.3).

### edit

```bash
rdkit_cli edit --smiles "[NH4+].[OH-]" --operation neutralize
rdkit_cli edit --smiles "CCO" --operation add-h
rdkit_cli edit --smiles "[H]OCC" --operation remove-h
rdkit_cli edit --smiles "[CH3:1][OH:2]" --operation strip-maps
```

### react

Apply a reaction SMIRKS to one or more reactant SMILES and receive the product SMILES.

```bash
rdkit_cli react --smirks "[C:1][OH]>>[C:1]Br" --reactants "CCO,CCCO"
# → { "reaction": "...", "reactant_count": 2, "products": [["CCBr"], ["CCCBr"]] }
```

Reactants can be comma-separated or space-separated (positional args after the flags).

> **WASM note**: requires `get_rxn` / `run_reactants` in the WASM build. If those are absent a `NOT_SUPPORTED_IN_WASM` error is thrown — see [WASM Limitations](#wasm-limitations).

Programmatic:
```javascript
const { reactionApply } = require('rdkit_cli');
const result = await reactionApply({ smirks: '[C:1][OH]>>[C:1]Br', reactants: ['CCO', 'CCCO'] });
```

### stereo

Analyse stereocentres in a molecule. Reports tetrahedral and E/Z stereocentres with specified/unspecified status and CIP codes when available.

```bash
rdkit_cli stereo --smiles "CC(O)C(N)C"
# → { stereo_centers: [...], stereo_center_count: 2, specified_count: 0, has_unspecified_stereo: true }

rdkit_cli stereo --smiles "OC1=CC=CC=C1,CC(F)Cl"  # comma-separated batch
```

The `--enumerate` flag will attempt to list all stereo isomers. This requires `enumerate_stereocenters` in the WASM build — see [WASM Limitations](#wasm-limitations).

Programmatic:
```javascript
const { analyzeStereo } = require('rdkit_cli');
const result = await analyzeStereo('CC(O)C(N)C');
```

### tautomers

Enumerate tautomers of a molecule.

```bash
rdkit_cli tautomers --smiles "OC1=CC=CC=C1" --limit 10
# → { input_smiles: "...", canonical_tautomer: "Oc1ccccc1", tautomers: [...], count: 3 }
```

> **WASM note**: `TautomerEnumerator` is **not** available in the standard RDKit WASM build. A `NOT_SUPPORTED_IN_WASM` error will be thrown — see [WASM Limitations](#wasm-limitations).

Programmatic:
```javascript
const { enumerateTautomers } = require('rdkit_cli');
const result = await enumerateTautomers({ smiles: 'OC1=CC=CC=C1', limit: 10 });
```

### atom-map

Manage atom mapping numbers in SMILES and SMIRKS.

```bash
# List atom_index → map_number
rdkit_cli atom-map list --smiles "[CH3:1][CH2:2][OH:3]"
# → { atom_maps: { "0": 1, "1": 2, "2": 3 }, mapped_atom_count: 3 }

# Add sequential map numbers to all heavy atoms
rdkit_cli atom-map add --smiles "CCO"
# → { mapped_smiles: "[CH3:1][CH2:2][OH:3]" }

# Strip all map numbers
rdkit_cli atom-map remove --smiles "[CH3:1][CH2:2][OH:3]"
# → { canonical_smiles: "CCO" }

# Validate SMIRKS mapping balance
rdkit_cli atom-map check --smirks "[C:1][OH:2]>>[C:1]Br"
# → { valid: true, mapped_atoms: 1, unmapped_atoms: 1, balanced: false, ... }
```

Programmatic:
```javascript
const { atomMapList, atomMapAdd, atomMapRemove, atomMapCheck } = require('rdkit_cli');
```

## WASM Limitations

Some RDKit features are **not** available in the WebAssembly build (`@rdkit/rdkit`). When these are called, a structured error with `code: "NOT_SUPPORTED_IN_WASM"` is thrown instead of silently failing.

| Feature | Status | Python alternative |
|---------|--------|-------------------|
| Reaction application (`react`) | **Available** in @rdkit/rdkit ≥ 2022.03 via `get_rxn` | `AllChem.RunReactants` |
| Stereo enumeration (`stereo --enumerate`) | **Not available** in standard builds | `EnumerateStereoisomers.EnumerateStereoisomers` |
| Tautomer enumeration (`tautomers`) | **Not available** in standard builds | `rdMolStandardize.TautomerEnumerator` |

To use these features in Python:
```python
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem.MolStandardize import rdMolStandardize
from rdkit.Chem.EnumerateStereoisomers import EnumerateStereoisomers

# Reactions
rxn = AllChem.ReactionFromSmarts('[C:1][OH]>>[C:1]Br')
products = rxn.RunReactants((Chem.MolFromSmiles('CCO'),))

# Tautomers
te = rdMolStandardize.TautomerEnumerator()
tautomers = te.Enumerate(Chem.MolFromSmiles('OC1=CC=CC=C1'))

# Stereo enumeration
isomers = list(EnumerateStereoisomers(Chem.MolFromSmiles('CC(O)C(N)C')))
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
