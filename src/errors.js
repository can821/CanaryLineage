export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function storageError(error) {
  if (error.code === '23505') {
    return new AppError(409, 'CANARY_EXISTS', 'This canary is already stored. Generate a new canary.');
  }
  return new AppError(503, 'STORAGE_UNAVAILABLE', 'Persistence could not be confirmed. Check the PostgreSQL connection and db:init.');
}
