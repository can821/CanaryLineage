# Distributed lineage v0.4 — advanced alpha

## Run

Trace schemas 1/2/3 and bundle version 1 are supported; unknown versions are rejected. Propagation supports unsigned protocol 1 and optional signed envelope 2.

Node >=22.9 is required (local verification uses Node 24).

```sh
npm ci
npm run demo:distributed
npm run check:regression
node src/cli.js inspect .local/distributed-demo/current.json
node src/cli.js compare .local/distributed-demo/baseline.json .local/distributed-demo/current.json --policy .local/distributed-demo/policy.json --json
node src/cli.js verify .local/distributed-demo/current.json
npm run benchmark:distributed
npm run verify:postgres -- --temporary
```

The regression comparison intentionally exits 1. Exit codes: 0 success/warning, 1 policy failure, 2 usage/configuration, 3 invalid input, 4 internal failure. `export <trace>` writes a redacted bundle to stdout. CLI inputs are regular JSON files limited to 2 MiB. `--debug` exposes diagnostic stacks. Local installation provides `canarylineage`; nothing is published to npm.

## Architecture and integration

`examples/distributed-fixture.js` starts users and processor in separate Node processes and a local analytics sink; the caller is gateway. Explicit lowercase and SHA-256 derivations cross real HTTP boundaries. Baseline stops at processor; regression also reaches analytics. This standalone demo stores evidence in memory. Real PostgreSQL integration separately writes/reads values and persists gateway/users segments. Queue tests separately send delayed jobs to another process and observe its outbound HTTP. These are separate scenarios, not a combined broker/database demo.

Create the SDK with `distributed: true`, a stable `serviceName` and explicit `allowedOrigins`. Inside `sdk.run`, call `sdk.http({url,targetService,canaries,body})`. The receiver passes the propagation header into `run`, explicitly binds local labels/values, and sets `trusted: true` only after establishing peer trust. See `test/fixtures/distributed-service.js` for runnable integration.

`createJobContext({targetService,canaries})` creates context for an application-owned job envelope. Consume with `run({propagation,trusted:true,transport:'queue',synthetic:true,canaries}, callback)`. Producer context creation does not prove broker delivery. No vendor broker, acknowledgments, retry or cancellation protocol is supplied; the application owns delivery and deduplication.

Schema 3 uses random UUIDs for segments/events and propagates trace/canary IDs. Foreign parent events link segments. Stores key segments by trace and segment IDs; use `getSegments`. Old single-trace APIs and schema-1/2 documents remain supported.

`src/analysis` provides shared graph, semantic diff, policy and bundle functions. Diff ignores IDs/timestamps/order, with optional status comparison. Policies use exact logical destination names, not DNS filtering. Missing propagated segments, pending or truncated evidence cannot produce policy PASS. Complete refers only to supplied instrumented evidence, not whole-program coverage.

## Trust and limits

The version-1 `x-canary-lineage-context` header is bounded, validated base64url JSON containing identifiers and descriptors, not raw values. Unsigned mode is neither encrypted nor authenticated; optional HMAC mode is documented in [TRUST.md](TRUST.md). Establish peer trust yourself; the application owns request bodies. Origin allowlists, disabled redirects, timeouts and graph/header/ancestry budgets are safeguards, not a security perimeter. Open mode marks rejected context incomplete while allowing host work; strict mode throws. Host network errors are preserved.

Bundle SHA-256 checksums detect accidental corruption, not authorship. Raw values and unknown metadata are removed, but developer-supplied labels and allowed metadata must avoid secrets. Reordering serialized payload keys can invalidate the checksum.

## Limitations

The `/explorer.html` UI imports distributed bundles and uses the CLI graph/diff/policy core. The original single-service console remains available. No automatic taint tracking, OTel bridge, vendor queue,  production load certification or npm release is claimed. Linux Node 22/24 with PostgreSQL 17 CI is configured; local success does not prove remote CI ran. Benchmarks are one local sequential run, include IPC overhead for distributed collection, exclude PostgreSQL, and report GC-sensitive parent heap deltas rather than total process memory.
