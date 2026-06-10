/**
 * generateFixture.js
 *
 * Generates a sample NDJSON fixture file for manual smoke testing.
 * Writes to scripts/output/sample-audit.ndjson by default.
 *
 * Usage:
 *   node scripts/generateFixture.js [numRecords] [outputPath]
 *
 * Defaults: 200,000 records -> scripts/output/sample-audit.ndjson
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NUM_RECORDS = parseInt(process.argv[2] ?? '200000', 10);
const OUT_DIR     = path.resolve(__dirname, 'output');
const OUT_FILE    = process.argv[3] ?? path.join(OUT_DIR, 'sample-audit.ndjson');

const SIGNALS = [
  'ANS_SUB', 'TAB_SW', 'PROC_START', 'PROC_END',
  'KS_BURST', 'COPY_EVT', 'PASTE_EVT', 'WIN_BLUR',
  'WIN_FOCUS', 'SESS_END',
];

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const ws = fs.createWriteStream(OUT_FILE);

const BATCH = 5000;
let i = 0;

function writeBatch() {
  let ok = true;
  while (i < NUM_RECORDS && ok) {
    const record = JSON.stringify({
      sessionId:   `sess-${Math.floor(i / 50)}`,
      candidateId: `cand-${i % 500}`,
      signal:      SIGNALS[i % SIGNALS.length],
      ts:          Date.now() + i,
      rawIp:       `10.0.${Math.floor(i / 256) % 256}.${i % 256}`,
      payload:     { seq: i, value: Math.random() },
    });
    // Inject a malformed line every 1000 records to test resilience
    if (i > 0 && i % 1000 === 0) {
      ok = ws.write('MALFORMED_LINE_' + i + '\n');
    } else {
      ok = ws.write(record + '\n');
    }
    i++;
  }

  if (i < NUM_RECORDS) {
    ws.once('drain', writeBatch);
  } else {
    ws.end(() => {
      console.log(`Fixture written: ${OUT_FILE} (${NUM_RECORDS} records, ~${Math.floor(NUM_RECORDS / 1000)} malformed lines)`);
    });
  }
}

writeBatch();
