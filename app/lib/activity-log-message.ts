import type { ActivityActionType } from "@/app/activity-log";
import type { DealSnapshot } from "@/app/lib/activity-log-enrichment";

const TELEGRAM_NOTIFY_ACTIONS = new Set<ActivityActionType>([
  "login",
  "deal_created",
  "quote_sent",
  "deal_deleted",
]);

const TELEGRAM_ACTION_PHRASES: Record<
  ActivityActionType,
  string
> = {
  login: "התחבר למערכת",
  deal_created: "יצר עסקה חדשה",
  deal_updated: "עדכן עסקה",
  deal_deleted: "מחק עסקה",
  quote_sent: "שלח הצעת מחיר",
  view_as_changed: "שינה מצב צפייה",
};

const currency = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export function shouldNotifyTelegram(actionType: ActivityActionType): boolean {
  return TELEGRAM_NOTIFY_ACTIONS.has(actionType);
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

export function buildTelegramActivityMessage(input: {
  userName: string | null;
  actionType: ActivityActionType;
  snapshot?: DealSnapshot | null;
  createdAt?: Date;
}): string {
  const agentName = input.userName?.trim() || "משתמש";
  const actionPhrase = TELEGRAM_ACTION_PHRASES[input.actionType];
  const lines = ["פעילות CRM", "", agentName, actionPhrase];

  if (input.snapshot?.customer_name) {
    lines.push("", `לקוח: ${input.snapshot.customer_name}`);
  }

  if (input.snapshot?.car_model) {
    lines.push(`דגם: ${input.snapshot.car_model}`);
  }

  if (input.snapshot?.amount != null) {
    lines.push(currency.format(input.snapshot.amount));
  }

  lines.push("", formatTimestamp(input.createdAt ?? new Date()));

  return lines.join("\n");
}
