import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const MANAGEMENT_ROLES = new Set(["admin", "admin_agent"]);

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

  const { data: roleRow, error: roleError } = await supabase
    .from("roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    return Response.json({ error: "Failed to verify role" }, { status: 500 });
  }

  const role = roleRow?.role ?? "agent";

  if (!MANAGEMENT_ROLES.has(role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabaseAdmin.auth.admin.listUsers();

  if (error) {
    return Response.json({ error: "Failed to load users" }, { status: 500 });
  }

  const users = (data.users ?? [])
    .filter((authUser) => authUser.email)
    .map((authUser) => ({
      id: authUser.id,
      email: authUser.email as string,
    }))
    .sort((a, b) => a.email.localeCompare(b.email, "he"));

  return Response.json({ users });
}
