import { AppError } from './errors.js';

// Only synthetic values are accepted: this demo does not collect real addresses.
const CANARY = /^canary\+[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@example\.test$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateSubmission(body) {
  if (!body || typeof body.email !== 'string' || !CANARY.test(body.email)) {
    throw new AppError(400, 'INVALID_CANARY', 'Provide a synthetic address in the form canary+<UUID v4>@example.test.');
  }
  const browser = body.browserEvent;
  if (browser !== undefined && (
    !browser || browser.value !== body.email || typeof browser.occurredAt !== 'string' ||
    browser.occurredAt.length > 40 || !Number.isFinite(Date.parse(browser.occurredAt))
  )) {
    throw new AppError(400, 'INVALID_BROWSER_EVENT', 'The browser event must contain the same canary value and a valid timestamp.');
  }
  const scenario = body.scenario ?? 'storage';
  if (!['storage', 'http', 'http-failure'].includes(scenario)) {
    throw new AppError(400, 'INVALID_SCENARIO', 'Invalid demo scenario.');
  }
  return { email: body.email, browserEvent: browser, scenario };
}
