# Solution Steps

1. Implement `normaliseEvent` in `src/lib/normaliser.js` so it returns a new object, preserves existing fields, removes `rawIp`, adds `eventType` from `SIGNAL_MAP` with `UNKNOWN` as the fallback, and appends a `processedAt` ISO timestamp without mutating the input.

2. Create a streaming line-splitting helper in `src/lib/lineStream.js` by exporting a `Transform` stream that accumulates chunk data, emits one line at a time on `\n`, handles `\r\n`, and flushes any trailing partial line at the end of the stream.

3. Refactor `processAuditLog` in `src/pipeline/processAuditLog.js` to stop using `readFileSync`/`writeFileSync` and instead build a stream pipeline with `fs.createReadStream`, the line splitter transform, a record-processing transform, and `fs.createWriteStream`.

4. In the record-processing transform, count physical lines, ignore blank lines, increment `total` for each non-empty NDJSON record, parse JSON per line, and catch parse failures so malformed lines are skipped rather than aborting the entire run.

5. When a line cannot be parsed, write a structured warning JSON object to `stderr` that includes at least the line number and error message, increment `skipped`, and continue processing the rest of the file.

6. For valid parsed objects, call `normaliseEvent`, serialize the result back to NDJSON with a trailing newline, and increment `written`.

7. Use `stream/promises.pipeline(...)` so writable backpressure is handled automatically by Node streams rather than buffering the whole output in memory.

8. Wrap stream failures in a more meaningful error before rejecting, distinguishing common cases such as missing/unreadable input and unwritable output paths.

9. After the pipeline completes successfully, write the final summary object `{ total, written, skipped }` to `stderr` as JSON and return that same summary from `processAuditLog`.

10. Keep the public API unchanged, overwrite the destination file on each run, and verify the solution by running `node --test tests/pipeline.test.js` and the smoke script to confirm stable RSS growth.

