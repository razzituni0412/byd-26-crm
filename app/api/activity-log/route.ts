import type { ActivityActionType, LogActivityInput } from "@/app/activity-log";
import { notifyTelegramForActivity } from "@/app/lib/activity-log-notify";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const VALID_ACTION_TYPES = new Set<ActivityActionType>([
  "login",
  "deal_created",
  "deal_updated",
  "deal_deleted",
  "quote_sent",
  "view_as_changed",
]);

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey, serviceRoleKey };
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getSupabaseEnv();
  if (!env) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: LogActivityInput;
  try {
    body = (await request.json()) as LogActivityInput;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.actionType || !VALID_ACTION_TYPES.has(body.actionType)) {
    return Response.json({ error: "Invalid action type" }, { status: 400 });
  }

  if (!body.description?.trim()) {
    return Response.json({ error: "Description is required" }, { status: 400 });
  }

  const supabaseAdmin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error: insertError } = await supabaseAdmin.from("activity_logs").insert({
    user_id: user.id,
    user_name: body.userName?.trim() || null,
    user_email: body.userEmail ?? null,
    action_type: body.actionType,
    description: body.description.trim(),
    deal_id: body.dealId ?? null,
  });

  if (insertError) {
    console.warn("activity log insert failed:", insertError.message);
    return Response.json({ error: "Failed to log activity" }, { status: 500 });
  }

  await notifyTelegramForActivity({
    supabaseAdmin,
    userName: body.userName?.trim() || null,
    actionType: body.actionType,
    dealId: body.dealId ?? null,
    notificationContext: body.notificationContext ?? null,
  });

  return Response.json({ ok: true });
}
