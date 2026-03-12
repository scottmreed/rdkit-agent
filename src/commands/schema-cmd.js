'use strict';

const { getSchema, listSchemas } = require('../schema');

/**
 * Schema command - dump JSON Schema for any command
 */
async function schemaCmd(args) {
  const commandName = args.command || (args._ && args._[0]);

  if (!commandName || commandName === 'list') {
    const schemas = listSchemas();
    return {
      available_schemas: schemas,
      usage: 'rdkit_cli schema <command-name>',
      example: 'rdkit_cli schema check'
    };
  }

  const schema = getSchema(commandName);
  if (!schema) {
    return {
      error: `No schema found for command: '${commandName}'`,
      available: listSchemas()
    };
  }

  return {
    command: commandName,
    schema
  };
}

module.exports = { schemaCmd };
