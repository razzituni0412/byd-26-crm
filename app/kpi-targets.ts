import { supabase } from "@/app/supabase";

export type MonthlyTargets = {
  dealsTarget: number;
  profitabilityTarget: number;
  profitabilityMinInterestRate: number;
};

export type MonthlyTargetsByPeriod = Record<string, MonthlyTargets>;

export type KpiType = "deals" | "profitability" | "profitability_min_interest";

const TARGETS_STORAGE_KEY = "future-crm-monthly-targets-v1";
const TARGETS_MIGRATED_FLAG_PREFIX = "future-crm-targets-migrated-v1";

export const DEFAULT_PROFITABILITY_MIN_INTEREST_RATE = 6;

const DEFAULT_MONTHLY_TARGETS: MonthlyTargets = {
  dealsTarget: 10,
  profitabilityTarget: 5,
  profitabilityMinInterestRate: DEFAULT_PROFITABILITY_MIN_INTEREST_RATE,
};

function getTargetsStorageKey(userId: string) {
  return `${TARGETS_STORAGE_KEY}:${userId}`;
}

function getTargetsMigratedFlagKey(userId: string) {
  return `${TARGETS_MIGRATED_FLAG_PREFIX}:${userId}`;
}

function normalizeTarget(value: unknown, fallback: number) {
  const target = Math.round(Number(value));
  return Number.isFinite(target) && target >= 0 ? target : fallback;
}

export function normalizeInterestRate(value: unknown, fallback = DEFAULT_PROFITABILITY_MIN_INTEREST_RATE) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) {
    return fallback;
  }

  return Math.round(rate * 100) / 100;
}

function interestRateToStorage(rate: number) {
  return Math.round(normalizeInterestRate(rate) * 100);
}

function interestRateFromStorage(value: number) {
  return normalizeInterestRate(value / 100);
}

function normalizeMonthlyTargetsEntry(raw: unknown): MonthlyTargets {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MONTHLY_TARGETS };
  }

  const entry = raw as Partial<MonthlyTargets>;
  return {
    dealsTarget: normalizeTarget(entry.dealsTarget, DEFAULT_MONTHLY_TARGETS.dealsTarget),
    profitabilityTarget: normalizeTarget(
      entry.profitabilityTarget,
      DEFAULT_MONTHLY_TARGETS.profitabilityTarget,
    ),
    profitabilityMinInterestRate: normalizeInterestRate(
      entry.profitabilityMinInterestRate,
      DEFAULT_MONTHLY_TARGETS.profitabilityMinInterestRate,
    ),
  };
}

function isLegacyMonthlyTargetsFormat(parsed: unknown): parsed is Partial<MonthlyTargets> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }

  const record = parsed as Record<string, unknown>;
  const hasLegacyFields = "dealsTarget" in record || "profitabilityTarget" in record;
  const hasPeriodKeys = Object.keys(record).some(
    (key) => /^\d{4}-\d{2}$/.test(key) || key === "2026",
  );

  return hasLegacyFields && !hasPeriodKeys;
}

function loadLocalTargetsByPeriod(userId: string): MonthlyTargetsByPeriod {
  if (typeof window === "undefined") {
    return {};
  }

  let stored = window.localStorage.getItem(getTargetsStorageKey(userId));
  if (!stored) {
    stored = window.localStorage.getItem(TARGETS_STORAGE_KEY);
  }

  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as unknown;

    if (isLegacyMonthlyTargetsFormat(parsed)) {
      const now = new Date();
      const periodKey =
        now.getFullYear() === 2026
          ? `2026-${String(now.getMonth() + 1).padStart(2, "0")}`
          : "2026";
      return { [periodKey]: normalizeMonthlyTargetsEntry(parsed) };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: MonthlyTargetsByPeriod = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}$/.test(key) || key === "2026") {
        result[key] = normalizeMonthlyTargetsEntry(value);
      }
    }

    return result;
  } catch {
    window.localStorage.removeItem(getTargetsStorageKey(userId));
    window.localStorage.removeItem(TARGETS_STORAGE_KEY);
    return {};
  }
}

function rowsToTargetsByPeriod(
  rows: Array<{ period_key: string; kpi_type: string; target_value: number }>,
): MonthlyTargetsByPeriod {
  const result: MonthlyTargetsByPeriod = {};

  for (const row of rows) {
    const current = result[row.period_key] ?? { ...DEFAULT_MONTHLY_TARGETS };
    if (row.kpi_type === "deals") {
      current.dealsTarget = normalizeTarget(row.target_value, DEFAULT_MONTHLY_TARGETS.dealsTarget);
    } else if (row.kpi_type === "profitability") {
      current.profitabilityTarget = normalizeTarget(
        row.target_value,
        DEFAULT_MONTHLY_TARGETS.profitabilityTarget,
      );
    } else if (row.kpi_type === "profitability_min_interest") {
      current.profitabilityMinInterestRate = interestRateFromStorage(row.target_value);
    }
    result[row.period_key] = current;
  }

  return result;
}

function targetsByPeriodToRows(userId: string, targetsByPeriod: MonthlyTargetsByPeriod) {
  const rows: Array<{
    user_id: string;
    period_key: string;
    kpi_type: KpiType;
    target_value: number;
    updated_at: string;
  }> = [];

  for (const [periodKey, targets] of Object.entries(targetsByPeriod)) {
    rows.push({
      user_id: userId,
      period_key: periodKey,
      kpi_type: "deals",
      target_value: normalizeTarget(targets.dealsTarget, DEFAULT_MONTHLY_TARGETS.dealsTarget),
      updated_at: new Date().toISOString(),
    });
    rows.push({
      user_id: userId,
      period_key: periodKey,
      kpi_type: "profitability",
      target_value: normalizeTarget(
        targets.profitabilityTarget,
        DEFAULT_MONTHLY_TARGETS.profitabilityTarget,
      ),
      updated_at: new Date().toISOString(),
    });
    rows.push({
      user_id: userId,
      period_key: periodKey,
      kpi_type: "profitability_min_interest",
      target_value: interestRateToStorage(targets.profitabilityMinInterestRate),
      updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

async function fetchRemoteTargets(userId: string): Promise<MonthlyTargetsByPeriod> {
  const { data, error } = await supabase
    .from("kpi_targets")
    .select("period_key, kpi_type, target_value")
    .eq("user_id", userId);

  if (error) {
    console.warn("Failed to load KPI targets from Supabase:", error.message);
    return {};
  }

  return rowsToTargetsByPeriod(data ?? []);
}

async function upsertTargetsBulk(
  userId: string,
  targetsByPeriod: MonthlyTargetsByPeriod,
): Promise<boolean> {
  const rows = targetsByPeriodToRows(userId, targetsByPeriod);
  if (rows.length === 0) {
    return true;
  }

  const { error } = await supabase.from("kpi_targets").upsert(rows, {
    onConflict: "user_id,period_key,kpi_type",
  });

  if (error) {
    console.warn("Failed to save KPI targets to Supabase:", error.message);
    return false;
  }

  return true;
}

export async function loadKpiTargets(userId: string): Promise<MonthlyTargetsByPeriod> {
  const remoteTargets = await fetchRemoteTargets(userId);
  const hasRemoteTargets = Object.keys(remoteTargets).length > 0;

  if (hasRemoteTargets) {
    return remoteTargets;
  }

  const localTargets = loadLocalTargetsByPeriod(userId);
  const hasLocalTargets = Object.keys(localTargets).length > 0;

  if (!hasLocalTargets) {
    return {};
  }

  if (typeof window !== "undefined") {
    const migratedFlag = window.localStorage.getItem(getTargetsMigratedFlagKey(userId));
    if (migratedFlag === "1") {
      return localTargets;
    }
  }

  const migrated = await upsertTargetsBulk(userId, localTargets);
  if (!migrated) {
    return localTargets;
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(getTargetsMigratedFlagKey(userId), "1");
  }

  const migratedTargets = await fetchRemoteTargets(userId);
  return Object.keys(migratedTargets).length > 0 ? migratedTargets : localTargets;
}

export async function saveKpiTarget(
  userId: string,
  periodKey: string,
  kpiType: KpiType,
  targetValue: number,
): Promise<void> {
  const normalizedValue =
    kpiType === "profitability_min_interest"
      ? interestRateToStorage(targetValue)
      : normalizeTarget(
          targetValue,
          kpiType === "deals"
            ? DEFAULT_MONTHLY_TARGETS.dealsTarget
            : DEFAULT_MONTHLY_TARGETS.profitabilityTarget,
        );

  const { error } = await supabase.from("kpi_targets").upsert(
    {
      user_id: userId,
      period_key: periodKey,
      kpi_type: kpiType,
      target_value: normalizedValue,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,period_key,kpi_type",
    },
  );

  if (error) {
    console.warn("Failed to update KPI target:", error.message);
  }
}

export async function saveKpiTargetsPatch(
  userId: string,
  periodKey: string,
  patch: Partial<MonthlyTargets>,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (patch.dealsTarget != null) {
    tasks.push(saveKpiTarget(userId, periodKey, "deals", patch.dealsTarget));
  }

  if (patch.profitabilityTarget != null) {
    tasks.push(saveKpiTarget(userId, periodKey, "profitability", patch.profitabilityTarget));
  }

  if (patch.profitabilityMinInterestRate != null) {
    tasks.push(
      saveKpiTarget(
        userId,
        periodKey,
        "profitability_min_interest",
        patch.profitabilityMinInterestRate,
      ),
    );
  }

  await Promise.all(tasks);
}
