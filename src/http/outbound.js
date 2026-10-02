import { observe } from '../instrumentation.js';
import { AppError } from '../errors.js';

// Fixed loopback destination, never a user-supplied URL. Only synthetic email is sent.
export function createMockEmailClient(baseUrl, { timeoutMs = 2000 } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('Mock service must use a plain 127.0.0.1 HTTP origin.');
  }
  return async function sendMockEmail(email, { fail = false } = {}) {
    return tracedPost(new URL(fail ? '/mock-email/fail' : '/mock-email', base), email, { timeoutMs });
  };
}

// Reusable boundary wrapper. Metadata deliberately excludes bodies, headers and URLs with secrets.
async function tracedPost(url, email, { timeoutMs }) {
  const started = performance.now();
  const event = observe({ stage: 'http-output', location: 'POST mock-email-service', value: email, status: 'pending',
    metadata: { method: 'POST', destination: 'mock-email-service', origin: url.origin, path: url.pathname, sinkPath: '/mock-email' } });
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    event.metadata.httpStatus = response.status;
    // We need only acknowledgement, never keep or expose the response body.
    await response.body?.cancel();
    if (!response.ok) throw new Error('HTTP status rejected');
    event.status = 'success';
  } catch (error) {
    event.status = 'failed';
    event.metadata.failure = error.name === 'TimeoutError' ? 'timeout' : event.metadata.httpStatus ? 'http-status' : 'network';
    throw new AppError(502, 'HTTP_OUTPUT_FAILED', 'The local HTTP service could not complete the request. The earlier storage write is preserved.');
  } finally {
    event.metadata.durationMs = Math.round((performance.now() - started) * 100) / 100;
  }
}
