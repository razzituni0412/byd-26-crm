"use client";

import {
  type ActivityActionType,
  type ActivityLogDisplayEntry,
} from "@/app/activity-log";
import { supabase } from "@/app/supabase";
import {
  CirclePlus,
  Eye,
  LogIn,
  PencilLine,
  ScrollText,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ACTIVITY_LOG_ICON_CLASS =
  "h-4 w-4 shrink-0 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]";

const ACTIVITY_LOG_ICONS: Record<ActivityActionType, LucideIcon> = {
  login: LogIn,
  deal_created: CirclePlus,
  deal_updated: PencilLine,
  deal_deleted: Trash2,
  quote_sent: Send,
  view_as_changed: Eye,
};

const ACTIVITY_ACTION_PHRASES: Record<ActivityActionType, string> = {
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

function getActivityIcon(actionType: string): LucideIcon {
  if (actionType in ACTIVITY_LOG_ICONS) {
    return ACTIVITY_LOG_ICONS[actionType as ActivityActionType];
  }
  return ScrollText;
}

function getActionPhrase(log: ActivityLogDisplayEntry): string {
  if (log.action_type === "view_as_changed" && log.description.trim()) {
    return log.description;
  }

  if (log.action_type in ACTIVITY_ACTION_PHRASES) {
    return ACTIVITY_ACTION_PHRASES[log.action_type as ActivityActionType];
  }

  return log.description;
}

function formatExactTime(value: string) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelativeTimeHebrew(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "עכשיו";
  if (diffMinutes === 1) return "לפני דקה";
  if (diffMinutes < 60) return `לפני ${diffMinutes} דקות`;
  if (diffHours === 1) return "לפני שעה";
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  if (diffDays === 1) return "אתמול";
  if (diffDays < 7) return `לפני ${diffDays} ימים`;

  return formatExactTime(value);
}

function formatLogTimestamp(value: string) {
  const relative = formatRelativeTimeHebrew(value);
  const exact = formatExactTime(value);

  if (relative === exact) return relative;
  return `${relative} · ${exact}`;
}

export function ActivityLogPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [logs, setLogs] = useState<ActivityLogDisplayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLogs([]);
        setError("לא ניתן לטעון יומן פעילות");
        return;
      }

      const response = await fetch("/api/admin/activity-logs?limit=100", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        setLogs([]);
        setError(data.error || "שגיאה בטעינת יומן פעילות");
        return;
      }

      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
      setError("שגיאה בטעינת יומן פעילות");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLogs();
  }, [open, loadLogs]);

  if (!isMounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="יומן פעילות"
    >
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="glass-card gradient-border relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/95 shadow-[0_0_32px_rgba(34,211,238,0.18)]">
        <div className="flex flex-row-reverse items-center justify-between border-b border-cyan-400/20 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-cyan-300/80 transition-colors hover:bg-cyan-500/10 hover:text-cyan-100"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex flex-row-reverse items-center gap-2">
            <ScrollText className={ACTIVITY_LOG_ICON_CLASS} />
            <h2 className="text-lg font-bold text-cyan-200">יומן פעילות</h2>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="h-5 w-5 rounded-full border-2 border-cyan-300/20 border-t-cyan-300 animate-spin shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-cyan-200/75">{error}</p>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-cyan-200/75">
              אין רשומות פעילות עדיין
            </p>
          ) : (
            <div className="space-y-2.5">
              {logs.map((log) => {
                const Icon = getActivityIcon(log.action_type);
                const actionPhrase = getActionPhrase(log);
                const displayName = log.user_name?.trim() || "משתמש";
                const hasDealDetails =
                  Boolean(log.customer_name) ||
                  Boolean(log.car_model) ||
                  log.amount != null;

                return (
                  <div
                    key={log.id}
                    className="rounded-xl border border-cyan-500/15 bg-slate-900/50 px-3.5 py-3 transition-colors hover:border-cyan-400/25 hover:bg-slate-900/70"
                  >
                    <div className="flex flex-row-reverse items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 shadow-[0_0_12px_rgba(34,211,238,0.12)]">
                        <Icon className={ACTIVITY_LOG_ICON_CLASS} aria-hidden />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5 text-right">
                        <p className="text-sm font-bold text-cyan-100">{displayName}</p>

                        <div className="flex flex-row-reverse items-center gap-1.5">
                          <Icon
                            className="h-3.5 w-3.5 shrink-0 text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.45)]"
                            aria-hidden
                          />
                          <p className="text-sm font-semibold text-cyan-300">
                            {actionPhrase}
                          </p>
                        </div>

                        {hasDealDetails ? (
                          <div className="space-y-0.5 pt-0.5">
                            {log.customer_name ? (
                              <p className="text-sm text-cyan-100/90">
                                <span className="text-cyan-200/65">לקוח: </span>
                                {log.customer_name}
                              </p>
                            ) : null}
                            {log.car_model ? (
                              <p className="text-sm text-cyan-100/90">
                                <span className="text-cyan-200/65">דגם: </span>
                                {log.car_model}
                              </p>
                            ) : null}
                            {log.amount != null ? (
                              <p className="text-sm font-semibold text-cyan-200">
                                {currency.format(log.amount)}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <p className="pt-0.5 text-[11px] text-cyan-200/55">
                          {formatLogTimestamp(log.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
