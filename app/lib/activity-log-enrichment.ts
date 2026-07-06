import type { ActivityNotificationContext } from "@/app/activity-log";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DealSnapshot = {
  customer_name: string | null;
  car_model: string | null;
  amount: number | null;
};

export function resolveDealAmount(
  financingAmount: number,
  vehiclePrice: number,
): number | null {
  if (financingAmount > 0) return financingAmount;
  if (vehiclePrice > 0) return vehiclePrice;
  return null;
}

export function snapshotFromContext(
  context?: ActivityNotificationContext | null,
): DealSnapshot | null {
  if (!context) return null;

  const hasData =
    Boolean(context.customer_name?.trim()) ||
    Boolean(context.car_model?.trim()) ||
    context.amount != null;

  if (!hasData) return null;

  return {
    customer_name: context.customer_name?.trim() || null,
    car_model: context.car_model?.trim() || null,
    amount: context.amount ?? null,
  };
}

export async function fetchDealSnapshot(
  supabaseAdmin: SupabaseClient,
  dealId: string,
): Promise<DealSnapshot | null> {
  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .select("customer_name, car_model, vehicle_price, financing_amount")
    .eq("id", dealId)
    .maybeSingle();

  if (error || !deal) {
    return null;
  }

  return {
    customer_name: deal.customer_name ?? null,
    car_model: deal.car_model ?? null,
    amount: resolveDealAmount(deal.financing_amount, deal.vehicle_price),
  };
}

export async function resolveActivitySnapshot(
  supabaseAdmin: SupabaseClient,
  dealId: string | null | undefined,
  context?: ActivityNotificationContext | null,
): Promise<DealSnapshot | null> {
  if (dealId) {
    const fromDeal = await fetchDealSnapshot(supabaseAdmin, dealId);
    if (fromDeal) return fromDeal;
  }

  return snapshotFromContext(context);
}
