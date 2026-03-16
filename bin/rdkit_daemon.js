#!/usr/bin/env node
'use strict';

// Suppress WASM warnings that might clutter output
process.env.RDKIT_SUPPRESS_WARNINGS = '1';

require('../src/daemon');
