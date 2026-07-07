import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function isTransientAuthNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return true;
  }

  if (typeof error === "object" && error !== null) {
    const err = error as { name?: string; message?: string; status?: number | null };
    if (err.name === "AuthRetryableFetchError") return true;
    if (
      err.message === "Failed to fetch" &&
      (err.status === 0 || err.status == null)
    ) {
      return true;
    }
  }

  return false;
}

export function isInvalidAuthSessionError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const err = error as { name?: string; status?: number | null };
    if (err.name === "AuthSessionMissingError") return true;
    if (err.name === "AuthApiError" && (err.status === 401 || err.status === 403)) {
      return true;
    }
  }

  return false;
}

function isSupabaseAuthRefreshRejection(reason: unknown): boolean {
  if (isInvalidAuthSessionError(reason)) {
    return false;
  }

  if (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: string }).name === "AuthRetryableFetchError"
  ) {
    return true;
  }

  if (!isTransientAuthNetworkError(reason)) {
    return false;
  }

  const stack =
    reason instanceof Error
      ? reason.stack ?? ""
      : typeof reason === "object" && reason !== null && "stack" in reason
        ? String((reason as { stack?: string }).stack ?? "")
        : "";

  return stack.includes("@supabase/auth-js") || stack.includes("supabase_auth-js");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    if (!isSupabaseAuthRefreshRejection(event.reason)) {
      return;
    }

    console.warn(
      "Supabase auth refresh network failure (transient, will retry):",
      event.reason,
    );
    event.preventDefault();
  });
}
