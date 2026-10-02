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
