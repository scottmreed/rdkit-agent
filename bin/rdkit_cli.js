#!/usr/bin/env node
'use strict';

// Suppress WASM warnings that might clutter output
process.env.RDKIT_SUPPRESS_WARNINGS = '1';

const { main } = require('../src/cli');

main(process.argv.slice(2)).then(exitCode => {
  process.exit(exitCode || 0);
}).catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
