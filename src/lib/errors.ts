/**
 * Error message sanitization utilities.
 *
 * In production, raw error messages must never be returned to HTTP clients —
 * they can leak internal implementation details, file paths, database schemas,
 * service names, and other operational intelligence useful to attackers.
 *
 * In development, the full message is preserved so engineers can debug quickly.
 *
 * Usage:
 *   return NextResponse.json(
 *     { error: safeErrorMessage(err) },
 *     { status: 500 }
 *   );
 */

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * safeErrorMessage — return a sanitized error string suitable for HTTP responses.
 *
 * - Production: always returns the generic fallback string (default: "Internal server error")
 * - Development: returns the actual error message for fast debugging
 *
 * @param err       The caught error (any type — mirrors what catch blocks receive)
 * @param fallback  Generic message to show in production (optional override)
 */
export function safeErrorMessage(
  err: unknown,
  fallback = "Internal server error"
): string {
  if (IS_PRODUCTION) {
    return fallback;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
