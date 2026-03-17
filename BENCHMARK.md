# rdkit_cli Benchmark Results

**Node:** v22.20.0
**Runs per scenario:** 3

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
