/** An error that already knows which HTTP status and machine-readable code it maps to. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (resource: string, id: number) =>
  new ApiError(404, 'NOT_FOUND', `${resource} ${id} was not found`);

export const conflict = (code: string, message: string) => new ApiError(409, code, message);
