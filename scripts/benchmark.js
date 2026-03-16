#!/usr/bin/env node
'use strict';

/**
 * rdkit_cli latency benchmark
 *
 * Measures:
 *   cold         – spawn a new Node.js process each time (Node startup + WASM init + command)
 *   wasm-init    – time only getRDKit() in a fresh child process
 *   in-process   – first call includes WASM init; subsequent calls show warm cost
 *   new-commands – react / stereo / draw-highlights / atom-map / tautomers(error path)
 *                  ALL measured warm (WASM pre-loaded once before the suite)
 *   similarity   – parallel Promise.all throughput over 50 targets
 *
 * WASM init problem & solution
 * ----------------------------
 * getRDKit() initialises the WASM module on first call (~400–800 ms on typical hardware).
 * That cost is paid exactly once per process thanks to the singleton in wasm.js:
 *
 *   let rdkitInstance = null;
 *   async function getRDKit() {
 *     if (rdkitInstance) return rdkitInstance;   // ← free after first call
 *     ...
 *   }
 *
 * Every command – old and new – calls `await getRDKit()` at its start.
 * After the first call resolves, all subsequent awaits return the cached instance
 * synchronously (Promise.resolve(rdkitInstance)).
 *
 * In CLI mode, cli.js fires a background getRDKit() immediately after parsing
 * the command name, so WASM loading overlaps with stdin/arg normalisation.
 *
 * In the Node.js API, callers that need low latency should call
 * `await getRDKit()` (or any command) once at startup.  The new-commands
 * section below pre-warms WASM first and then measures only the per-command cost.
 *
 * Usage:
 *   node scripts/benchmark.js [--runs N]   (default N=5)
 *
 * Writes results to BENCHMARK.md in the project root.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const CLI_BIN = path.join(ROOT, 'bin', 'rdkit_cli.js');
const WASM_JS = path.join(ROOT, 'src', 'wasm.js');

const SMILES_ETHANOL = 'CCO';
const COMMAND_ARGS = ['descriptors', '--smiles', SMILES_ETHANOL, '--output', 'json'];

const argv = require('minimist')(process.argv.slice(2));
const RUNS = parseInt(argv.runs, 10) || 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hrMs(hr) {
  return (hr[0] * 1e9 + hr[1]) / 1e6;
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    mean: +mean.toFixed(2),
    median: +s[Math.floor(s.length / 2)].toFixed(2),
    min: +s[0].toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    raw: arr.map(v => +v.toFixed(2))
  };
}

function fmtMs(ms) { return ms.toFixed(0) + ' ms'; }

// ---------------------------------------------------------------------------
// Cold run: spawn a fresh Node process each time
// ---------------------------------------------------------------------------

function coldRun(n) {
  console.log(`  Cold run ×${n} …`);
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    spawnSync(process.execPath, [CLI_BIN, ...COMMAND_ARGS], {
      encoding: 'utf8',
      env: { ...process.env, RDKIT_SUPPRESS_WARNINGS: '1' }
    });
    times.push(hrMs(process.hrtime(t0)));
    process.stdout.write(`    run ${i + 1}: ${times[times.length - 1].toFixed(0)} ms\n`);
  }
  return stats(times);
}

// ---------------------------------------------------------------------------
// WASM init only: spawn a child that times just getRDKit()
// ---------------------------------------------------------------------------

function wasmInitRun(n) {
  console.log(`  WASM init-only ×${n} …`);
  const times = [];
  const script = `
    const { getRDKit } = require(${JSON.stringify(WASM_JS)});
    const t = process.hrtime();
    getRDKit().then(() => {
      const d = process.hrtime(t);
      process.stdout.write(String((d[0]*1e9+d[1])/1e6) + '\\n');
    }).catch(e => { process.stderr.write(e.message); process.exit(1); });
  `;
  for (let i = 0; i < n; i++) {
    const r = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, RDKIT_SUPPRESS_WARNINGS: '1' }
    });
    if (r.status !== 0) throw new Error('WASM init child failed: ' + r.stderr);
    const ms = parseFloat(r.stdout.trim());
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(0)} ms\n`);
  }
  return stats(times);
}

// ---------------------------------------------------------------------------
// In-process: call descriptors directly (baseline – old command, shows warm vs cold)
// ---------------------------------------------------------------------------

async function inProcessRuns(n) {
  console.log(`  In-process ×${n} …`);
  const { descriptors } = require('../src/commands/descriptors');

  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await descriptors({ smiles: SMILES_ETHANOL });
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    const label = i === 0 ? '(includes WASM init)' : '(WASM cached)';
    process.stdout.write(`    run ${i + 1} ${label}: ${ms.toFixed(0)} ms\n`);
  }

  return {
    run1: { label: 'run 1 – cold WASM (in-process)', ms: +times[0].toFixed(2) },
    warm: stats(times.slice(1))
  };
}

// ---------------------------------------------------------------------------
// New commands — all measured WARM (WASM pre-loaded before this section runs)
//
// Pre-warming is done in main() via `await getRDKit()` before calling any of
// these functions, so the WASM singleton is already resolved.  Each function
// then pays only the per-command cost.
// ---------------------------------------------------------------------------

const REACT_SMIRKS = '[C:1][OH]>>[C:1]Br';
const REACT_REACTANTS = [
  'CCO', 'CCCO', 'CCCCO', 'CC(O)C', 'c1ccccc1CO',
  'OCC', 'OCCC', 'OC(C)C', 'OCC(C)C', 'OCCO'
];

async function reactBenchmark(n) {
  console.log(`  react ×${n} (${REACT_REACTANTS.length} reactants each, warm WASM) …`);
  const { reactionApply } = require('../src/commands/react');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await reactionApply({ smirks: REACT_SMIRKS, reactants: REACT_REACTANTS });
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(1)} ms\n`);
  }
  return stats(times);
}

const STEREO_MOLECULES = [
  'CC(O)C(N)C',             // 2 unspecified tetrahedral
  '[C@@H](O)(N)C',          // 1 specified tetrahedral
  'C/C=C/C',                // E double bond
  '[C@@H]1(O)CCCC1',        // 1 specified ring
  'CC(F)(Cl)Br',            // 1 unspecified (haloalkane)
  'OC(C)(F)C(N)=O',         // 1 unspecified
  '[C@H](C)(N)C(=O)O',      // 1 specified (amino acid-like)
  'CCO',                    // no stereo
  'c1ccccc1',               // aromatic, no stereo
  'CC(=O)Oc1ccccc1C(=O)O',  // aspirin – no stereo
];

async function stereoBenchmark(n) {
  console.log(`  stereo ×${n} (${STEREO_MOLECULES.length} molecules each, warm WASM) …`);
  const { analyzeStereo } = require('../src/commands/stereo');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await Promise.all(STEREO_MOLECULES.map(s => analyzeStereo(s)));
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(1)} ms\n`);
  }
  return stats(times);
}

const DRAW_HIGHLIGHT_SMILES = 'CC(=O)Oc1ccccc1C(=O)O';  // aspirin
const DRAW_HIGHLIGHT_ATOMS = { '0': '#ff0000', '1': '#ff0000', '9': '#0000ff' };
const DRAW_HIGHLIGHT_BONDS = { '0': '#00cc00' };

async function drawHighlightsBenchmark(n) {
  console.log(`  draw (highlights) ×${n} (warm WASM) …`);
  const { drawMolecule } = require('../src/commands/draw');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await drawMolecule(DRAW_HIGHLIGHT_SMILES, {
      format: 'svg',
      width: 400,
      height: 300,
      highlightAtoms: DRAW_HIGHLIGHT_ATOMS,
      highlightBonds: DRAW_HIGHLIGHT_BONDS,
      highlightRadius: 0.4
    });
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(1)} ms\n`);
  }
  return stats(times);
}

async function drawPlainBenchmark(n) {
  console.log(`  draw (no highlights) ×${n} (warm WASM) …`);
  const { drawMolecule } = require('../src/commands/draw');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await drawMolecule(DRAW_HIGHLIGHT_SMILES, { format: 'svg', width: 400, height: 300 });
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(1)} ms\n`);
  }
  return stats(times);
}

const ATOM_MAP_MAPPED = '[CH3:1][CH2:2][OH:3]';
const ATOM_MAP_PLAIN  = 'CCO';
const ATOM_MAP_SMIRKS = '[C:1][OH:2]>>[C:1]Br';

async function atomMapBenchmark(n) {
  console.log(`  atom-map (add/remove/list/check) ×${n} each (warm WASM) …`);
  const { atomMapAdd, atomMapRemove, atomMapList, atomMapCheck } = require('../src/commands/atom-map');

  const subResults = {};
  for (const [label, fn, arg] of [
    ['add',    atomMapAdd,    ATOM_MAP_PLAIN],
    ['remove', atomMapRemove, ATOM_MAP_MAPPED],
    ['list',   atomMapList,   ATOM_MAP_MAPPED],
    ['check',  atomMapCheck,  ATOM_MAP_SMIRKS],
  ]) {
    const times = [];
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime();
      await fn(arg);
      const ms = hrMs(process.hrtime(t0));
      times.push(ms);
    }
    const s = stats(times);
    process.stdout.write(`    atom-map ${label}: mean ${s.mean.toFixed(1)} ms  min ${s.min.toFixed(1)} ms  max ${s.max.toFixed(1)} ms\n`);
    subResults[label] = s;
  }
  return subResults;
}

/**
 * tautomers is NOT_SUPPORTED_IN_WASM in the standard build.
 * Benchmark the error path to confirm it is fast (i.e. not hanging on WASM init).
 */
async function tautomersErrorPathBenchmark(n) {
  console.log(`  tautomers (NOT_SUPPORTED_IN_WASM error path) ×${n} (warm WASM) …`);
  const { enumerateTautomers } = require('../src/commands/tautomers');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    try {
      await enumerateTautomers({ smiles: 'OC1=CC=CC=C1', limit: 10 });
    } catch (e) {
      if (e.code !== 'NOT_SUPPORTED_IN_WASM') throw e;
    }
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(1)} ms\n`);
  }
  return stats(times);
}

// ---------------------------------------------------------------------------
// Similarity multi-target
// ---------------------------------------------------------------------------

const SIMILARITY_TARGETS = [
  'c1ccccc1', 'Cc1ccccc1', 'CCc1ccccc1', 'Cc1ccc(C)cc1',
  'c1ccc2ccccc2c1', 'c1ccncc1', 'c1ccoc1', 'c1ccsc1',
  'CC(=O)Oc1ccccc1C(=O)O', 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C',
  'CCO', 'CC(=O)O', 'c1ccc(N)cc1', 'c1ccc(O)cc1',
  'CC(C)(C)c1ccccc1', 'COc1ccccc1', 'Cc1cccc(C)c1',
  'c1ccc(Cl)cc1', 'c1ccc(F)cc1', 'c1ccc(Br)cc1',
  'CC1CCCCC1', 'C1CCCCC1', 'C1CCCC1', 'C1CCC1',
  'c1cccnc1', 'c1ccnc(N)c1', 'c1cnccn1', 'c1ccnnc1',
  'CCCCO', 'CCCCN', 'CCCC(=O)O', 'CCCC(=O)N',
  'c1ccc(CC)cc1', 'c1ccc(OC)cc1', 'c1ccc(NC)cc1',
  'CC(=O)c1ccccc1', 'COC(=O)c1ccccc1', 'O=C(O)c1ccccc1',
  'c1ccc(-c2ccccc2)cc1', 'c1ccc2cc3ccccc3cc2c1',
  'CC1=CC=CC=C1', 'CC1=CC=CC(C)=C1', 'CC1=CN=CC=C1',
  'O=C1CCCCC1', 'O=C1CCCC1', 'O=C1CCC1',
  'c1ccc(C2CCCC2)cc1', 'c1ccc(C2CCCCC2)cc1',
  'CCc1cccc(CC)c1', 'c1cc2ccccc2cc1',
];

async function similarityBenchmark(n) {
  console.log(`  Similarity ×${n} (${SIMILARITY_TARGETS.length} targets each) …`);
  const { similarity } = require('../src/commands/similarity');
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime();
    await similarity({ query: 'c1ccccc1', targets: SIMILARITY_TARGETS.join(','), threshold: 0.0, top: 100 });
    const ms = hrMs(process.hrtime(t0));
    times.push(ms);
    process.stdout.write(`    run ${i + 1}: ${ms.toFixed(0)} ms\n`);
  }
  return stats(times);
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function mdTable(rows) {
  const header = '| Metric | Value |';
  const sep = '|--------|-------|';
  return [header, sep, ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

function newCmdTable(rows) {
  const header = '| Command | Mean | Min | Max | Notes |';
  const sep = '|---------|------|-----|-----|-------|';
  return [header, sep, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

function generateMarkdown(r) {
  const {
    date, nodeVersion, cold, wasmInit, inProcess,
    reactBench, stereoBench, drawHighlightsBench, drawPlainBench,
    atomMapBench, tautomersErrorBench, simBench
  } = r;

  const warmMean = inProcess.warm.raw.length
    ? `~${inProcess.warm.mean.toFixed(0)} ms`
    : 'n/a (only 1 run)';

  const amRows = Object.entries(atomMapBench).map(([sub, s]) =>
    [`atom-map ${sub}`, fmtMs(s.mean), fmtMs(s.min), fmtMs(s.max), 'molblock parse + reload']
  );

  return `# rdkit_cli Benchmark Results

**Date:** ${date}
**Node:** ${nodeVersion}
**Runs per scenario:** ${RUNS}

---

## Cold Run (new process each time)

Command: \`rdkit_cli ${COMMAND_ARGS.join(' ')}\`
Includes Node.js startup + WASM initialisation + command execution.

${mdTable([
    ['Mean',   fmtMs(cold.mean)],
    ['Median', fmtMs(cold.median)],
    ['Min',    fmtMs(cold.min)],
    ['Max',    fmtMs(cold.max)],
  ])}

Individual runs: ${cold.raw.map(fmtMs).join(', ')}

---

## WASM Initialisation Only

Time for \`getRDKit()\` in a fresh child process (no command overhead).

${mdTable([
    ['Mean',   fmtMs(wasmInit.mean)],
    ['Median', fmtMs(wasmInit.median)],
    ['Min',    fmtMs(wasmInit.min)],
    ['Max',    fmtMs(wasmInit.max)],
  ])}

Individual runs: ${wasmInit.raw.map(fmtMs).join(', ')}

---

## In-Process Runs (Node.js API — \`descriptors\` baseline)

| Run | Time | Notes |
|-----|------|-------|
| Run 1 | ${inProcess.run1.ms.toFixed(0)} ms | cold WASM – first \`getRDKit()\` call |
${inProcess.warm.raw.map((t, i) => `| Run ${i + 2} | ${t.toFixed(0)} ms | warm – WASM already cached |`).join('\n')}

> Run 1 includes WASM initialisation. Runs 2+ reuse the cached module.
> The ~${wasmInit.mean.toFixed(0)} ms init cost is paid **once per process** regardless of which
> command is called first. Every subsequent \`await getRDKit()\` resolves immediately
> from the module-level singleton in \`src/wasm.js\`.

---

## New Commands — Warm WASM (in-process)

All measurements below are taken **after** WASM is already initialised.
The WASM init problem — every command paying ~${wasmInit.mean.toFixed(0)} ms on first call — is handled
by the singleton in \`src/wasm.js\`: once \`getRDKit()\` resolves the first time, every
subsequent call returns the cached instance without re-initialising.

${newCmdTable([
    ['react', fmtMs(reactBench.mean), fmtMs(reactBench.min), fmtMs(reactBench.max),
     `${REACT_REACTANTS.length} reactants, MolList + run_reactants`],
    ['stereo', fmtMs(stereoBench.mean), fmtMs(stereoBench.min), fmtMs(stereoBench.max),
     `${STEREO_MOLECULES.length} molecules, mol JSON + descriptors`],
    ['draw (highlights)', fmtMs(drawHighlightsBench.mean), fmtMs(drawHighlightsBench.min), fmtMs(drawHighlightsBench.max),
     'get_svg_with_highlights, atomColours + bondColours'],
    ['draw (no highlights)', fmtMs(drawPlainBench.mean), fmtMs(drawPlainBench.min), fmtMs(drawPlainBench.max),
     'get_svg_with_highlights baseline'],
    ...amRows,
    ['tautomers (error path)', fmtMs(tautomersErrorBench.mean), fmtMs(tautomersErrorBench.min), fmtMs(tautomersErrorBench.max),
     'NOT_SUPPORTED_IN_WASM — fast capability check'],
  ])}

### draw highlights overhead

| Variant | Mean |
|---------|------|
| No highlights | ${fmtMs(drawPlainBench.mean)} |
| With highlights | ${fmtMs(drawHighlightsBench.mean)} |
| Delta | ${fmtMs(Math.max(0, drawHighlightsBench.mean - drawPlainBench.mean))} |

---

## Similarity — Parallel Target Processing

Query: \`c1ccccc1\` vs ${SIMILARITY_TARGETS.length} targets (warm WASM, in-process).

${mdTable([
    ['Mean',            `${simBench.mean.toFixed(1)} ms`],
    ['Median',          `${simBench.median.toFixed(1)} ms`],
    ['Min',             `${simBench.min.toFixed(1)} ms`],
    ['Max',             `${simBench.max.toFixed(1)} ms`],
    ['Per target (avg)', `${(simBench.mean / SIMILARITY_TARGETS.length).toFixed(2)} ms`],
  ])}

Individual runs: ${simBench.raw.map(t => t.toFixed(1) + ' ms').join(', ')}

---

## Latency Breakdown (estimates)

| Component | Estimate |
|-----------|----------|
| Node.js startup | ~${Math.max(0, cold.mean - wasmInit.mean).toFixed(0)} ms |
| RDKit WASM init | ~${wasmInit.mean.toFixed(0)} ms |
| Per-command work (warm) | ${warmMean} |
| Total cold CLI latency | ~${cold.mean.toFixed(0)} ms |

---

## WASM Init Problem & Solution

### The problem

Every chemistry command calls \`await getRDKit()\` at its start.  On the first call
in a process that cost is ~${wasmInit.mean.toFixed(0)} ms — WASM module load + memory setup.
Before the optimisations documented below, this meant the first call to *any* command
(old or new) paid the full init cost, even for trivial operations.

### The solution: module-level singleton (all commands)

\`src/wasm.js\` maintains a process-level singleton:

\`\`\`js
let rdkitInstance = null;
let rdkitLoading  = null;   // in-flight Promise, shared across concurrent callers

async function getRDKit() {
  if (rdkitInstance) return rdkitInstance;  // ← O(1) after first call
  if (rdkitLoading)  return rdkitLoading;   // ← concurrent callers share one init
  rdkitLoading = (async () => { ... })();
  return rdkitLoading;
}
\`\`\`

After the first successful \`await getRDKit()\`, every subsequent call — whether from
\`react\`, \`stereo\`, \`atom-map\`, or any existing command — returns immediately.
The ~${wasmInit.mean.toFixed(0)} ms cost is paid **once per process**.

### CLI: background preload (\`cli.js\`)

In the CLI entry point, \`getRDKit()\` is fired immediately after the command name
is parsed, before stdin is read or args are normalised:

\`\`\`js
if (!NO_RDKIT_COMMANDS.includes(commandName)) {
  require('./wasm').getRDKit().catch(() => {});  // fire and forget
}
\`\`\`

WASM loading (~${wasmInit.mean.toFixed(0)} ms) overlaps with the work that was happening anyway,
so the command's own \`await getRDKit()\` resolves against an already-in-progress
Promise rather than starting a fresh one.

### Node.js API: pre-warm once at startup

When using rdkit_cli as a library, call any command (or \`getRDKit()\` directly) once
at startup.  All subsequent calls pay only the per-command cost shown above:

\`\`\`js
const { getRDKit, react, stereo, atomMapAdd } = require('rdkit_cli');

// Pre-warm once — typically at app startup
await getRDKit();

// All subsequent calls are fast (warm WASM)
const products   = await react({ smirks: '[C:1][OH]>>[C:1]Br', reactants: ['CCO'] });
const stereoInfo = await stereo({ smiles: 'CC(O)C(N)C' });
const mapped     = await atomMapAdd('CCO');
\`\`\`

### Daemon / persistent process

Running \`rdkit_daemon\` keeps the WASM module live between invocations.  Each
call pays only the per-command overhead (~${warmMean}), not the
~${wasmInit.mean.toFixed(0)} ms WASM init cost.  For scripts that call the CLI in a loop this
is a ${inProcess.warm.raw.length ? Math.round(inProcess.run1.ms / (inProcess.warm.mean || 1)) + 'x' : 'significant'} speed-up per invocation.

---

## Other Optimisations

### Lazy-loaded data files

| File | Size | Loaded by |
|------|------|-----------|
| \`data/aliases.json\` | small | any command calling \`harden()\` |
| \`data/fg_patterns.json\` | medium | \`fg\`, \`repair-smiles\` only |
| \`data/checkmol_smarts_part1.csv\` | large | \`repair-smiles\` only |

Each file is read on **first use** (result cached) rather than at \`require()\` time.
Commands like \`react\`, \`stereo\`, \`descriptors\`, or \`similarity\` that don't need
the FG or checkmol data do not pay that I/O cost.

### Parallel target processing

\`similarity\` and \`subsearch\` use \`Promise.all\` (concurrency-capped at 16).
\`stereo\`, \`rings\`, \`scaffold\`, \`fingerprint\`, and \`descriptors\` all batch
via \`Promise.all\`.  Because RDKit WASM is single-threaded, wall time scales
linearly with target count, but the pattern bounds peak memory and is consistent
across all batch-capable commands including the new ones.

### Fast \`--version\` (no WASM init)

\`rdkit_cli --version\` does not load the WASM module at all; it returns CLI +
Node.js versions from \`package.json\` instantly.  Use \`--version --full\` when
the RDKit WASM runtime version string is needed.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('rdkit_cli benchmark');
  console.log('===================');
  console.log(`runs: ${RUNS}  baseline command: rdkit_cli ${COMMAND_ARGS.join(' ')}`);
  console.log('');

  // Phase 1: cold / spawn measurements
  const cold     = coldRun(RUNS);
  console.log('');
  const wasmInit = wasmInitRun(RUNS);
  console.log('');

  // Phase 2: in-process baseline (descriptors) — run 1 cold, rest warm
  const inProcess = await inProcessRuns(RUNS);
  console.log('');

  // Phase 3: pre-warm WASM once for all new-command benchmarks.
  // After inProcessRuns() above the singleton is already warm in this process,
  // but we call getRDKit() explicitly here as a documented pattern.
  console.log('  Pre-warming WASM for new-command benchmarks …');
  const { getRDKit } = require('../src/wasm');
  await getRDKit();
  console.log('  WASM warm.\n');

  // Phase 4: new commands (all warm)
  const reactBench         = await reactBenchmark(RUNS);
  console.log('');
  const stereoBench        = await stereoBenchmark(RUNS);
  console.log('');
  const drawHighlightsBench = await drawHighlightsBenchmark(RUNS);
  const drawPlainBench      = await drawPlainBenchmark(RUNS);
  console.log('');
  const atomMapBench       = await atomMapBenchmark(RUNS);
  console.log('');
  const tautomersErrorBench = await tautomersErrorPathBenchmark(RUNS);
  console.log('');

  // Phase 5: similarity (warm)
  const simBench = await similarityBenchmark(RUNS);
  console.log('');

  // Print summary
  console.log('Summary');
  console.log('-------');
  console.log(`  Cold run (mean):                 ${cold.mean.toFixed(0)} ms`);
  console.log(`  WASM init-only (mean):           ${wasmInit.mean.toFixed(0)} ms`);
  console.log(`  In-process run 1 (cold WASM):    ${inProcess.run1.ms.toFixed(0)} ms`);
  if (inProcess.warm.raw.length) {
    console.log(`  In-process run 2+ (warm, mean):  ${inProcess.warm.mean.toFixed(0)} ms`);
  }
  console.log(`  react     (mean, warm):          ${reactBench.mean.toFixed(1)} ms  (${REACT_REACTANTS.length} reactants)`);
  console.log(`  stereo    (mean, warm):          ${stereoBench.mean.toFixed(1)} ms  (${STEREO_MOLECULES.length} molecules)`);
  console.log(`  draw+hl   (mean, warm):          ${drawHighlightsBench.mean.toFixed(1)} ms`);
  console.log(`  draw      (mean, warm):          ${drawPlainBench.mean.toFixed(1)} ms`);
  Object.entries(atomMapBench).forEach(([sub, s]) => {
    console.log(`  atom-map ${sub.padEnd(7)} (mean, warm): ${s.mean.toFixed(1)} ms`);
  });
  console.log(`  tautomers NOT_SUPPORTED (mean):  ${tautomersErrorBench.mean.toFixed(1)} ms`);
  console.log(`  similarity ${SIMILARITY_TARGETS.length} targets (mean):  ${simBench.mean.toFixed(1)} ms  (${(simBench.mean / SIMILARITY_TARGETS.length).toFixed(2)} ms/target)`);
  console.log('');

  const results = {
    date: new Date().toISOString(),
    nodeVersion: process.version,
    cold,
    wasmInit,
    inProcess,
    reactBench,
    stereoBench,
    drawHighlightsBench,
    drawPlainBench,
    atomMapBench,
    tautomersErrorBench,
    simBench
  };

  const mdPath = path.join(ROOT, 'BENCHMARK.md');
  fs.writeFileSync(mdPath, generateMarkdown(results));
  console.log(`Results written to BENCHMARK.md`);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
