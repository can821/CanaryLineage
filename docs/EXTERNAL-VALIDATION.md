# Independent application validation

Upstream: https://github.com/typicode/json-server — MIT, v0.17.4, commit `78ea71375666d49145734689c097654c54f90686`.

Verified on macOS arm64 / Node 24.19.0 with npm. JSON Server is an independently developed Express 4 REST prototyping application using lowdb. This is interoperability evidence, not customer production validation or a PostgreSQL external-app test.

```sh
git clone --branch v0.17.4 --depth 1 https://github.com/typicode/json-server.git /tmp/canary-json-server
# Verify HEAD matches the SHA above; inspect package.json/scripts before installing.
cd /tmp/canary-json-server
npm install --ignore-scripts --omit=dev --no-audit --no-fund
cd /path/to/canary-lineage
node examples/external/json-server.js /tmp/canary-json-server
```

The reviewed upstream prepare/prepublish/postversion scripts were NOT run. Source modules are CommonJS and can be loaded directly without the build. No credentials were supplied, all servers bound to loopback, file data was temporary and removed. Upstream source changes: zero. Dependency resolution is from upstream's lockfile where available; this test does not certify upstream dependencies as secure.

The adapter uses public middleware/render hooks. It explicitly adds an email hash transformation and an outbound archive call after verifying the actual upstream CRUD/file write. A separate archive process restores lineage; the regression adds a local analytics destination. These extra boundaries are supplied by the adapter and are not claimed as original upstream features. This proves after-the-fact integration, not universal auto-instrumentation.

Actual results: 2 correlated service segments per request, persisted hash read back from a real JSON file, baseline PASS / CLI 0, regression FAIL / CLI 1, NEW_PATH and NEW_DESTINATION detected. Redacted bundles, diff, policy and machine-readable validation output are generated under `.local/external-validation`.
