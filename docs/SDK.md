# Runtime SDK — v0.2.0 alpha

The additive SDK reuses v0.1's AsyncLocalStorage and event recorder. The original Express demo, repository transaction protocol and schema-v1 trace API remain unchanged. SDK traces use schemaVersion 2. The existing browser console still displays the schema-v1 demo; it does not yet import/render SDK traces.

## Local installation / import

The package stays `private: true`; nothing is published to npm. To use an existing checkout in another Node application: `npm install /path/to/CanaryLineage`, then import from `canary-lineage`. Within the checkout see `examples/sdk-demo.js`.

```js
import { createHash } from 'node:crypto';
import { createCanaryLineage, memoryTraceStore } from 'canary-lineage';

const lineage = createCanaryLineage({
  serviceName: 'users', storage: memoryTraceStore(), failureMode: 'strict',
});
const { result, trace, traceSaved } = await lineage.run({
  synthetic: true,
  canaries: [
    { label: 'email', value: 'canary@example.test' },
    { label: 'customer', value: 'synthetic-customer-1' },
  ],
}, ([email, customer]) => lineage.span('register', [email, customer], async () => {
  const value = createHash('sha256').update(email.value).digest('hex');
  const hash = lineage.derive({ parents: [email], value, label: 'email-sha256', operation: 'sha256' });
  // After your actual instrumented operation, record its controlled value:
  lineage.observe({ type: 'HTTP_OUTPUT', location: 'example-mail', canaries: [hash],
    metadata: { destination: 'example-mail', method: 'POST', path: '/send' } });
  return value;
}));
```

`derive` records an explicitly declared relationship; it does not compute, reverse or verify the named transformation. The example observation above does not send HTTP. The real PostgreSQL integration fixture sends the derived hash across a real localhost HTTP socket.

## Contracts

- `run({synthetic:true,canaries}, callback)` supplies immutable handles and returns `{result, trace, traceSaved}`. Explicit opt-in is developer acknowledgement, not a PII detector. Labels are unique per trace, values are controlled strings. Callback exceptions remain the original exceptions; the failed trace is saved if storage is configured/available.
- `span(name, handles, callback)` adds a FUNCTION parent for nested observations; sibling branches retain their own parent. Always await instrumented work; detached/fire-and-forget work is unsupported.
- `derive({parents,value,label,operation,description?})` registers a derived handle, parent canary IDs, operation and TRANSFORMATION event. Multiple parents are allowed. A rejected derivation in open mode returns null; retain the application's computed value independently.
- `observe({type,location,canaries,metadata?,status?})` supports FUNCTION, HTTP_INPUT, HTTP_OUTPUT, DATABASE_WRITE and DATABASE_READ. Returns immutable event ID, or null for rejected instrumentation in open mode. Metadata is developer-selected JSON: never supply SQL parameters, headers, credentials or full payloads.
- A handle belongs to one active SDK execution only. Passing another execution's handle is rejected, even if its value matches. Identical values may have distinct identities/labels.
- Store contract: `mode`, `async saveTrace(document)` (resolve on save, throw on failure), `async getTrace(id)` (snapshot or null). Memory store caps at 500 traces; it is volatile. `postgresTraceStore(pool)` stores snapshots in its separate `canary_sdk_traces` table after explicit `initialize()`.

Schema-v2 trace: id, serviceName, storage, status, startedAt/finishedAt, canaries, events, diagnostics, incomplete. Canary: id, label, category, value, parentCanaryIds, operation, depth. Event retains id/parentId/sequence/type/location/status/time/evidence/metadata and adds serviceName + canaryIds; values live in the canary registry, not repeated in every event. This stores synthetic values including derived values, not arbitrary payloads.

## Explicit PostgreSQL reads/writes

```js
import { postgresAdapter } from 'canary-lineage/postgres';
const db = postgresAdapter({ pool, lineage, maxRows: 1000 });
const result = await db.query({
  query: { text: 'SELECT email_hash FROM example WHERE id = $1', values: [id] },
  operation: 'SELECT', table: 'example', column: 'email_hash',
  canaries: [hash],
});
```

The mapping is developer-supplied. Only returned field values exactly matching supplied handles produce observations. For INSERT/UPDATE use `RETURNING`; no returned match means no value observation. SQL/parameters are not copied into trace metadata. Query exceptions propagate normally, without an invented successful event. Query success does not prove a surrounding caller-owned transaction committed. The adapter neither parses SQL nor discovers stored identities across requests. A saved trace preserves identity evidence; automatic cross-request restoration is deferred.

## Comparison

`compareTraces(before, after)` compares overall destination sets. Pass `{canaryLabel:'email-sha256'}` for that exact label in both schema-v2 executions; unknown labels throw. This filters the selected identity, not its entire ancestry. DATABASE_READ is a source observation, not an outgoing sink. Existing storage/HTTP identity normalization is unchanged. Timing, instance IDs, duplicates and transient status remain ignored. Incomplete traces may omit destinations: never treat absence as proof of no flow.

## Failure and bounds

Default `failureMode:'open'`: invalid in-context observations, exceeded budgets and trace-store failures mark incomplete evidence; application callbacks still run. `'strict'` surfaces instrumentation errors. Config/input errors and calls outside an owned active context always throw. Business errors are never swallowed or replaced by store errors. Storage calls are awaited and may delay the caller; custom stores must provide their own timeout. No background queue is used.

Defaults: 1000 events, 64 canaries, transformation depth 16, 4096 bytes per value, 2048 bytes per metadata object; diagnostics cap at 8. `postgresAdapter` inspects up to maxRows and records ROW_INSPECTION_LIMIT if truncated. Driver result allocation is outside that inspection bound. Every limit is positive and configurable. Rejected derivations do not leave orphan canaries. Limits are scoped to schema-v2 SDK traces, not retroactively imposed on schema-v1.

## Deferred scope

No cross-service/queue propagation, SDK Express middleware, cross-request identity restoration, policy/CI CLI, semantic graph diff, OpenTelemetry, SQLite or SDK trace UI. Service names identify the current SDK, not a distributed tracing protocol. There is no claim that these planned capabilities are implemented.
