# Security model

CanaryLineage is for controlled synthetic test values, not production PII or secrets. `synthetic:true` is an explicit developer acknowledgement, not automatic classification. Derived values remain test data and may be persisted in trace documents.

Instrumentation is explicit and metadata is developer-supplied. Do not pass credentials, raw SQL parameters, headers or full payloads. The PostgreSQL adapter records logical column mappings and matching known identities, not SQL text. It cannot prove that developer-supplied mappings or transformation names are truthful.

The demo binds to localhost, has no authentication, and is not suitable for public hosting. SDK open mode preserves application execution on supported instrumentation failures and marks evidence incomplete; strict mode can fail an operation after its side effects. Neither mode provides transaction rollback across external systems. Custom stores must bound their own I/O and protect persisted test data.

This project is not a security scanner, malware sandbox, full taint engine or compliance guarantee. Please avoid posting real credentials or personal data in issues or trace examples.

## Distributed alpha

Propagation is explicit and unauthenticated. Accept only trusted peers. Bundle checksums detect corruption, not forgery. Application bodies and developer-supplied labels/metadata remain the caller's responsibility. See [distributed boundaries](docs/DISTRIBUTED.md).
