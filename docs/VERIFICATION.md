# v0.3.0 verification — 2026-10-04

- macOS arm64 / Apple M5, Node 24.19.0; temporary real PostgreSQL 17.10.
- `npm run verify`: syntax passed; 55 tests passed, 0 failed, 0 skipped.
- `npm run verify:postgres -- --temporary`: passed all three integration files, including distributed PostgreSQL persistence and policy regression. No memory fallback.
- `npm run demo:distributed` and `npm run check:regression`: real local multi-process HTTP baseline PASS/exit 0 and analytics regression FAIL/exit 1.
- `npm run benchmark:distributed`: completed. HTTP SDK disabled p50/p95/p99 4.939/7.562/9.701 ms; enabled 5.161/6.108/10.330 ms. 100 sequential samples each, 10 warmups. Different percentile directions reflect noise/order effects; this does not establish a performance improvement. No PostgreSQL in benchmark; IPC evidence collection included.
- Queue: delayed concurrent jobs restored in a separate worker process, followed by actual loopback HTTP. No vendor broker tested.
- Node 22/24 Linux CI configured, not locally tested and not claimed remotely successful.
- Distributed web UI, OTel and external project validation remain unimplemented.

## Previous verification records (historical)

# V1 verification — 1 October 2026

**V1 scope complete, package v0.1.0. PostgreSQL VERIFIED via owner-reported normal macOS Terminal execution.**

## Real PostgreSQL evidence and provenance

The project owner reported these exact results from the repository's real `verify:postgres` workflow in normal macOS Terminal:

```text
PASS: real PostgreSQL connection.
PASS: real schema + INSERT + trace retrieval + HTTP + transactions + writer process exit + fresh reader process.
```

The integration exercises a real schema, user INSERT, persisted trace retrieval, HTTP success/failure, transaction rollback, duplicate races and isolated concurrent requests. A writer Node application process exits before a fresh reader process retrieves its trace. This is persistence beyond one application process. It does not claim a PostgreSQL server restart, production load testing or remote CI success.

**Provenance:** successful execution was performed by the owner, not by Work. Work reviewed the workflow and recorded the supplied PASS output; it did not independently repeat a successful real PostgreSQL run. Database adapter, schema and integration workflow are unchanged in this final sprint.

## Work validation of final V1

- `npm run verify`: JavaScript syntax checks and **36/36 core tests passed**, zero skipped or failed.
- Coverage: async context and overlapping requests, sibling parent isolation, synthetic value integrity, real loopback HTTP 204/503/timeout, partial failure, SQL contracts, finalization errors and safe metadata.
- Seven comparison tests cover additions/removals, logical storage identity, duplicate/order/time/duration/status invariance, HTTP paths, empty sink sets, invalid or missing IDs, unavailable storage and real request-produced trace pairs.
- Three local verification guard tests cover missing configuration/binaries and refusal of remote URLs without credential disclosure.
- Browser demonstration in explicitly labeled memory-demo mode: storage-only A, storage+HTTP B, independent storage-only C. A→B adds mock-email-service; B→A removes it; A→C has no changes. Saved trace reload succeeded.
- A: `296af266-d3b4-412a-ae9b-440e3708187b`; B: `a31731d1-c7c5-4ae9-a64c-384d083e24e3`; C: `2ed84180-9507-49ba-b242-c585d517ddcf`.
- Browser console error list empty. Document width equals viewport at 1280px and 390px; no horizontal overflow. Existing graphite trace view preserved, compact comparison section added.
- No new dependencies or framework, no actual email/third-party API, no external publication. CI configuration retains PostgreSQL 17 plus both test suites; remote CI has not run.

## Historical environment limitation

On 30 September the core had 26 passing tests; real PostgreSQL execution was not yet verified. On 1 October Work located existing PostgreSQL 17.10 binaries. Default initdb and one mmap configuration attempt both failed at `shmget` (56 bytes) with `Operation not permitted`; the temporary directories were removed. No global settings or software installations were made. This is a Work sandbox limitation, superseded as an integration-status gap by the owner's successful normal-Terminal run above.

## Reproduce

```sh
npm run verify
npm run verify:postgres  # Requires local TEST_DATABASE_URL in .env
# Or use existing binaries without a persistent database setup:
PG_BIN="/path/to/postgresql/bin" npm run verify:postgres -- --temporary
```

See [local workflow](POSTGRES_LOCAL.md). Memory-demo remains ephemeral and is never described as PostgreSQL. Failed HTTP does not undo an earlier database commit. Destination comparison counts observed attempts, not guaranteed delivery or privacy violations.


## 4 October 2026 — v0.2 SDK alpha

This run independently executed the existing isolated real PostgreSQL workflow with elevated execution permission; both original integration and new SDK integration passed. This supersedes the earlier sandbox-only execution limitation for this run, without rewriting the provenance of earlier owner-reported evidence. No system settings/installations changed.

New real flow: synthetic email → explicit SHA-256 derive → PostgreSQL INSERT RETURNING → SELECT of the same derived hash → actual localhost HTTP sink; received hash matches and all observations reference the derived identity. SDK snapshot persisted and retrieved through a fresh PostgreSQL connection. Original integration separately retains the writer-process exit/fresh-reader-process persistence check. No SDK distributed service or cross-request restoration claim.

Benchmark (Node 24.19.0, one local run, 200 warmup + 2000 sequential samples each, one event, no sockets/DB/store): baseline p50 0.000083 ms, p95 0.000125 ms; SDK p50 0.005292 ms, p95 0.007625 ms. Approximate p50 increment 0.005209 ms. Throughput 4,669,264 baseline vs 156,085 SDK operations/s. Heap delta −437,896 vs +388,520 bytes; GC makes this noisy, not retained-memory measurement. Not production RPS, HTTP latency, or PostgreSQL write-overhead evidence. Reproduce with npm run benchmark:sdk.

Final regression: 43 core tests passed, 0 failed, 0 skipped; syntax checks passed. Two real PostgreSQL integration tests passed through the isolated temporary workflow. SDK example and npm package dry-run checked. Browser UI was not changed in v0.2; no new UI or distributed feature is claimed.
