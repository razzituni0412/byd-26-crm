import type { ActivityActionType, ActivityNotificationContext } from "@/app/activity-log";
import { resolveActivitySnapshot } from "@/app/lib/activity-log-enrichment";
import {
  buildTelegramActivityMessage,
  shouldNotifyTelegram,
} from "@/app/lib/activity-log-message";
import { isTelegramConfigured, sendTelegramMessage } from "@/app/lib/telegram";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function notifyTelegramForActivity(input: {
  supabaseAdmin: SupabaseClient;
  userName: string | null;
  actionType: ActivityActionType;
  dealId?: string | null;
  notificationContext?: ActivityNotificationContext | null;
}): Promise<void> {
  if (!isTelegramConfigured() || !shouldNotifyTelegram(input.actionType)) {
    return;
  }

  try {
    const snapshot = await resolveActivitySnapshot(
      input.supabaseAdmin,
      input.dealId,
      input.notificationContext,
    );

    const message = buildTelegramActivityMessage({
      userName: input.userName,
      actionType: input.actionType,
      snapshot,
    });

    await sendTelegramMessage(message);
  } catch (error) {
    console.warn(
      "telegram activity notify failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
