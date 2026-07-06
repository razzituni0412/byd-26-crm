import { canViewActivityLogs } from "@/app/activity-log-access";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return Response.json(
      { error: "Server configuration error" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

  if (!canViewActivityLogs(user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 100, 1), 200);

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabaseAdmin
    .from("activity_logs")
    .select(
      "id, user_id, user_name, user_email, action_type, description, deal_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ error: "Failed to load activity logs" }, { status: 500 });
  }

  const logs = data ?? [];
  const dealIds = [
    ...new Set(logs.map((log) => log.deal_id).filter(Boolean)),
  ] as string[];

  const dealsById = new Map<
    string,
    {
      customer_name: string;
      car_model: string;
      vehicle_price: number;
      financing_amount: number;
    }
  >();

  if (dealIds.length > 0) {
    const { data: deals } = await supabaseAdmin
      .from("deals")
      .select("id, customer_name, car_model, vehicle_price, financing_amount")
      .in("id", dealIds);

    for (const deal of deals ?? []) {
      dealsById.set(deal.id, deal);
    }
  }

  const displayLogs = logs.map((log) => {
    const deal = log.deal_id ? dealsById.get(log.deal_id) : null;
    const amount = deal
      ? deal.financing_amount > 0
        ? deal.financing_amount
        : deal.vehicle_price
      : null;

    return {
      id: log.id,
      user_name: log.user_name,
      action_type: log.action_type,
      description: log.description,
      created_at: log.created_at,
      customer_name: deal?.customer_name ?? null,
      car_model: deal?.car_model ?? null,
      amount,
    };
  });

  return Response.json({ logs: displayLogs });
}
