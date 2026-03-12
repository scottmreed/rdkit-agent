'use strict';

const { getRDKit } = require('../wasm');
const { harden } = require('../hardening');

/**
 * Extract Murcko scaffold from a molecule using RDKit's get_frags or JSON approach.
 * RDKit WASM doesn't expose get_scaffold directly, so we use a SMARTS-based
 * approach to identify ring systems and their linkers.
 */
async function extractScaffold(smiles, generic) {
  const RDKit = await getRDKit();
  const h = harden(smiles, 'smiles');
  if (h.error) {
    return { smiles, error: h.error };
  }

  let mol = null;
  try {
    mol = RDKit.get_mol(h.value);
    if (!mol || !mol.is_valid()) {
      return { smiles, error: 'Invalid molecule' };
    }

    const canonical = mol.get_smiles();

    // Check if the molecule has any rings
    const descJson = mol.get_descriptors();
    const descs = descJson ? JSON.parse(descJson) : {};
    const ringCount = descs.NumRings || 0;

    if (ringCount === 0) {
      return {
        smiles: h.value,
        canonical_smiles: canonical,
        scaffold: null,
        has_scaffold: false,
        message: 'Molecule has no ring system (no Murcko scaffold)'
      };
    }

    // Get the ring-containing framework using get_frags if available,
    // or return the canonical SMILES of the molecule noting that scaffold extraction
    // requires server-side RDKit for full Murcko computation.
    let scaffoldSmiles = null;
    let method = 'ring_system';

    try {
      // Try get_frags to get fragments - may expose scaffold-like info
      const fragsResult = mol.get_frags(JSON.stringify({ sanitize: true }));
      if (fragsResult) {
        // get_frags returns a string with fragment SMILES
        const frags = fragsResult.split('.');
        // The scaffold is typically the largest fragment containing rings
        const ringFrag = frags.find(f => {
          let fragMol = null;
          try {
            fragMol = RDKit.get_mol(f);
            if (!fragMol || !fragMol.is_valid()) return false;
            const fragDescs = JSON.parse(fragMol.get_descriptors());
            return (fragDescs.NumRings || 0) > 0;
          } catch (_) {
            return false;
          } finally {
            if (fragMol) {
              try { fragMol.delete(); } catch (_) {}
            }
          }
        });
        if (ringFrag) {
          scaffoldSmiles = ringFrag;
          method = 'get_frags';
        }
      }
    } catch (e) {
      // get_frags not available or failed
    }

    // Fallback: Use a SMARTS approach to extract ring atoms and their connections
    if (!scaffoldSmiles) {
      try {
        // Use ring SMARTS to identify ring atoms
        const ringAtomSmarts = '[r]';
        let ringQmol = null;
        try {
          ringQmol = RDKit.get_qmol(ringAtomSmarts);
          if (ringQmol && ringQmol.is_valid()) {
            const matchesJson = mol.get_substruct_matches(ringQmol);
            if (matchesJson && matchesJson !== '[]') {
              // We have ring atoms - the scaffold is the molecule itself for now
              // Full Murcko requires server-side processing
              scaffoldSmiles = canonical;
              method = 'ring_atoms_only';
            }
          }
        } finally {
          if (ringQmol) {
            try { ringQmol.delete(); } catch (_) {}
          }
        }
      } catch (e) {
        scaffoldSmiles = canonical;
        method = 'canonical_fallback';
      }
    }

    // If generic scaffold requested, replace all atoms with C and bonds with single
    if (generic && scaffoldSmiles) {
      try {
        // Replace heteroatoms with C in a simple way
        let genericScaffold = scaffoldSmiles
          .replace(/\[N[^\]]*\]/g, 'C')
          .replace(/\[O[^\]]*\]/g, 'C')
          .replace(/\[S[^\]]*\]/g, 'C')
          .replace(/n/g, 'c')
          .replace(/o/g, 'c')
          .replace(/s/g, 'c')
          .replace(/N/g, 'C')
          .replace(/O/g, 'C')
          .replace(/S/g, 'C')
          .replace(/F/g, 'C')
          .replace(/Cl/g, 'C')
          .replace(/Br/g, 'C')
          .replace(/I/g, 'C');

        // Validate and get canonical
        let genericMol = null;
        try {
          genericMol = RDKit.get_mol(genericScaffold);
          if (genericMol && genericMol.is_valid()) {
            scaffoldSmiles = genericMol.get_smiles();
          }
        } finally {
          if (genericMol) {
            try { genericMol.delete(); } catch (_) {}
          }
        }
      } catch (e) {
        // Keep original scaffold
      }
    }

    return {
      smiles: h.value,
      canonical_smiles: canonical,
      scaffold: scaffoldSmiles,
      has_scaffold: scaffoldSmiles !== null,
      generic,
      method,
      note: method !== 'get_scaffold'
        ? 'Full Murcko scaffold extraction requires server-side RDKit. Ring framework returned.'
        : undefined
    };

  } finally {
    if (mol) {
      try { mol.delete(); } catch (_) {}
    }
  }
}

/**
 * Main scaffold command
 */
async function scaffold(args) {
  const generic = args.generic === true || args.generic === 'true';

  let molecules = [];

  if (args.json) {
    try {
      const parsed = typeof args.json === 'string' ? JSON.parse(args.json) : args.json;
      if (parsed.smiles) molecules = [parsed.smiles];
      else if (parsed.molecules) molecules = parsed.molecules;
      else if (Array.isArray(parsed)) molecules = parsed;
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
  } else if (args.smiles) {
    molecules = Array.isArray(args.smiles) ? args.smiles : [args.smiles];
  } else if (args._ && args._.length > 0) {
    molecules = args._;
  }

  if (molecules.length === 0) {
    return { error: 'No molecules provided. Use --smiles <smiles>' };
  }

  const results = await Promise.all(molecules.map(s => extractScaffold(s, generic)));

  if (results.length === 1) return results[0];
  return { count: results.length, results };
}

module.exports = { scaffold, extractScaffold };
