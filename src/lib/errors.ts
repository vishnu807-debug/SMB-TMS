type PgError = { code?: string; message?: string; hint?: string; details?: string } | null | undefined;

/** Turns a Supabase/Postgres error into a message that is safe and useful to show users. */
export function userMessage(error: PgError): string {
  if (!error) return "Something went wrong.";
  // Business rules raised by our database functions (raise_business_error / P0001).
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "42501" || /permission denied|row-level security/i.test(error.message ?? ""))
    return "You do not have permission to perform this action.";
  if (error.code === "23505") return "This record already exists (a unique value is already in use).";
  if (error.code === "23503") return "This record is linked to other records and cannot be changed that way.";
  if (error.code === "23514") return "Some values are not allowed. Please check the form.";
  if (error.code === "22P02") return "One of the values is in the wrong format.";
  console.error("Unexpected database error", error);
  return "Something went wrong. Please try again or contact the administrator.";
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
