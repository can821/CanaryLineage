import { createHash } from 'node:crypto';
import { createCanaryLineage, memoryTraceStore, compareTraces } from '../src/sdk/index.js';
const sdk = createCanaryLineage({ serviceName: 'sdk-example', storage: memoryTraceStore(), failureMode: 'strict' });
async function run(withHttp) {
  return sdk.run({ synthetic: true, canaries: [{ label: 'email', value: 'canary@example.test' }, { label: 'customer', value: 'synthetic-customer-1' }] }, ([email]) => sdk.span('register', [email], () => {
    const hash = sdk.derive({ parents: [email], label: 'email-sha256', operation: 'sha256', value: createHash('sha256').update(email.value).digest('hex') });
    // These are example observations, not actual database/network operations.
    sdk.observe({ type: 'DATABASE_WRITE', location: 'example.email_hash', canaries: [hash], metadata: { table: 'example', column: 'email_hash', operation: 'INSERT' } });
    if (withHttp) sdk.observe({ type: 'HTTP_OUTPUT', location: 'example-mail', canaries: [hash], metadata: { destination: 'example-mail', method: 'POST', path: '/send' } });
  }));
}
const baseline = await run(false);
const current = await run(true);
console.log(JSON.stringify({ exampleOnly: true, baseline: baseline.trace, current: current.trace, comparison: compareTraces(baseline.trace, current.trace, { canaryLabel: 'email-sha256' }) }, null, 2));
