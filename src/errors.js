export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function storageError(error) {
  if (error.code === '23505') {
    return new AppError(409, 'CANARY_EXISTS', 'Bu canary zaten kaydedildi. Yeni bir canary üret.');
  }
  return new AppError(503, 'STORAGE_UNAVAILABLE', 'Kayıt doğrulanamadı. PostgreSQL bağlantısını ve db:init adımını kontrol et.');
}
