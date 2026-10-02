import { tracedFunction } from './instrumentation.js';

export const createUser = tracedFunction('createUser', ({ email }) => email,
  async ({ email, repository, sendEmail, scenario = 'storage' }) => {
    const result = await repository.saveUser(email);
    if (scenario !== 'storage') await sendEmail(email, { fail: scenario === 'http-failure' });
    return result;
  },
);
