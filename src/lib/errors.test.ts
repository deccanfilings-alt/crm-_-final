import { describe, it, expect } from "vitest";
import {
  AppError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  handleApiError,
} from "./errors";

describe("Error Reliability Standards", () => {
  it("constructs AppError with defaults and custom details", () => {
    const err = new AppError("Invalid payload", 422, "UNPROCESSABLE_ENTITY", { field: "email" });
    expect(err.message).toBe("Invalid payload");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("UNPROCESSABLE_ENTITY");
    expect(err.details).toEqual({ field: "email" });
  });

  it("handles specialized error subclasses correctly", () => {
    const authErr = new UnauthorizedError();
    expect(authErr.statusCode).toBe(401);
    expect(authErr.code).toBe("UNAUTHORIZED");

    const forbidErr = new ForbiddenError();
    expect(forbidErr.statusCode).toBe(403);
    expect(forbidErr.code).toBe("FORBIDDEN");

    const notFound = new NotFoundError();
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe("NOT_FOUND");

    const conflict = new ConflictError();
    expect(conflict.statusCode).toBe(409);
    expect(conflict.code).toBe("CONFLICT");

    const rate = new RateLimitError();
    expect(rate.statusCode).toBe(429);
    expect(rate.code).toBe("RATE_LIMITED");
  });

  it("handleApiError formats AppError with status and code", async () => {
    const err = new ForbiddenError("Admin access only");
    const response = handleApiError(err);
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body).toEqual({
      error: "Admin access only",
      code: "FORBIDDEN",
    });
  });

  it("handleApiError maps Postgres duplicate key error (23505) to 409 Conflict", async () => {
    const pgError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "contacts_phone_key"',
    };
    const response = handleApiError(pgError);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.code).toBe("DUPLICATE_KEY");
  });

  it("handleApiError maps Postgrest no rows found (PGRST116) to 404 Not Found", async () => {
    const pgError = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    const response = handleApiError(pgError);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("handleApiError safely captures generic Error as 500", async () => {
    const err = new Error("Network timeout contacting Meta");
    const response = handleApiError(err);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error).toBe("Network timeout contacting Meta");
  });

  it("handleApiError handles non-Error primitive throws safely", async () => {
    const response = handleApiError("string exception");
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.code).toBe("UNKNOWN_ERROR");
  });
});
