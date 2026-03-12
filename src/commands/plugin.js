'use strict';

const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.rdkit_cli', 'plugins');

/**
 * Validate a plugin package name to prevent path traversal.
 * Accepts scoped npm names (@scope/pkg) and plain names, rejects path separators and dots.
 */
function validatePluginName(name) {
  if (!name || typeof name !== 'string') return false;
  // Allow: letters, digits, hyphens, underscores, dots (for scoped names like @scope/pkg)
  // Reject: path separators, .., or anything that looks like a path
  if (name.includes('/') && !name.startsWith('@')) return false;
  if (name.includes('..')) return false;
  if (name.includes(path.sep)) return false;
  return true;
}

/**
 * List installed plugins
 */
function listPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) {
    return [];
  }
  try {
    return fs.readdirSync(PLUGIN_DIR)
      .filter(f => fs.statSync(path.join(PLUGIN_DIR, f)).isDirectory())
      .map(name => {
        let pkg = {};
        try {
          pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, name, 'package.json'), 'utf8'));
        } catch (_) {}
        return {
          name,
          version: pkg.version || 'unknown',
          description: pkg.description || '',
          path: path.join(PLUGIN_DIR, name)
        };
      });
  } catch (e) {
    return [];
  }
}

/**
 * Main plugin command
 */
async function plugin(args) {
  const subcommand = args.subcommand || (args._ && args._[0]) || 'list';

  switch (subcommand) {
    case 'list': {
      const plugins = listPlugins();
      return {
        plugin_dir: PLUGIN_DIR,
        installed: plugins,
        count: plugins.length,
        message: plugins.length === 0
          ? 'No plugins installed. Use: rdkit_cli plugin install <npm-package>'
          : `${plugins.length} plugin(s) installed`
      };
    }

    case 'install': {
      const pkgName = args.package || (args._ && args._[1]);
      if (!pkgName) {
        return { error: 'Package name required. Usage: rdkit_cli plugin install <package-name>' };
      }
      if (!validatePluginName(pkgName)) {
        return { error: `Invalid package name: '${pkgName}'` };
      }
      return {
        status: 'not_implemented',
        message: `Plugin installation is a stub. Run: npm install -g ${pkgName} manually.`,
        package: pkgName,
        plugin_dir: PLUGIN_DIR
      };
    }

    case 'remove':
    case 'uninstall': {
      const pkgName = args.package || (args._ && args._[1]);
      if (!pkgName) {
        return { error: 'Package name required. Usage: rdkit_cli plugin remove <package-name>' };
      }
      if (!validatePluginName(pkgName)) {
        return { error: `Invalid package name: '${pkgName}'` };
      }
      return {
        status: 'not_implemented',
        message: 'Plugin removal is a stub.',
        package: pkgName
      };
    }

    default:
      return {
        error: `Unknown plugin subcommand: '${subcommand}'`,
        valid_subcommands: ['list', 'install', 'remove']
      };
  }
}

module.exports = { plugin, listPlugins };
