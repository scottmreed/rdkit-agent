'use strict';

let chalk;
try {
  chalk = require('chalk');
} catch (e) {
  // Chalk not available - use plain text
  chalk = null;
}

function colorize(text, color) {
  if (!chalk || !process.stdout.isTTY) return text;
  try {
    return chalk[color] ? chalk[color](text) : text;
  } catch (e) {
    return text;
  }
}

/**
 * Convert an array of objects to CSV string
 */
function toCSV(data, fields) {
  if (!Array.isArray(data)) {
    data = [data];
  }
  if (data.length === 0) return '';

  const headers = fields || Object.keys(data[0]);
  const rows = [headers.join(',')];

  for (const item of data) {
    const row = headers.map(h => {
      const val = item[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Quote if contains comma, newline, or double quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Convert an array of objects to TSV string
 */
function toTSV(data, fields) {
  if (!Array.isArray(data)) {
    data = [data];
  }
  if (data.length === 0) return '';

  const headers = fields || Object.keys(data[0]);
  const rows = [headers.join('\t')];

  for (const item of data) {
    const row = headers.map(h => {
      const val = item[h];
      if (val === null || val === undefined) return '';
      return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
    });
    rows.push(row.join('\t'));
  }

  return rows.join('\n');
}

/**
 * Convert to NDJSON (newline-delimited JSON)
 */
function toNDJSON(data) {
  if (!Array.isArray(data)) {
    return JSON.stringify(data);
  }
  return data.map(item => JSON.stringify(item)).join('\n');
}

/**
 * Human-readable text format
 */
function toText(data, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);

  if (data === null || data === undefined) return `${pad}null`;
  if (typeof data === 'boolean') return `${pad}${colorize(String(data), data ? 'green' : 'red')}`;
  if (typeof data === 'number') return `${pad}${colorize(String(data), 'cyan')}`;
  if (typeof data === 'string') return `${pad}${data}`;

  if (Array.isArray(data)) {
    if (data.length === 0) return `${pad}(empty)`;
    return data.map((item, i) => {
      if (typeof item === 'object' && item !== null) {
        return `${pad}[${i}]:\n${toText(item, indent + 1)}`;
      }
      return `${pad}- ${toText(item)}`;
    }).join('\n');
  }

  if (typeof data === 'object') {
    const lines = [];
    for (const [key, val] of Object.entries(data)) {
      const keyStr = colorize(key, 'bold') || key;
      if (typeof val === 'object' && val !== null) {
        lines.push(`${pad}${keyStr}:`);
        lines.push(toText(val, indent + 1));
      } else {
        lines.push(`${pad}${keyStr}: ${toText(val)}`);
      }
    }
    return lines.join('\n');
  }

  return `${pad}${String(data)}`;
}

/**
 * Filter object fields
 */
function filterFields(data, fields) {
  if (!fields || fields.length === 0) return data;

  if (Array.isArray(data)) {
    return data.map(item => filterFields(item, fields));
  }

  if (typeof data === 'object' && data !== null) {
    const result = {};
    for (const field of fields) {
      if (field in data) {
        result[field] = data[field];
      }
    }
    return result;
  }

  return data;
}

/**
 * Format output based on format string and options
 */
function formatOutput(data, options) {
  options = options || {};
  const format = options.format || (process.stdout.isTTY ? 'text' : 'json');
  const fields = options.fields;
  const limit = options.limit;

  // Apply field filtering
  let filtered = fields ? filterFields(data, fields) : data;

  // Apply limit
  if (limit && Array.isArray(filtered)) {
    filtered = filtered.slice(0, limit);
  }

  switch (format) {
    case 'json':
      return JSON.stringify(filtered, null, 2);

    case 'ndjson':
      return toNDJSON(filtered);

    case 'csv':
      return toCSV(Array.isArray(filtered) ? filtered : [filtered], fields);

    case 'tsv':
      return toTSV(Array.isArray(filtered) ? filtered : [filtered], fields);

    case 'text':
      return toText(filtered);

    default:
      return JSON.stringify(filtered, null, 2);
  }
}

/**
 * Print formatted output to stdout
 */
function printOutput(data, options) {
  const output = formatOutput(data, options);
  process.stdout.write(output + '\n');
}

/**
 * Print error output to stderr
 */
function printError(message, options) {
  options = options || {};
  const format = options.format || (process.stderr.isTTY ? 'text' : 'json');

  if (format === 'json' || !process.stderr.isTTY) {
    const errObj = typeof message === 'string' ? { error: message } : message;
    process.stderr.write(JSON.stringify(errObj) + '\n');
  } else {
    const prefix = colorize('ERROR: ', 'red') || 'ERROR: ';
    process.stderr.write(`${prefix}${message}\n`);
  }
}

module.exports = { formatOutput, printOutput, printError, toCSV, toTSV, toNDJSON, toText, filterFields };
