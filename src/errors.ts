export type ErrorCode =
  | 'EMPTY_PAYLOAD'
  | 'UNKNOWN_ENCODING'
  | 'INVALID_HEX'
  | 'HEX_ODD_LENGTH'
  | 'INPUT_TOO_LARGE'
  | 'NOT_FOUND'
  | 'INVALID_INDEX'
  | 'INVALID_PREFIX_LENGTH'
  | 'INVALID_PAGINATION'
  | 'INVALID_LIMIT'
  | 'BATCH_ITEM_FAILED'
  | 'BAD_REQUEST';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
