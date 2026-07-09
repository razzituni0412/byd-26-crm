import { supabase } from "@/app/supabase";

export type ActivityActionType =
  | "login"
  | "deal_created"
  | "deal_updated"
  | "deal_deleted"
  | "quote_sent"
  | "view_as_changed";

export type ActivityLogEntry = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  action_type: ActivityActionType;
  description: string;
  deal_id: string | null;
  created_at: string;
};

export const ACTIVITY_ACTION_LABELS: Record<ActivityActionType, string> = {
  login: "התחברות",
  deal_created: "עסקה חדשה",
  deal_updated: "עדכון עסקה",
  deal_deleted: "מחיקת עסקה",
  quote_sent: "שליחת הצעה",
  view_as_changed: "צפייה כמשתמש",
};

/** Business-friendly activity log row returned by the admin API for display. */
export type ActivityLogDisplayEntry = {
  id: string;
  user_name: string | null;
  action_type: ActivityActionType;
  description: string;
  created_at: string;
  customer_name: string | null;
  car_model: string | null;
  amount: number | null;
};

export type ActivityNotificationContext = {
  customer_name?: string | null;
  car_model?: string | null;
  amount?: number | null;
};

export type LogActivityInput = {
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  actionType: ActivityActionType;
  description: string;
  dealId?: string | null;
  notificationContext?: ActivityNotificationContext | null;
};

export async function logActivity(
  input: LogActivityInput,
  accessToken?: string,
): Promise<void> {
  try {
    let token = accessToken;
    if (!token) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      token = session?.access_token;
    }

    if (!token) {
      console.warn("activity log skipped: no session");
      return;
    }

    const response = await fetch("/api/activity-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      console.warn("activity log insert failed:", await response.text());
    }
  } catch {
    // Fire-and-forget: logging must not block user actions.
  }
}
