// Error Types

export class GameError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "GameError";
  }
}

export class ValidationError extends GameError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends GameError {
  constructor(message: string, details?: unknown) {
    super(message, "AUTHORIZATION_ERROR", 403, details);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends GameError {
  constructor(message: string, details?: unknown) {
    super(message, "NOT_FOUND", 404, details);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends GameError {
  constructor(message: string, details?: unknown) {
    super(message, "RATE_LIMIT_EXCEEDED", 429, details);
    this.name = "RateLimitError";
  }
}
