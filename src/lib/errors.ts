import { NextResponse } from "next/server";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 400,
    code: string = "BAD_REQUEST",
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Requested resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Too many requests. Please slow down.") {
    super(message, 429, "RATE_LIMITED");
  }
}

/**
 * Standardized API Error Handler.
 * Formats any thrown exception into a structured JSON response
 * and guards against leaking sensitive internal details.
 */
export function handleApiError(error: unknown): NextResponse {
  // Known custom AppError
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.statusCode }
    );
  }

  // Supabase PostgrestError (shape: { message, code, details, hint })
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    const pgError = error as { code: string; message: string };
    console.error("[DatabaseError]", pgError);

    // Map common PostgreSQL codes
    if (pgError.code === "23505") {
      return NextResponse.json(
        { error: "A record with this identifier already exists.", code: "DUPLICATE_KEY" },
        { status: 409 }
      );
    }
    if (pgError.code === "PGRST116") {
      return NextResponse.json(
        { error: "Resource not found.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "A database error occurred. Please try again.", code: "DATABASE_ERROR" },
      { status: 500 }
    );
  }

  // Standard JavaScript Error
  if (error instanceof Error) {
    console.error("[UnhandledException]", error);
    return NextResponse.json(
      {
        error: error.message || "An unexpected error occurred.",
        code: "INTERNAL_SERVER_ERROR",
      },
      { status: 500 }
    );
  }

  // Fallback for non-Error throws
  console.error("[UnknownError]", error);
  return NextResponse.json(
    {
      error: "An unexpected internal error occurred.",
      code: "UNKNOWN_ERROR",
    },
    { status: 500 }
  );
}
