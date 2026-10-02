# Instrumented request → two system boundaries

```text
traceRequest (validate + AsyncLocalStorage.run)
  → POST /api/signup handler
    → tracedFunction(createUser)
      ├─ repository.saveUser → SQL transaction / demo memory
      └─ sendMockEmail → instrumented POST → local mock HTTP listener
    → repository.finishTrace → final document
  → response + tree viewer
  → compare two saved traces → added / removed / unchanged destinations
```

## Context and relationships

Stage 2's `AsyncLocalStorage` architecture is preserved. `run()` scopes trace and parent event IDs across Promise/timer chains. Each traced service gets a child scope; sibling async services do not overwrite each other's parent. HTTP input and service wrappers are reusable. The SQL adapter and local HTTP client observe boundaries without receiving a trace argument from business code.

Parent links express call context. Storage and HTTP are siblings under `createUser()` and run sequentially. The browser event is a client report, not a proven server observation; it is rendered as a separate source node. UI and readable text use the actual parent IDs, not a fabricated linear sequence.

`schemaVersion: 1` retains existing fields. IDs are trace UUID + monotonically increasing sequence. Types, parent links, status and safe metadata support tree rendering. UUIDs/timestamps/durations naturally vary. HTTP_INPUT success means receipt/validation succeeded; FUNCTION success means the awaited service completed; these are not a global request-success flag.

## Storage protocol

Initial save: users row + pending lineage document in one transaction. `RETURNING email` must match the canary. `COMMIT` confirms the DB boundary. The mock HTTP call follows outside the DB transaction, avoiding an open transaction during network waits.

Final save: separate parameterized UPDATE sets the trace to completed/failed with all observations. Failure after successful storage does not alter that boundary's success. A finalization error produces a Trace store ERROR and a failure response, preserving evidence. `traceSaved` reports whether the exact final trace was written. Requests failing before initial persistence return response-only traces.

No cross-system atomicity is claimed. A crash between initial and final saves leaves a pending trace. A COMMIT transport error is uncertain and labeled unconfirmed. HTTP failure/timeout cannot guarantee the receiver did not process a request. There are no automatic retries or idempotency promises. PostgreSQL integration and process-restart persistence passed in normal macOS Terminal, as reported by the owner on 1 October 2026. Work remains unable to start PostgreSQL because of its sandbox.

## HTTP boundary

`createMockEmailClient()` validates a fixed plain `http://127.0.0.1:<port>` origin. The API never accepts destination URLs. The client wraps real fetch, allows no redirects, aborts after two seconds, cancels the response body, and records only method/destination/path/status/duration/safe failure category. Payload is the validated synthetic email; no headers or response bodies enter traces.

`startMockServer()` uses an ephemeral loopback port, accepts only synthetic canaries, returns 204 or a deliberate 503, and stores nothing. Both listeners close on application shutdown. The mock shares a process but is reached through a genuine HTTP connection.

## Tests and bounds

Thirty-six core tests use real HTTP sockets where relevant, including barrier-forced concurrent requests, mixed success/failure branches, timer/Promise context preservation, SQL contracts and partial failures. Real PostgreSQL tests use an isolated random schema and a fresh Node process to read persisted traces. They are not replaced by mocks.

Memory-demo caps initial traces at 500; finalization updates existing entries only. PostgreSQL retention remains manual. No added dependencies, cloud infrastructure, multi-framework support, automatic scanning or full taint analysis. This instrumented exact-match prototype relates to lineage/taint analysis without implementing a general taint engine.

Reference: [Node.js async context documentation](https://nodejs.org/api/async_context.html).

## Destination comparison

`src/comparison.js` is a pure set comparison. The API reads both saved documents through the existing repository interface, validates UUIDs (400), reports missing traces (404), and returns sorted added/removed/unchanged sinks without mutating either trace. Empty destination sets are valid.

Storage key: `[STORAGE_WRITE, table, column, operation]`. HTTP key: `[HTTP_OUTPUT, destination, method, sinkPath]`, with legacy fallback to path and explicit normalization of the mock failure route. Logical service identity intentionally ignores the mock's ephemeral port. Storage identity is logical, not a physical database identifier; original storage modes and trace statuses remain in the response.

The engine ignores event order, duplicate observations, value, timestamps, duration and result status. Failed attempts remain observed destinations; a missing event is not proof that an external system stopped receiving data. The UI keeps the original trace viewer primary and adds a compact three-column result, stacked on mobile. No new dependencies or graph-diff framework.
