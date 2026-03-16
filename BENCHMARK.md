# rdkit_cli Benchmark Results

**Date:** 2026-03-16T03:10:49.147Z
**Node:** v22.20.0
**Runs per scenario:** 3

---

## Cold Run (new process each time)

Command: `rdkit_cli descriptors --smiles CCO --output json`
Includes Node.js startup + WASM initialisation + command execution.

| Metric | Value |
|--------|-------|
| Mean | 110 ms |
| Median | 108 ms |
| Min | 106 ms |
| Max | 116 ms |

Individual runs: 116 ms, 106 ms, 108 ms

---

## WASM Initialisation Only

Time for `getRDKit()` in a fresh child process (no command overhead).

| Metric | Value |
|--------|-------|
| Mean | 24 ms |
| Median | 24 ms |
| Min | 24 ms |
| Max | 25 ms |

Individual runs: 24 ms, 24 ms, 25 ms

---

## In-Process Runs (Node.js API — `descriptors` baseline)

| Run | Time | Notes |
|-----|------|-------|
| Run 1 | 79 ms | cold WASM – first `getRDKit()` call |
| Run 2 | 1 ms | warm – WASM already cached |
| Run 3 | 1 ms | warm – WASM already cached |

> Run 1 includes WASM initialisation. Runs 2+ reuse the cached module.
> The ~24 ms init cost is paid **once per process** regardless of which
> command is called first. Every subsequent `await getRDKit()` resolves immediately
> from the module-level singleton in `src/wasm.js`.

---

## New Commands — Warm WASM (in-process)

All measurements below are taken **after** WASM is already initialised.
The WASM init problem — every command paying ~24 ms on first call — is handled
by the singleton in `src/wasm.js`: once `getRDKit()` resolves the first time, every
subsequent call returns the cached instance without re-initialising.

| Command | Mean | Min | Max | Notes |
|---------|------|-----|-----|-------|
| react | 4 ms | 1 ms | 8 ms | 10 reactants, MolList + run_reactants |
| stereo | 7 ms | 6 ms | 9 ms | 10 molecules, mol JSON + descriptors |
| draw (highlights) | 6 ms | 2 ms | 13 ms | get_svg_with_highlights, atomColours + bondColours |
| draw (no highlights) | 1 ms | 1 ms | 1 ms | get_svg_with_highlights baseline |
| atom-map add | 1 ms | 0 ms | 4 ms | molblock parse + reload |
| atom-map remove | 0 ms | 0 ms | 0 ms | molblock parse + reload |
| atom-map list | 0 ms | 0 ms | 0 ms | molblock parse + reload |
| atom-map check | 0 ms | 0 ms | 0 ms | molblock parse + reload |
| tautomers (error path) | 0 ms | 0 ms | 0 ms | NOT_SUPPORTED_IN_WASM — fast capability check |

### draw highlights overhead

| Variant | Mean |
|---------|------|
| No highlights | 1 ms |
| With highlights | 6 ms |
| Delta | 5 ms |

---

## Similarity — Parallel Target Processing

Query: `c1ccccc1` vs 50 targets (warm WASM, in-process).

| Metric | Value |
|--------|-------|
| Mean | 12.7 ms |
| Median | 11.6 ms |
| Min | 11.0 ms |
| Max | 15.4 ms |
| Per target (avg) | 0.25 ms |

Individual runs: 15.4 ms, 11.6 ms, 11.0 ms

---

## Latency Breakdown (estimates)

| Component | Estimate |
|-----------|----------|
| Node.js startup | ~86 ms |
| RDKit WASM init | ~24 ms |
| Per-command work (warm) | ~1 ms |
| Total cold CLI latency | ~110 ms |

---

## WASM Init Problem & Solution

### The problem

Every chemistry command calls `await getRDKit()` at its start.  On the first call
in a process that cost is ~24 ms — WASM module load + memory setup.
Before the optimisations documented below, this meant the first call to *any* command
(old or new) paid the full init cost, even for trivial operations.

### The solution: module-level singleton (all commands)

`src/wasm.js` maintains a process-level singleton:

```js
let rdkitInstance = null;
let rdkitLoading  = null;   // in-flight Promise, shared across concurrent callers

async function getRDKit() {
  if (rdkitInstance) return rdkitInstance;  // ← O(1) after first call
  if (rdkitLoading)  return rdkitLoading;   // ← concurrent callers share one init
  rdkitLoading = (async () => { ... })();
  return rdkitLoading;
}
```

After the first successful `await getRDKit()`, every subsequent call — whether from
`react`, `stereo`, `atom-map`, or any existing command — returns immediately.
The ~24 ms cost is paid **once per process**.

### CLI: background preload (`cli.js`)

In the CLI entry point, `getRDKit()` is fired immediately after the command name
is parsed, before stdin is read or args are normalised:

```js
if (!NO_RDKIT_COMMANDS.includes(commandName)) {
  require('./wasm').getRDKit().catch(() => {});  // fire and forget
}
```

WASM loading (~24 ms) overlaps with the work that was happening anyway,
so the command's own `await getRDKit()` resolves against an already-in-progress
Promise rather than starting a fresh one.

### Node.js API: pre-warm once at startup

When using rdkit_cli as a library, call any command (or `getRDKit()` directly) once
at startup.  All subsequent calls pay only the per-command cost shown above:

```js
const { getRDKit, react, stereo, atomMapAdd } = require('rdkit_cli');

// Pre-warm once — typically at app startup
await getRDKit();

// All subsequent calls are fast (warm WASM)
const products   = await react({ smirks: '[C:1][OH]>>[C:1]Br', reactants: ['CCO'] });
const stereoInfo = await stereo({ smiles: 'CC(O)C(N)C' });
const mapped     = await atomMapAdd('CCO');
```

### Daemon / persistent process

Running `rdkit_daemon` keeps the WASM module live between invocations.  Each
call pays only the per-command overhead (~~1 ms), not the
~24 ms WASM init cost.  For scripts that call the CLI in a loop this
is a 93x speed-up per invocation.

---

## Other Optimisations

### Lazy-loaded data files

| File | Size | Loaded by |
|------|------|-----------|
| `data/aliases.json` | small | any command calling `harden()` |
| `data/fg_patterns.json` | medium | `fg`, `repair-smiles` only |
| `data/checkmol_smarts_part1.csv` | large | `repair-smiles` only |

Each file is read on **first use** (result cached) rather than at `require()` time.
Commands like `react`, `stereo`, `descriptors`, or `similarity` that don't need
the FG or checkmol data do not pay that I/O cost.

### Parallel target processing

`similarity` and `subsearch` use `Promise.all` (concurrency-capped at 16).
`stereo`, `rings`, `scaffold`, `fingerprint`, and `descriptors` all batch
via `Promise.all`.  Because RDKit WASM is single-threaded, wall time scales
linearly with target count, but the pattern bounds peak memory and is consistent
across all batch-capable commands including the new ones.

### Fast `--version` (no WASM init)

`rdkit_cli --version` does not load the WASM module at all; it returns CLI +
Node.js versions from `package.json` instantly.  Use `--version --full` when
the RDKit WASM runtime version string is needed.
