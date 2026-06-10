/**
 * processAuditLog.js
 *
 * Entry point for the audit-log normalisation pipeline.
 *
 * Public API (must not change):
 *   processAuditLog(inputPath: string, outputPath: string): Promise<{ total, written, skipped }>
 *
 * CURRENT BEHAVIOUR (BROKEN — see task brief):
 *   - Reads the entire input file into memory synchronously.
 *   - Parses all JSON lines at once with a single .map() — one malformed line
 *     throws and aborts the entire run.
 *   - Writes the full output synchronously in one shot.
 *   - On large files (>1 GB) this exhausts the heap and crashes the process.
 *
 * FIXME: synchronous bulk read/parse/write — does not scale and is not resilient
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { normaliseEvent } = require('../lib/normaliser');
const { LineSplitter } = require('../lib/lineStream');

/**
 * Processes an NDJSON audit-log file and writes normalised records to outputPath.
 *
 * @param {string} inputPath   - Absolute or relative path to the source NDJSON file.
 * @param {string} outputPath  - Absolute or relative path for the enriched output file.
 * @returns {Promise<{ total: number, written: number, skipped: number }>}
 */
async function processAuditLog(inputPath, outputPath) {
  const stats = {
    total: 0,
    written: 0,
    skipped: 0,
  };

  let physicalLineNumber = 0;

  const readStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const writeStream = fs.createWriteStream(outputPath, {
    encoding: 'utf8',
    flags: 'w',
  });

  const normaliseTransform = new Transform({
    writableObjectMode: true,
    transform(line, _encoding, callback) {
      physicalLineNumber += 1;

      const text = typeof line === 'string' ? line : String(line);
      const trimmed = text.trim();

      if (trimmed.length === 0) {
        callback();
        return;
      }

      stats.total += 1;

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        stats.skipped += 1;
        process.stderr.write(JSON.stringify({
          level: 'warn',
          type: 'malformed-line',
          line: physicalLineNumber,
          error: error.message,
        }) + '\n');
        callback();
        return;
      }

      let normalised;
      try {
        normalised = normaliseEvent(parsed);
      } catch (error) {
        callback(error);
        return;
      }

      stats.written += 1;
      callback(null, JSON.stringify(normalised) + '\n');
    },
  });

  try {
    await pipeline(
      readStream,
      new LineSplitter(),
      normaliseTransform,
      writeStream,
    );
  } catch (error) {
    throw createMeaningfulError(error, inputPath, outputPath);
  }

  const summary = {
    total: stats.total,
    written: stats.written,
    skipped: stats.skipped,
  };

  process.stderr.write(JSON.stringify(summary) + '\n');

  return summary;
}

/**
 * @param {unknown} error
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Error}
 */
function createMeaningfulError(error, inputPath, outputPath) {
  const err = error instanceof Error ? error : new Error(String(error));
  const inputResolved = path.resolve(inputPath);
  const outputResolved = path.resolve(outputPath);
  const errorPath = typeof err.path === 'string' ? path.resolve(err.path) : null;

  let message;

  if (err.code === 'ENOENT' && errorPath === inputResolved) {
    message = `Input file not found or unreadable: ${inputPath}`;
  } else if (
    errorPath === outputResolved ||
    ['EISDIR', 'EACCES', 'EPERM', 'EROFS'].includes(err.code)
  ) {
    message = `Output file is not writable: ${outputPath}`;
  } else if (errorPath === inputResolved) {
    message = `Failed while reading input file \"${inputPath}\": ${err.message}`;
  } else if (errorPath === outputResolved) {
    message = `Failed while writing output file \"${outputPath}\": ${err.message}`;
  } else {
    message = `Audit log pipeline failed: ${err.message}`;
  }

  const wrapped = new Error(message);
  wrapped.cause = err;

  if (err.code) {
    wrapped.code = err.code;
  }

  return wrapped;
}

module.exports = { processAuditLog };
