export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    details === undefined ? (this.details = undefined) : (this.details = details);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
