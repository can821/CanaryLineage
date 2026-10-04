# Propagation trust and evidence quality

Authentication is optional. Existing protocol-1 unsigned context still requires `trusted: true` at the receiving application boundary. It is reported as `unsigned`, never `verified`.

```js
const sdk = createCanaryLineage({
  serviceName: 'users', distributed: true,
  propagationAuthentication: {
    activeKeyId: '2026-10',
    keys: { '2026-10': process.env.CANARYLINEAGE_PROPAGATION_KEY },
    requireSigned: true,
    maxAgeMs: 300000
  }
});
```

Supply a random secret of at least 32 bytes via configuration/environment. Missing/weak keys fail configuration validation; no default key is installed. Do not commit keys. HMAC-SHA256 signs canonical sorted-key JSON including envelope version 2, key ID, issuance time and the complete protocol-1 context. Receivers compare signatures using `timingSafeEqual` and validate target service. No raw canary values or secrets are included in headers, graphs or exported bundles.

Signed contexts can be accepted without the unsigned `trusted` override. With `requireSigned`, unsigned incoming context is rejected. A root execution without incoming context is still allowed. Open mode continues application work as a new incomplete/untrusted trace; strict mode rejects. Host application failures retain their original error behavior.

Rotation: deploy old/new verification keys to receivers, switch sender `activeKeyId`, then remove the old key after in-flight contexts expire. At most 8 keys; default lifetime 5 minutes, configurable 1 second–24 hours, 30-second future-clock tolerance. Set queue lifetime consciously. Expiry limits age, but there is no replay cache. Shared-key holders can impersonate another service: this proves possession of a shared key, not PKI identity or authorization. It is NOT encryption.

## Recorded evidence states

- COMPLETE: all expected supplied instrumented evidence present.
- PARTIAL: missing segment/parent, pending event, instrumentation/storage failure.
- TRUNCATED: an event/inspection resource budget was reached.
- UNTRUSTED: incoming context was rejected and open mode continued.
- INVALID: malformed/unsupported input is rejected before graph construction (CLI 3 / explorer 400), not treated as an analyzable trace.

Completeness and trust are separate dimensions. Complete unsigned evidence remains possible when explicitly allowed, but `DENY_UNTRUSTED_PROPAGATION` rejects unsigned, rejected or legacy unknown trust. Incomplete evidence always fails policy evaluation conservatively; no new INDETERMINATE exit code is introduced.

Persisted trust fields report what the recorder verified at ingestion. An imported unsigned bundle cannot independently prove those claims. Bundles currently have corruption checksums only: SIGNATURE NOT PROVIDED. Checksum validation is NOT signature verification. Storage and bundle authors are trusted; no signed-bundle feature is claimed.
