/**
 * smokeTest.js
 *
 * Runs processAuditLog against the generated fixture and prints RSS
 * every 500 ms so you can observe memory behaviour visually.
 *
 * Usage (after running generateFixture.js first):
 *   node scripts/smokeTest.js [inputPath] [outputPath]
 */

'use strict';

const path   = require('path');
const os     = require('os');
const { processAuditLog } = require('../src/pipeline/processAuditLog');

const inputPath  = process.argv[2] ?? path.join(__dirname, 'output', 'sample-audit.ndjson');
const outputPath = process.argv[3] ?? path.join(os.tmpdir(), 'smoke-output.ndjson');

console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
console.log('Starting pipeline — RSS will be printed every 500 ms\n');

const startRss = process.memoryUsage().rss;
const startMs  = Date.now();

const poller = setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(
    `[${elapsed}s] RSS: ${(rss / 1024 / 1024).toFixed(1)} MB  ` +
    `heapUsed: ${(heapUsed / 1024 / 1024).toFixed(1)} MB  ` +
    `growth: +${((rss - startRss) / 1024 / 1024).toFixed(1)} MB`
  );
}, 500);

processAuditLog(inputPath, outputPath)
  .then(summary => {
    clearInterval(poller);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
    const { rss } = process.memoryUsage();
    console.log(`\nCompleted in ${elapsed}s`);
    console.log(`Peak-ish RSS at end: ${(rss / 1024 / 1024).toFixed(1)} MB`);
    console.log('Summary:', summary);
  })
  .catch(err => {
    clearInterval(poller);
    console.error('Pipeline failed:', err.message);
    process.exitCode = 1;
  });
