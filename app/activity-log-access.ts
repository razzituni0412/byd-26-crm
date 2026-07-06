/**
 * Server-only activity log authorization.
 * Import this module from API routes only — never from client components.
 */

const ACTIVITY_LOG_VIEWER_USER_ID =
  process.env.ACTIVITY_LOG_VIEWER_USER_ID?.trim() ??
  "0209122d-9162-4119-8c1d-b9edebaa31a2";

export function canViewActivityLogs(userId?: string | null): boolean {
  return Boolean(
    ACTIVITY_LOG_VIEWER_USER_ID && userId && userId === ACTIVITY_LOG_VIEWER_USER_ID,
  );
}
