"use client";
import { logActivity, type ActivityNotificationContext } from "@/app/activity-log";
import { ActivityLogPanel } from "@/app/components/ActivityLogPanel";
import {
  DEFAULT_PROFITABILITY_MIN_INTEREST_RATE,
  loadKpiTargets,
  normalizeInterestRate,
  saveKpiTargetsPatch,
} from "@/app/kpi-targets";
import {
  supabase,
  isInvalidAuthSessionError,
  isTransientAuthNetworkError,
} from "@/app/supabase";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  CalendarDays,
  CarFront,
  Calculator,
  ChartNoAxesCombined,
  CircleDollarSign,
  Crown,
  Edit3,
  ListChecks,
  Percent,
  PlusCircle,
  ShieldCheck,
  UserCog,
  Eye,
  Plus,
  Target,
  Trash2,
  Trophy,
  TrendingUp,
  Users,
  ScrollText,
  Share2,
  Download,
  Printer,
  X,
  SunMedium,
  CloudSun,
  Moon,
  Sparkles,
  Landmark,
  BarChart3,
  Lock,
  User,

} from "lucide-react";

const CRM_NEON_ICON_CLASS =
  "h-4 w-4 shrink-0 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]";

type DealStatus =  "בטיפול" | "מאושר" | "נדחה" | "חוזה חתום";
type FinancingType = "רגיל" | "מסובסד";
type PageTab = "dashboard" | "add" | "list" | "amortization";

type AdminAuthUser = {
  id: string;
  email: string;
};

type UserRole = "admin_agent" | "admin" | "agent";

function hasPersonalDashboard(role: UserRole): boolean {
  return role === "admin_agent" || role === "agent";
}

function hasPersonalDeals(role: UserRole): boolean {
  return role === "admin_agent" || role === "agent";
}

function canAccessManagement(role: UserRole): boolean {
  return role === "admin" || role === "admin_agent";
}

function canViewOtherUsers(role: UserRole): boolean {
  return role === "admin" || role === "admin_agent";
}

type Deal = {
  id: string;
  date: string;
  agentName: string;
  customerName: string;
  carModel: string;
  vehiclePrice: number;
  loanTermMonths: number;
  financingAmount: number;
  interestRate: number;
  status: DealStatus;
  financingType: FinancingType;
};

type DealFormData = Omit<Deal, "id">;

const STORAGE_KEY = "future-crm-deals-v1";
const AGENTS_STORAGE_KEY = "future-crm-agents-v1";
const TICKER_MAX_DEALS = 20;

function getDealsStorageKey(userId: string) {
  return `${STORAGE_KEY}:${userId}`;
}

type MonthlyTargets = {
  dealsTarget: number;
  profitabilityTarget: number;
  profitabilityMinInterestRate: number;
};

type MonthlyTargetsByPeriod = Record<string, MonthlyTargets>;

const DEFAULT_MONTHLY_TARGETS: MonthlyTargets = {
  dealsTarget: 10,
  profitabilityTarget: 5,
  profitabilityMinInterestRate: DEFAULT_PROFITABILITY_MIN_INTEREST_RATE,
};

const VALID_DEAL_STATUSES: DealStatus[] = [
  "בטיפול",
  "מאושר",
  "נדחה",
  "חוזה חתום",
];

function isSignedContractStatus(status: DealStatus) {
  return status === "חוזה חתום";
}

const FINANCING_TYPE_OPTIONS: FinancingType[] = ["רגיל", "מסובסד"];

function normalizeFinancingType(value: unknown): FinancingType {
  return value === "מסובסד" ? "מסובסד" : "רגיל";
}

function isRegularFinancing(deal: Deal) {
  return deal.financingType === "רגיל";
}

const DASHBOARD_YEAR = 2026;

const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

const DASHBOARD_PERIOD_OPTIONS = [
  ...HEBREW_MONTHS.map((name, index) => ({
    label: `${name} ${DASHBOARD_YEAR}`,
    value: `${DASHBOARD_YEAR}-${String(index + 1).padStart(2, "0")}`,
  })),
  { label: `כל ${DASHBOARD_YEAR}`, value: `${DASHBOARD_YEAR}` },
] as const;

const DEFAULT_DASHBOARD_PERIOD_VALUE = DASHBOARD_PERIOD_OPTIONS[0].value;

type DashboardPeriod =
  | { kind: "month"; year: number; month: number }
  | { kind: "year"; year: number };

function getDefaultDashboardPeriodValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (year === DASHBOARD_YEAR) {
    return `${DASHBOARD_YEAR}-${String(month).padStart(2, "0")}`;
  }
  return `${DASHBOARD_YEAR}`;
}

function parseDashboardPeriod(value: string): DashboardPeriod | null {
  if (!value) return null;
  if (value === `${DASHBOARD_YEAR}`) {
    return { kind: "year", year: DASHBOARD_YEAR };
  }
  const [year, month] = value.split("-").map(Number);
  if (year === DASHBOARD_YEAR && month >= 1 && month <= 12) {
    return { kind: "month", year, month };
  }
  return null;
}

function isDealInPeriod(deal: Deal, period: DashboardPeriod | null) {
  if (!period || !deal.date) return false;
  const [dealYear, dealMonth] = deal.date.split("-").map(Number);
  if (period.kind === "year") return dealYear === period.year;
  return dealYear === period.year && dealMonth === period.month;
}

function normalizeDealStatus(value: unknown): DealStatus {
  if (value === "חדש") return "בטיפול";
  if (typeof value === "string" && VALID_DEAL_STATUSES.includes(value as DealStatus)) {
    return value as DealStatus;
  }
  return "בטיפול";
}

function normalizeAgentName(name: string) {
  return name.trim();
}

function normalizeAgents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const agents: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = normalizeAgentName(item);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    agents.push(trimmed);
  }
  return agents.sort((a, b) => a.localeCompare(b, "he"));
}

function loadAgents(): string[] {
  const stored = window.localStorage.getItem(AGENTS_STORAGE_KEY);
  if (!stored) return [];
  try {
    return normalizeAgents(JSON.parse(stored));
  } catch {
    window.localStorage.removeItem(AGENTS_STORAGE_KEY);
    return [];
  }
}

function mergeAgentOptions(savedAgents: string[], deals: Deal[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const name of [...savedAgents, ...deals.map((deal) => normalizeAgentName(deal.agentName))]) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
  }
  return merged.sort((a, b) => a.localeCompare(b, "he"));
}

function normalizeTarget(value: unknown, fallback: number) {
  const target = Math.round(Number(value));
  return Number.isFinite(target) && target >= 0 ? target : fallback;
}

function getTargetsForPeriod(
  targetsByPeriod: MonthlyTargetsByPeriod,
  periodKey: string,
): MonthlyTargets {
  return targetsByPeriod[periodKey] ?? { ...DEFAULT_MONTHLY_TARGETS };
}

function patchTargetsForPeriod(
  targetsByPeriod: MonthlyTargetsByPeriod,
  periodKey: string,
  patch: Partial<MonthlyTargets>,
): MonthlyTargetsByPeriod {
  const current = targetsByPeriod[periodKey] ?? { ...DEFAULT_MONTHLY_TARGETS };
  return {
    ...targetsByPeriod,
    [periodKey]: { ...current, ...patch },
  };
}

function persistKpiTargetsIfReady(
  userId: string | undefined,
  periodKey: string,
  patch: Partial<MonthlyTargets>,
  storageReady: boolean,
  loadedForUserId: string | null,
  userRole: UserRole,
  viewedUserId: string | null,
) {
  if (!storageReady || !userId) return;
  if (loadedForUserId !== userId) return;
  if (userRole === "admin" && !viewedUserId) return;
  void saveKpiTargetsPatch(userId, periodKey, patch);
}

async function loadDeals(userId: string): Promise<Deal[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  
  if (!user || !userId) {
    return [];
  }
  
  const { data, error } = await supabase
  .from("deals")
  .select("*")
  .eq("user_id", userId)
  .order("date", { ascending: false });

if (error) {
  console.error("Error loading deals:", error);
  return [];
}
  

  return (data ?? []).map((deal) =>
    normalizeDeal({
      id: deal.id,
      date: deal.date,
      agentName: deal.agent_name,
      customerName: deal.customer_name,
      carModel: deal.car_model,
      vehiclePrice: deal.vehicle_price,
      loanTermMonths: deal.loan_term_months,
      financingAmount: deal.financing_amount,
      interestRate: deal.interest_rate,
      status: deal.status,
      financingType: deal.financing_type,
    })
  );
}

async function loadUserRole(
  userId: string,
): Promise<{ role: UserRole; canViewAs: boolean }> {
  const defaultRole = { role: "agent" as const, canViewAs: false };

  const { data, error } = await supabase
    .from("roles")
    .select("role, can_view_as")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading user role:", error);
    return defaultRole;
  }

  if (!data) {
    return defaultRole;
  }

  const validRoles: UserRole[] = ["admin_agent", "admin", "agent"];
  const role = validRoles.includes(data.role as UserRole)
    ? (data.role as UserRole)
    : "agent";

  return {
    role,
    canViewAs: Boolean(data.can_view_as),
  };
}

const BYD_MODELS = [
  { model: "Dolphin Surf Boost", price: 114990 },
  { model: "Dolphin Surf Comfort", price: 123990 },
  { model: "Dolphin Comfort", price: 149990 },
  { model: "Dolphin Design", price: 156990 },
  { model: "Atto 2 EV Comfort", price: 148990 },
  { model: "Atto 2 Dmi Boost", price: 149990 },
  { model: "Atto 3 EVO Design", price: 154990 },
  { model: "Atto 3 EVO Excellence", price: 164990 },
  { model: "Sealion 5 Dmi Comfort", price: 166990 },
  { model: "Sealion 5 Dmi Design", price: 171990 },
  { model: "Seal U EV Comfort", price: 194990 },
  { model: "Seal U EV Design", price: 216990 },
  { model: "Seal U Dmi Boost", price: 199990 },
  { model: "Seal U Dmi Comfort", price: 214990 },
  { model: "Seal U Dmi Design", price: 234990 },
  { model: "Seal Design", price: 198990 },
  { model: "Seal Excellence", price: 219990 },
  { model: "Sealion 7 Boost", price: 198990 },
  { model: "Sealion 7 Design", price: 219990 },
  { model: "Sealion 7 Comfort", price: 214990 },
  { model: "Sealion 7 Excellence", price: 237990 },
  { model: "Tang Flagship", price: 327990 },
] as const;

const BYD_PRICE_BY_MODEL = Object.fromEntries(
  BYD_MODELS.map((entry) => [entry.model, entry.price]),
) as Record<string, number>;

const MANUAL_CAR_MODEL_OPTION = "אחר / הזנה ידנית";

function isKnownBydModel(model: string): boolean {
  return model in BYD_PRICE_BY_MODEL;
}

const STATUS_OPTIONS: DealStatus[] = ["בטיפול", "מאושר", "נדחה","חוזה חתום"];
const LOAN_TERM_MIN = 12;
const LOAN_TERM_MAX = 100;
const DEFAULT_LOAN_TERM_MONTHS = 60;

function formatLoanTerm(months: number) {
  return `${months} חודשים`;
}

function isoDateToDisplay(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function displayDateToIso(display: string): string | null {
  const trimmed = display.trim();
  if (!trimmed) return "";
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearPart = Number(match[3]);
const year = yearPart < 100 ? 2000 + yearPart : yearPart;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return null;

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDisplayDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeDealDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return displayDateToIso(isoDateToDisplay(trimmed)) ?? trimmed;
  }

  const fromDisplay = displayDateToIso(trimmed);
  if (fromDisplay) return fromDisplay;

  return trimmed;
}

const formatDateIL = (dateString: string) => {
  if (!dateString) return "";
  const normalized = normalizeDealDate(dateString);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return isoDateToDisplay(normalized);
  }
  return dateString;
};

function normalizeLoanTermMonths(value: unknown): number {
  const months = Math.round(Number(value));
  if (!Number.isFinite(months)) return DEFAULT_LOAN_TERM_MONTHS;
  return Math.min(LOAN_TERM_MAX, Math.max(LOAN_TERM_MIN, months));
}

function normalizeDeal(raw: Partial<Deal> & { id: string }): Deal {
  const carModel = raw.carModel ?? BYD_MODELS[0].model;
  const vehiclePrice =
    typeof raw.vehiclePrice === "number"
      ? raw.vehiclePrice
      : (BYD_PRICE_BY_MODEL[carModel] ?? 0);

  return {
    id: raw.id,
    date: normalizeDealDate(raw.date),
    agentName: normalizeAgentName(raw.agentName ?? ""),
    customerName: raw.customerName ?? "",
    carModel,
    vehiclePrice,
    loanTermMonths: normalizeLoanTermMonths(raw.loanTermMonths),
    financingAmount: Number(raw.financingAmount) || 0 ,
    interestRate: Number(raw.interestRate) || 0,
    status: normalizeDealStatus(raw.status),
    financingType: normalizeFinancingType(raw.financingType),
  };
}

const defaultFormState: DealFormData = {
  date: "",
  agentName: "",
  customerName: "",
  carModel: BYD_MODELS[0].model,
  vehiclePrice: BYD_MODELS[0].price,
  loanTermMonths: DEFAULT_LOAN_TERM_MONTHS,
  financingAmount: 0,
  interestRate: 0,
  status: "בטיפול",
  financingType: "רגיל",
};

const currency = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

const loanCurrency = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatProposalShekels(value: number, fractionDigits: 0 | 2 = 0) {
  return `${value.toLocaleString("he-IL", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ₪`;
}

function formatProposalTerm(months: number) {
  return `${months} חודשים`;
}

function formatProposalRateLabel(annualRate: number) {
  return Number.isInteger(annualRate)
    ? `${annualRate}%`
    : `${annualRate.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function buildFinancingOfferShareText(customerName: string) {
  const trimmedName = customerName.trim();
  const greeting = trimmedName ? `שלום רב, ${trimmedName}` : "שלום רב,";

  return `${greeting}

בהמשך לשיחתנו, מצורפת הצעת המימון.

לצורך בחינת בקשת המימון, אבקש להעביר את המסמכים הבאים:

• צילום תעודת זהות + ספח פתוח
• צילום רישיון נהיגה
• אישור ניהול חשבון בנק או צילום צ'ק מבוטל

לאחר שליחת המסמכים, אבקש להשלים הרשמה לבנקאות פתוחה באמצעות הקישור הבא:

https://shlomo-sixt.open-finance.ai

לאחר קבלת המסמכים והשלמת ההרשמה לבנקאות פתוחה, נבחן את בקשת המימון ונעדכן אותך בהמשך התהליך.

בברכה,
צוות המימון | BYD ISRAEL`;
}

function isMobileShareDevice() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;

  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad|Mobile/i.test(ua)) return true;

  // iPadOS 13+ may report as Mac with touch support.
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return true;

  return false;
}

function escapePrintHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFinancingOfferPrintHtml({
  customerName,
  carModel,
  financingAmount,
  termMonths,
  annualRate,
  monthlyPayment,
  logoUrl,
}: {
  customerName: string;
  carModel: string;
  financingAmount: number;
  termMonths: number;
  annualRate: number;
  monthlyPayment: number;
  logoUrl: string;
}) {
  const customerLabel = escapePrintHtml(customerName.trim() || "—");
  const safeCarModel = escapePrintHtml(carModel);
  const rateLabel = formatProposalRateLabel(annualRate);

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>הצעת מימון</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Segoe UI", sans-serif;
      color: #0f172a;
      background: #fff;
      line-height: 1.5;
    }
    .page {
      max-width: 170mm;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0891b2;
      padding-bottom: 12px;
      margin-bottom: 24px;
    }
    .header img {
      width: 140px;
      height: auto;
      margin-bottom: 8px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: #0e7490;
    }
    .section {
      margin-bottom: 18px;
    }
    .section h2 {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 700;
      color: #155e75;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 10px 12px;
      text-align: right;
      font-size: 14px;
    }
    th {
      width: 38%;
      background: #f0fdfa;
      color: #0f766e;
      font-weight: 600;
    }
    .highlight {
      margin-top: 22px;
      padding: 18px;
      border: 2px solid #0891b2;
      border-radius: 10px;
      text-align: center;
      background: #ecfeff;
    }
    .highlight-label {
      font-size: 13px;
      color: #0e7490;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .highlight-value {
      font-size: 32px;
      font-weight: 800;
      color: #0f172a;
      direction: ltr;
    }
    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid #cbd5e1;
      font-size: 10px;
      color: #64748b;
      line-height: 1.55;
      text-align: justify;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <img src="${logoUrl}" alt="BYD Haifa" />
      <h1>הצעת מימון</h1>
    </div>

    <div class="section">
      <h2>פרטי ההצעה</h2>
      <table>
        <tr><th>שם לקוח</th><td>${customerLabel}</td></tr>
        <tr><th>דגם רכב</th><td>${safeCarModel}</td></tr>
        <tr><th>סכום מימון</th><td dir="ltr">${formatProposalShekels(financingAmount)}</td></tr>
        <tr><th>תקופה</th><td dir="ltr">${formatProposalTerm(termMonths)}</td></tr>
        <tr><th>ריבית</th><td dir="ltr">${rateLabel}</td></tr>
      </table>
    </div>

    <div class="highlight">
      <div class="highlight-label">החזר חודשי</div>
      <div class="highlight-value">${formatProposalShekels(monthlyPayment, 2)}</div>
    </div>

    <div class="footer">
      המימון מוצע על ידי שלמה מימון בע"מ, ח.פ. 515455137 מספר רישיון: 56249, חברה בעלת רישיון מורחב למתן אשראי מאת רשות שוק ההון, ביטוח וחיסכון, בכפוף לשיקול דעתה ולתנאיה. אי-עמידה בפירעון ההלוואה או בהחזר האשראי עלולה לגרור חיוב בריבית פיגורים והליכי הוצאה לפועל.
    </div>
  </div>
</body>
</html>`;
}

type AmortizationRow = {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
};

type LoanCalculationResult = {
  monthlyPayment: number;
  totalInterest: number;
  totalRepayment: number;
  endingBalance: number;
  schedule: AmortizationRow[];
};

type EarlyPayoffResult = {
  totalInterestPaid: number;
  principalBalanceAtPayoff: number;
  totalPaymentsMade: number;
  totalActualCost: number;
};

const DEFAULT_EARLY_PAYOFF_MONTH = 36;

function calculateEarlyPayoff(
  schedule: AmortizationRow[],
  payoffMonth: number,
): EarlyPayoffResult | null {
  if (payoffMonth < 1 || payoffMonth > schedule.length) return null;

  const rowsThroughPayoff = schedule.slice(0, payoffMonth);
  const totalInterestPaid = rowsThroughPayoff.reduce((sum, row) => sum + row.interest, 0);
  const totalPaymentsMade = rowsThroughPayoff.reduce((sum, row) => sum + row.payment, 0);
  const principalBalanceAtPayoff = schedule[payoffMonth - 1].balance;
  const totalActualCost = totalPaymentsMade + principalBalanceAtPayoff;

  return {
    totalInterestPaid,
    principalBalanceAtPayoff,
    totalPaymentsMade,
    totalActualCost,
  };
}

function clampEarlyPayoffMonth(value: number, loanTermMonths: number) {
  const term = Math.max(1, Math.round(loanTermMonths));
  const month = Math.round(value);
  if (!Number.isFinite(month)) return Math.min(DEFAULT_EARLY_PAYOFF_MONTH, term);
  return Math.min(term, Math.max(1, month));
}

function calculateLoanRepayment(
  principal: number,
  months: number,
  annualRatePercent: number,
  balloon: number,
): LoanCalculationResult | null {
  if (principal <= 0 || months <= 0 || annualRatePercent < 0 || balloon < 0 || balloon > principal) {
    return null;
  }

  const monthlyRate = annualRatePercent / 100 / 12;
  const n = Math.round(months);
  const P = principal;
  const B = balloon;

  let monthlyPayment: number;
  if (monthlyRate === 0) {
    monthlyPayment = (P - B) / n;
  } else {
    const factor = Math.pow(1 + monthlyRate, n);
    const presentValueBalloon = B / factor;
    const amortizedPrincipal = P - presentValueBalloon;
    monthlyPayment = (amortizedPrincipal * monthlyRate * factor) / (factor - 1);
  }

  const schedule: AmortizationRow[] = [];
  let balance = P;
  let totalInterest = 0;
  let totalPayments = 0;

  for (let month = 1; month <= n; month += 1) {
    const interest = monthlyRate === 0 ? 0 : balance * monthlyRate;
    const principalPaid = month === n ? balance - B : monthlyPayment - interest;
    const payment = interest + principalPaid;

    balance -= principalPaid;
    totalInterest += interest;
    totalPayments += payment;

    schedule.push({
      month,
      payment,
      interest,
      principal: principalPaid,
      balance: Math.max(0, balance),
    });
  }

  return {
    monthlyPayment,
    totalInterest,
    totalRepayment: totalPayments + B,
    endingBalance: B,
    schedule,
  };
}

function getTickerStatusAccent(status: DealStatus) {
  switch (status) {
    case "חוזה חתום":
      return {
        dotClass: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]",
        textClass: "text-emerald-300",
        borderClass: "border-emerald-400/30 bg-emerald-500/[0.07]",
      };
    case "מאושר":
      return {
        dotClass: "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.75)]",
        textClass: "text-blue-300",
        borderClass: "border-blue-400/30 bg-blue-500/[0.07]",
      };
    case "נדחה":
      return {
        dotClass: "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.75)]",
        textClass: "text-rose-300",
        borderClass: "border-rose-400/30 bg-rose-500/[0.07]",
      };
    default:
      return {
        dotClass: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.55)]",
        textClass: "text-cyan-200",
        borderClass: "border-cyan-300/30 bg-cyan-400/[0.06]",
      };
  }
}

function sortDealsForTicker(allDeals: Deal[]) {
  return [...allDeals]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, TICKER_MAX_DEALS);
}

function getStatusStyle(status: DealStatus) {
  switch (status) {
    case "מאושר":
      return "bg-cyan-500/20 text-cyan-200 border-cyan-400/45";
    case "חוזה חתום":
      return "bg-emerald-500/20 text-emerald-200 border-emerald-400/45";
    case "בטיפול":
      return "bg-blue-500/20 text-blue-200 border-blue-400/45";
    case "נדחה":
      return "bg-rose-500/20 text-rose-200 border-rose-400/45";
    default:
      return "bg-indigo-500/20 text-indigo-200 border-indigo-400/45";
  }
}

function isProfitableInterestRate(interestRate: number, minRate = DEFAULT_PROFITABILITY_MIN_INTEREST_RATE) {
  return interestRate >= minRate;
}

function getProfitabilityAccent(interestRate: number) {
  if (isProfitableInterestRate(interestRate)) {
    return {
      cardClass:
        "border-emerald-400/40 shadow-[0_0_22px_rgba(52,211,153,0.14)]",
      dotClass: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]",
      rateClass: "text-emerald-300",
      indicatorClass: "text-emerald-300/90",
      indicatorLabel: "רווחיות גבוהה",
    };
  }

  return {
    cardClass: "border-rose-400/40 shadow-[0_0_22px_rgba(244,63,94,0.14)]",
    dotClass: "bg-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.75)]",
    rateClass: "text-rose-300",
    indicatorClass: "text-rose-300/90",
    indicatorLabel: "רווחיות נמוכה",
  };
}
const HEBREW_WEEKDAYS = [
  "יום ראשון",
  "יום שני",
  "יום שלישי",
  "יום רביעי",
  "יום חמישי",
  "יום שישי",
  "יום שבת",
] as const;

function formatLiveDateTime(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${HEBREW_WEEKDAYS[date.getDay()]} · ${day}/${month} · ${hours}:${minutes}`;
}

type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

function getGreeting(date = new Date()): { text: string; period: GreetingPeriod } {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return { text: "בוקר טוב", period: "morning" };
  }

  if (hour >= 12 && hour < 17) {
    return { text: "צהריים טובים", period: "afternoon" };
  }

  if (hour >= 17 && hour < 21) {
    return { text: "ערב טוב", period: "evening" };
  }

  return { text: "לילה טוב", period: "night" };
}

function GreetingPeriodIcon({ period }: { period: GreetingPeriod }) {
  const iconClassName =
    "h-[22px] w-[22px] shrink-0 text-[rgba(205,245,255,0.88)] drop-shadow-[0_0_6px_rgba(34,211,238,0.10)]";

  if (period === "morning") return <SunMedium aria-hidden className={iconClassName} />;
  if (period === "afternoon") return <CloudSun aria-hidden className={iconClassName} />;
  if (period === "evening") return <Moon aria-hidden className={iconClassName} />;
  return <Sparkles aria-hidden className={iconClassName} />;
}

function GreetingSection({
  userName,
  avatarSrc,
}: {
  userName: string;
  avatarSrc: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const greeting = getGreeting(now);

  return (
    <div className="mt-8 flex items-center justify-center gap-4" dir="ltr">
      <div className="relative shrink-0">
        <img
          src={avatarSrc}
          alt="Profile"
          className="h-12 w-12 rounded-full border border-cyan-400 object-cover shadow-[0_0_12px_rgba(34,211,238,0.35)]"
        />
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border border-slate-900 bg-green-400" />
      </div>

      <div className="flex min-w-0 flex-col items-start" dir="rtl">
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-bold leading-snug text-[rgba(205,245,255,0.88)]">
            {greeting.text}, {userName}
          </span>
          <GreetingPeriodIcon period={greeting.period} />
        </div>

        <span
          className="mt-2 text-[11px] font-normal leading-none tracking-tight tabular-nums text-[rgba(205,245,255,0.68)]"
          dir="ltr"
        >
          {formatLiveDateTime(now)}
        </span>
      </div>
    </div>
  );
}
 



function MarketTickerContent({ marketData }: { marketData: any }) {
  return (
    <div
      dir="rtl"
      className="inline-flex items-center whitespace-nowrap px-6 text-sm font-semibold text-cyan-100"
    >
      <Landmark className="mx-2 inline h-4 w-4 shrink-0 text-cyan-300" />
      <span className="text-cyan-300">
        ריבית בנק ישראל עומדת על {marketData ? `${marketData.bankRate.toFixed(2)}%` : "טוען..."}
      </span>

      <span className="mx-3 shrink-0 text-cyan-300/30">•</span>

      <TrendingUp className="mx-2 inline h-4 w-4 shrink-0 text-red-400" />
      <span className="text-red-400">
        ריבית הפריים עומדת על {marketData ? `${marketData.primeRate.toFixed(2)}%` : "טוען..."}
      </span>

      <span className="mx-3 shrink-0 text-cyan-300/30">•</span>

      <BarChart3 className="mx-2 inline h-4 w-4 shrink-0 text-emerald-400" />
      <span className="text-emerald-400">
        {marketData
          ? `מדד ${marketData.cpiMonth} ${marketData.cpiYear}: ירידה של ${Math.abs(marketData.cpiChange)}% (עודכן ב-${marketData.cpiUpdatedAt})`
          : "טוען מדד..."}
      </span>

      <span className="mx-3 shrink-0 text-cyan-300/30">•</span>

      <CircleDollarSign className="mx-2 inline h-4 w-4 shrink-0 text-emerald-300" />
      <span className="text-emerald-300">
        שער הדולר עומד על {marketData ? `${marketData.usdIls.toFixed(3)} ₪` : "טוען..."}
      </span>
    </div>
  );
}

function MarketTicker({ marketData }: { marketData: any }) {
  return (
    <div className="glass-card gradient-border overflow-hidden rounded-2xl px-4 py-3">
      <div className="market-ticker-viewport">
        <div className="market-ticker-track">
          {Array.from({ length: 8 }).map((_, index) => (
            <MarketTickerContent key={index} marketData={marketData} />
          ))}
        </div>
      </div>
    </div>
  );
}

function getUserName(email?: string) {
  const users: Record<string, string> = {
    "raz.zituni@icloud.com": "רז",
    "roeyshaltiel1@gmail.com": "רועי",
    "hodr@shlomo.co.il": "הוד",
    "idank@shlomo.co.il": "עידן",
    "liatc@shlomo.co.il": "ליאת",
  };

  return email ? users[email.toLowerCase()] || email : "";
}
function getUserAvatar(email?: string) {
  if (email?.toLowerCase() === "roeyshaltiel1@gmail.com") {
    return "https://hfxvqkvymbhyaclziavo.supabase.co/storage/v1/object/public/avatars/roey.jpeg";
  }
  if (email?.toLowerCase() === "hodr@shlomo.co.il") {
    return "https://hfxvqkvymbhyaclziavo.supabase.co/storage/v1/object/public/avatars/hod.jpeg";
  }
  if (email?.toLowerCase() === "idank@shlomo.co.il") {
    return "https://hfxvqkvymbhyaclziavo.supabase.co/storage/v1/object/public/avatars/idan.jpeg";
  }
  if (email?.toLowerCase() === "liatc@shlomo.co.il") {
    return "https://hfxvqkvymbhyaclziavo.supabase.co/storage/v1/object/public/avatars/liat.jpeg";
  }
  return "https://hfxvqkvymbhyaclziavo.supabase.co/storage/v1/object/public/avatars/raz.jpeg";
}

function getUserHeaderLogo(email?: string) {
  const logos: Record<string, string> = {
    "raz.zituni@icloud.com": "/header-logo.png",
    "roeyshaltiel1@gmail.com": "/logos/roi-header-logo.png",
    "idank@shlomo.co.il": "/headers/idan-header.png",
    "liatc@shlomo.co.il": "/headers/liat-header.png",
  };

  return email ? logos[email.toLowerCase()] ?? "/header-logo.png" : "/header-logo.png";
}

function ForgotPasswordModal({
  email,
  onEmailChange,
  onClose,
  onSubmit,
  isLoading,
  isSuccess,
  error,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
}) {
  const canSubmit = email.trim().includes("@") && !isLoading && !isSuccess;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="איפוס סיסמה"
    >
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card gradient-border relative z-10 w-full max-w-sm rounded-2xl border border-cyan-500/25 bg-slate-950/95 p-4 shadow-[0_0_32px_rgba(34,211,238,0.18)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-cyan-300/80 transition-colors hover:bg-cyan-500/10 hover:text-cyan-100"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-base font-bold text-cyan-100 sm:text-lg">איפוס סיסמה</h2>
        </div>

        {isSuccess ? (
          <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-center text-sm font-semibold text-emerald-200">
            נשלח אליך קישור לאיפוס הסיסמה
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-cyan-200/85">
                כתובת מייל
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                className="input-neon w-full"
                placeholder="name@example.com"
                autoFocus
              />
            </label>

            {error ? (
              <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-center text-xs font-semibold text-rose-200">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={onSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <span className="h-4 w-4 rounded-full border-2 border-cyan-300/20 border-t-cyan-300 animate-spin shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
              ) : (
                "שלח קישור לאיפוס"
              )}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function ChangePasswordModal({
  newPassword,
  confirmPassword,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onClose,
  onSubmit,
  isLoading,
  isSuccess,
  error,
}: {
  newPassword: string;
  confirmPassword: string;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
}) {
  const isValid = newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="שינוי סיסמה"
    >
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card gradient-border relative z-10 w-full max-w-sm rounded-2xl border border-cyan-500/25 bg-slate-950/95 p-4 shadow-[0_0_32px_rgba(34,211,238,0.18)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-cyan-300/80 transition-colors hover:bg-cyan-500/10 hover:text-cyan-100"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="flex items-center gap-2 text-base font-bold text-cyan-100 sm:text-lg">
            <Lock className={CRM_NEON_ICON_CLASS} />
            שינוי סיסמה
          </h2>
        </div>

        {isSuccess ? (
          <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-center text-sm font-semibold text-emerald-200">
            הסיסמה עודכנה בהצלחה
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-cyan-200/85">
                סיסמה חדשה
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => onNewPasswordChange(e.target.value)}
                className="input-neon w-full"
                autoFocus
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-cyan-200/85">
                אימות סיסמה חדשה
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => onConfirmPasswordChange(e.target.value)}
                className="input-neon w-full"
              />
            </label>

            {newPassword.length > 0 && newPassword.length < 8 ? (
              <p className="text-xs text-cyan-200/70">הסיסמה חייבת להכיל לפחות 8 תווים</p>
            ) : null}

            {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
              <p className="text-xs text-cyan-200/70">הסיסמאות אינן תואמות</p>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-center text-xs font-semibold text-rose-200">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!isValid || isLoading}
              onClick={onSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <span className="h-4 w-4 rounded-full border-2 border-cyan-300/20 border-t-cyan-300 animate-spin shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
              ) : (
                "עדכון סיסמה"
              )}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

let newDealSuccessAudio: HTMLAudioElement | null = null;

function playNewDealSuccessSound() {
  if (typeof window === "undefined") return;

  try {
    if (!newDealSuccessAudio) {
      newDealSuccessAudio = new Audio("/sounds/success.mp3");
      newDealSuccessAudio.preload = "auto";
    }

    newDealSuccessAudio.volume = 0.4;
    newDealSuccessAudio.currentTime = 0;
    void newDealSuccessAudio.play().catch(() => {});
  } catch {
    // ignore browser autoplay / audio errors
  }
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function getDashboardEntranceProps(prefersReducedMotion: boolean, index = 0) {
  if (prefersReducedMotion) {
    return { initial: false as const, animate: { opacity: 1, y: 0 } };
  }

  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.42, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] as const },
  };
}

function getDashboardInteractionProps(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) return {};

  return {
    whileHover: { y: -2 },
    whileTap: { scale: 0.98 },
    transition: { type: "tween" as const, duration: 0.18 },
  };
}

function DashboardReveal({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <motion.div
      className={className}
      {...getDashboardEntranceProps(prefersReducedMotion, index)}
      {...getDashboardInteractionProps(prefersReducedMotion)}
    >
      {children}
    </motion.div>
  );
}

export default function Home() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activePage, setActivePage] = useState<PageTab>("dashboard");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<UserRole>("agent");
  const [canViewAs, setCanViewAs] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
const [loginPassword, setLoginPassword] = useState("");
const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [formData, setFormData] = useState<DealFormData>(defaultFormState);
  const [isManualCarModelEntry, setIsManualCarModelEntry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetsByPeriod, setTargetsByPeriod] = useState<MonthlyTargetsByPeriod>({});
  const [selectedPeriodValue, setSelectedPeriodValue] = useState(() =>
    getDefaultDashboardPeriodValue(),
  );
  const [marketData, setMarketData] = useState<any>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [isManagementMenuOpen, setIsManagementMenuOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminAuthUser[]>([]);
  const [isLoadingAdminUsers, setIsLoadingAdminUsers] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [viewedUserId, setViewedUserId] = useState<string | null>(null);
  const [viewedUserEmail, setViewedUserEmail] = useState<string | null>(null);
  const managementMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const dataLoadedForUserIdRef = useRef<string | null>(null);
  const effectiveUserId = viewedUserId ?? currentUser?.id;
  const isViewingAsUser = Boolean(canViewAs && viewedUserId);
  const showManagementButton = canAccessManagement(userRole);
  const showPersonalDashboard = hasPersonalDashboard(userRole) || isViewingAsUser;
  const showPersonalDeals = hasPersonalDeals(userRole) || isViewingAsUser;

  useEffect(() => {
    let cancelled = false;

    async function checkActivityLogAccess(accessToken: string) {
      try {
        const response = await fetch("/api/admin/activity-log-access", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (cancelled) return;

        const allowed = Boolean(data.allowed);
        setShowActivityLog(allowed);
        if (!allowed) {
          setIsActivityLogOpen(false);
        }
      } catch {
        if (!cancelled) {
          setShowActivityLog(false);
          setIsActivityLogOpen(false);
        }
      }
    }

    function clearActivityLogAccess() {
      setShowActivityLog(false);
      setIsActivityLogOpen(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === "SIGNED_OUT") {
        setCurrentUser(null);
        clearActivityLogAccess();
        return;
      }

      if (event === "PASSWORD_RECOVERY") {
        setIsChangePasswordOpen(true);
      }

      if (!session?.access_token) {
        clearActivityLogAccess();
        return;
      }

      void checkActivityLogAccess(session.access_token);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const logUserActivity = useCallback(
    (
      actionType: Parameters<typeof logActivity>[0]["actionType"],
      description: string,
      dealId?: string | null,
      notificationContext?: ActivityNotificationContext | null,
    ) => {
      if (!currentUser?.id) return;
      void logActivity({
        userId: currentUser.id,
        userName: getUserName(currentUser.email),
        userEmail: currentUser.email ?? null,
        actionType,
        description,
        dealId,
        notificationContext,
      });
    },
    [currentUser],
  );

  const loadAdminUsers = useCallback(async () => {
    setIsLoadingAdminUsers(true);
    setAdminUsersError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setAdminUsers([]);
        setAdminUsersError("לא ניתן לטעון משתמשים");
        return;
      }

      const response = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        setAdminUsers([]);
        setAdminUsersError(data.error || "שגיאה בטעינת משתמשים");
        return;
      }

      setAdminUsers(data.users ?? []);
    } catch {
      setAdminUsers([]);
      setAdminUsersError("שגיאה בטעינת משתמשים");
    } finally {
      setIsLoadingAdminUsers(false);
    }
  }, []);

  const closeForgotPasswordModal = useCallback(() => {
    setIsForgotPasswordOpen(false);
    setForgotPasswordEmail("");
    setForgotPasswordSuccess(false);
    setForgotPasswordError(null);
    setForgotPasswordLoading(false);
  }, []);

  const handleForgotPasswordSubmit = useCallback(async () => {
    const email = forgotPasswordEmail.trim();
    if (!email.includes("@")) return;

    setForgotPasswordLoading(true);
    setForgotPasswordError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });

    setForgotPasswordLoading(false);

    if (error) {
      setForgotPasswordError(error.message);
      return;
    }

    setForgotPasswordSuccess(true);
  }, [forgotPasswordEmail]);

  const closeChangePasswordModal = useCallback(() => {
    setIsChangePasswordOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    setChangePasswordSuccess(false);
    setChangePasswordError(null);
    setChangePasswordLoading(false);
  }, []);

  const handleChangePasswordSubmit = useCallback(async () => {
    if (newPassword.length < 8 || newPassword !== confirmPassword) return;

    setChangePasswordLoading(true);
    setChangePasswordError(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    setChangePasswordLoading(false);

    if (error) {
      setChangePasswordError(error.message);
      return;
    }

    setChangePasswordSuccess(true);
    setNewPassword("");
    setConfirmPassword("");

    window.setTimeout(() => {
      closeChangePasswordModal();
    }, 1500);
  }, [newPassword, confirmPassword, closeChangePasswordModal]);

  useEffect(() => {
    async function initialize() {
      let user = null;

      try {
        const {
          data: { user: authUser },
          error,
        } = await supabase.auth.getUser();

        if (error) {
          if (isInvalidAuthSessionError(error)) {
            user = null;
          } else {
            if (isTransientAuthNetworkError(error)) {
              console.warn(
                "Supabase auth unavailable (transient), using cached session:",
                error.message,
              );
            }
            const {
              data: { session },
            } = await supabase.auth.getSession();
            user = session?.user ?? null;
          }
        } else {
          user = authUser;
        }
      } catch (error) {
        if (isInvalidAuthSessionError(error)) {
          user = null;
        } else if (isTransientAuthNetworkError(error)) {
          console.warn(
            "Supabase auth network failure (transient), using cached session:",
            error,
          );
          const {
            data: { session },
          } = await supabase.auth.getSession();
          user = session?.user ?? null;
        } else {
          console.warn("Supabase auth initialization failed:", error);
          const {
            data: { session },
          } = await supabase.auth.getSession();
          user = session?.user ?? null;
        }
      }

      setCurrentUser(user);

      if (user) {
        const { role, canViewAs: viewAs } = await loadUserRole(user.id);
        setUserRole(role);
        setCanViewAs(viewAs);

        if (role === "admin") {
          setActivePage("amortization");
        }
      } else {
        setUserRole("agent");
        setCanViewAs(false);
        setDeals([]);
      }

      setAgents(loadAgents());
      setSelectedPeriodValue(getDefaultDashboardPeriodValue());
      setStorageReady(true);
    }

    void initialize();
  }, []);
  useEffect(() => {
    if (!canViewAs && viewedUserId) {
      setViewedUserId(null);
      setViewedUserEmail(null);
    }
  }, [canViewAs, viewedUserId]);
  useEffect(() => {
    if (!currentUser?.id || !effectiveUserId) return;

    if (userRole === "admin" && !viewedUserId) {
      setDeals([]);
      setTargetsByPeriod({});
      dataLoadedForUserIdRef.current = effectiveUserId;
      return;
    }

    let cancelled = false;

    async function reloadEffectiveUserData() {
      dataLoadedForUserIdRef.current = null;
      const loadedDeals = await loadDeals(effectiveUserId);
      const loadedTargets = await loadKpiTargets(effectiveUserId);

      if (cancelled) return;

      setDeals(loadedDeals);
      setTargetsByPeriod(loadedTargets);
      setSelectedPeriodValue(getDefaultDashboardPeriodValue());
      dataLoadedForUserIdRef.current = effectiveUserId;
    }

    reloadEffectiveUserData();

    return () => {
      cancelled = true;
    };
  }, [effectiveUserId, currentUser?.id, userRole, viewedUserId]);
  useEffect(() => {
    if (!isManagementMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        managementMenuRef.current &&
        !managementMenuRef.current.contains(event.target as Node)
      ) {
        setIsManagementMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isManagementMenuOpen]);
  useEffect(() => {
    if (!isUserMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);
  useEffect(() => {
    if (!isManagementMenuOpen || !canViewOtherUsers(userRole)) return;
    loadAdminUsers();
  }, [isManagementMenuOpen, userRole, loadAdminUsers]);
  useEffect(() => {
    if (
      (activePage === "dashboard" && !showPersonalDashboard) ||
      ((activePage === "add" || activePage === "list") && !showPersonalDeals)
    ) {
      setActivePage("amortization");
    }
  }, [activePage, showPersonalDashboard, showPersonalDeals]);
  useEffect(() => {
    async function loadMarketData() {
      try {
        const response = await fetch("/api/market");
        const data = await response.json();
        setMarketData(data);
      } catch (error) {
        console.error("Error loading market data:", error);
      }
    }
  
    loadMarketData();
  }, []);
  useEffect(() => {
    if (!storageReady || !effectiveUserId) return;
    if (dataLoadedForUserIdRef.current !== effectiveUserId) return;
    if (userRole === "admin" && !viewedUserId) return;
    localStorage.setItem(getDealsStorageKey(effectiveUserId), JSON.stringify(deals));
  }, [deals, storageReady, effectiveUserId, userRole, viewedUserId]);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
  }, [agents, storageReady]);

  const agentOptions = useMemo(
    () => mergeAgentOptions(agents, deals),
    [agents, deals],
  );

  const tickerDeals = useMemo(() => sortDealsForTicker(deals), [deals]);

  const dashboardPeriod = useMemo(
    () => parseDashboardPeriod(selectedPeriodValue),
    [selectedPeriodValue],
  );
  const isDashboardYearlyView = dashboardPeriod?.kind === "year";

  const monthlyTargets = useMemo(
    () => getTargetsForPeriod(targetsByPeriod, selectedPeriodValue),
    [targetsByPeriod, selectedPeriodValue],
  );

  const periodDeals = useMemo(
    () => deals.filter((deal) => isDealInPeriod(deal, dashboardPeriod)),
    [deals, dashboardPeriod],
  );

  const completedPeriodDeals = useMemo(
    () => periodDeals.filter((deal) => isSignedContractStatus(deal.status)),
    [periodDeals],
  );

  const monthlyApprovedDeals = completedPeriodDeals.length;

  const regularCompletedDeals = useMemo(
    () => completedPeriodDeals.filter(isRegularFinancing),
    [completedPeriodDeals],
  );

  const subsidizedDealsCount = useMemo(
    () => completedPeriodDeals.filter((deal) => deal.financingType === "מסובסד").length,
    [completedPeriodDeals],
  );

  const monthlyProfitableDeals = useMemo(
    () =>
      regularCompletedDeals.filter(
        (deal) =>
          deal.interestRate >= monthlyTargets.profitabilityMinInterestRate,
      ).length,
    [regularCompletedDeals, monthlyTargets.profitabilityMinInterestRate],
  );

  const totalDeals = completedPeriodDeals.length;
  const totalFinancing = useMemo(
    () => completedPeriodDeals.reduce((sum, deal) => sum + deal.financingAmount, 0),
    [completedPeriodDeals],
  );
  const avgInterest = useMemo(
    () =>
      regularCompletedDeals.length
        ? regularCompletedDeals.reduce((sum, deal) => sum + deal.interestRate, 0) /
          regularCompletedDeals.length
        : 0,
    [regularCompletedDeals],
  );

  const rankedAgents = useMemo(() => {
    const agentMap = new Map<
      string,
      { count: number; totalAmount: number; avgInterest: number; sumInterest: number }
    >();
    for (const deal of completedPeriodDeals) {
      const agentKey = normalizeAgentName(deal.agentName);
      if (!agentKey) continue;
      const current = agentMap.get(agentKey) ?? {
        count: 0,
        totalAmount: 0,
        avgInterest: 0,
        sumInterest: 0,
      };
      current.count += 1;
      current.totalAmount += deal.financingAmount;
      current.sumInterest += deal.interestRate;
      current.avgInterest = current.sumInterest / current.count;
      agentMap.set(agentKey, current);
    }
    return [...agentMap.entries()]
      .map(([agent, data]) => ({ agent, ...data }))
      .sort((a, b) => b.totalAmount - a.totalAmount || b.count - a.count);
  }, [completedPeriodDeals]);

  const topPerformer = rankedAgents[0];
  const maxDealsByAgent = Math.max(...rankedAgents.map((agent) => agent.count), 1);

  const resetForm = () => {
    setFormData(defaultFormState);
    setIsManualCarModelEntry(false);
    setEditingId(null);
  };

  const handleAddAgent = () => {
    const trimmed = normalizeAgentName(newAgentName);
    if (!trimmed) return;
    setAgents((prev) => {
      if (prev.includes(trimmed)) return prev;
      return [...prev, trimmed].sort((a, b) => a.localeCompare(b, "he"));
    });
    setFormData((prev) => ({ ...prev, agentName: trimmed }));
    setNewAgentName("");
    setIsAgentModalOpen(false);
  };

  const handleDeleteAgent = (name: string) => {
    setAgents((prev) => prev.filter((agent) => agent !== name));
    if (formData.agentName === name) {
      setFormData((prev) => ({ ...prev, agentName: "" }));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dealDate = normalizeDealDate(formData.date);
    if (
      !dealDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dealDate) ||
      !formData.agentName.trim() ||
      !formData.customerName.trim() ||
      !formData.carModel.trim()
    ) {
      return;
    }
const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  alert("יש להתחבר לפני שמירת עסקה");
  return;
}
    const agentName = normalizeAgentName(formData.agentName);

    if (editingId) {
      const { error: updateError } = await supabase
  .from("deals")
  .update({
    date: dealDate,
    agent_name: agentName,
    customer_name: formData.customerName,
    car_model: formData.carModel.trim(),
    vehicle_price: Number(formData.vehiclePrice),
    loan_term_months: normalizeLoanTermMonths(formData.loanTermMonths),
    financing_amount: Number(formData.financingAmount),
    interest_rate: Number(formData.interestRate),
    status: formData.status,
    financing_type: formData.financingType,
  })
  .eq("id", editingId)
  .eq("user_id", user.id);
      setDeals((prev) =>
        prev.map((deal) =>
          deal.id === editingId
            ? {
                ...deal,
                ...formData,
                date: dealDate,
                agentName,
                financingAmount: Number(formData.financingAmount),
                interestRate: Number(formData.interestRate),
                vehiclePrice: Number(formData.vehiclePrice),
                loanTermMonths: normalizeLoanTermMonths(formData.loanTermMonths),
              }
            : deal,
        ),
      );
      if (!updateError) {
        logUserActivity("deal_updated", "עסקה עודכנה", editingId);
      }
    } else {
      const { data: insertedDeal, error: insertError } = await supabase
  .from("deals")
  .insert({
    date: dealDate,
    user_id: user.id,
    agent_name: agentName,
    customer_name: formData.customerName,
    car_model: formData.carModel.trim(),
    vehicle_price: Number(formData.vehiclePrice),
    loan_term_months: normalizeLoanTermMonths(formData.loanTermMonths),
    financing_amount: Number(formData.financingAmount),
    interest_rate: Number(formData.interestRate),
    status: formData.status,
    financing_type: formData.financingType,
  })
  .select("id")
  .single();

      if (insertError || !insertedDeal) {
        return;
      }

      const newDeal: Deal = {
        id: insertedDeal.id,
        ...formData,
        date: dealDate,
        agentName,
        financingAmount: Number(formData.financingAmount),
        interestRate: Number(formData.interestRate),
        vehiclePrice: Number(formData.vehiclePrice),
        loanTermMonths: normalizeLoanTermMonths(formData.loanTermMonths),
      };
      setDeals((prev) => [newDeal, ...prev]);
      playNewDealSuccessSound();
      logUserActivity("deal_created", "נוצרה עסקה חדשה", insertedDeal.id);
    }

    resetForm();
    setActivePage("list");
  };

  const startEdit = (deal: Deal) => {
    setEditingId(deal.id);
    setIsManualCarModelEntry(!isKnownBydModel(deal.carModel));
    setFormData({
      date: deal.date,
      agentName: deal.agentName,
      customerName: deal.customerName,
      carModel: deal.carModel,
      vehiclePrice: deal.vehiclePrice,
      loanTermMonths: deal.loanTermMonths,
      financingAmount: deal.financingAmount,
      interestRate: deal.interestRate,
      status: deal.status,
      financingType: deal.financingType,
    });
    setActivePage("add");
  };

  const deleteDeal = async (id: string) => {
    const dealToDelete = deals.find((deal) => deal.id === id);
    const { data, error } = await supabase
  .from("deals")
  .delete()
  .eq("id", id)
  .select();

console.log("Deleted rows:", data);
console.log("Delete error:", error);
  
  console.log("Delete error:", error); 
  console.log("Deleting ID:", id);
    setDeals((prev) => prev.filter((deal) => deal.id !== id));
    if (editingId === id) resetForm();
    if (!error) {
      logUserActivity("deal_deleted", "עסקה נמחקה", id, dealToDelete
        ? {
            customer_name: dealToDelete.customerName,
            car_model: dealToDelete.carModel,
            amount:
              dealToDelete.financingAmount > 0
                ? dealToDelete.financingAmount
                : dealToDelete.vehiclePrice,
          }
        : undefined);
    }
  };

  const tabs: { key: PageTab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "דשבורד", icon: <ChartNoAxesCombined className="h-4 w-4" /> },
    { key: "add", label: "הוספת עסקה", icon: <PlusCircle className="h-4 w-4" /> },
    { key: "list", label: "רשימת עסקאות", icon: <ListChecks className="h-4 w-4" /> },
    {
      key: "amortization",
      label: "לוח סילוקין",
      icon: <Calculator className="h-4 w-4" />,
    },
  ];
  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === "dashboard") return showPersonalDashboard;
    if (tab.key === "add" || tab.key === "list") return showPersonalDeals;
    return true;
  });
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#03060d] text-white">
        <div className="w-full max-w-sm p-8 rounded-3xl border border-cyan-500/20 bg-slate-950/60">
       
          <h1 className="text-3xl font-bold mb-6 text-center text-cyan-300">
            כניסה למערכת
          </h1>
  
          <input
            type="email"
            placeholder="כתובת מייל"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            className="w-full mb-3 p-3 rounded-xl bg-slate-900/80 border border-cyan-500/20 focus:border-cyan-400 outline-none"
          />
  
          <input
            type="password"
            placeholder="סיסמא"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            className="w-full mb-2 p-3 rounded bg-slate-900 border border-slate-700"
          />

          <button
            type="button"
            onClick={() => {
              setForgotPasswordEmail(loginEmail);
              setForgotPasswordSuccess(false);
              setForgotPasswordError(null);
              setIsForgotPasswordOpen(true);
            }}
            className="mb-4 block w-full text-right text-xs font-medium text-cyan-300/80 transition-colors hover:text-cyan-200"
          >
            שכחת סיסמה?
          </button>
  
          <button
            onClick={async () => {
              setIsLoggingIn(true);
              await new Promise((resolve) => setTimeout(resolve, 800));
              const { data, error } = await supabase.auth.signInWithPassword({
                email: loginEmail,
                password: loginPassword,
              });
  
              if (error) {
                setIsLoggingIn(false);
                alert(error.message);
                return;
              }

              if (data.user) {
                await logActivity(
                  {
                    userId: data.user.id,
                    userName: getUserName(data.user.email),
                    userEmail: data.user.email ?? null,
                    actionType: "login",
                    description: "התחברות למערכת",
                  },
                  data.session?.access_token,
                );
              }

              window.location.reload();
            }}
            className="w-full p-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15 transition-all backdrop-blur shadow-[0_0_15px_rgba(34,211,238,0.15)]"
          >
            {isLoggingIn ? (
  <span className="mx-auto block h-5 w-5 rounded-full border-2 border-cyan-300/20 border-t-cyan-300 animate-spin shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
) : (
  "התחברות"
)}
          </button>
        </div>

        {isForgotPasswordOpen ? (
          <ForgotPasswordModal
            email={forgotPasswordEmail}
            onEmailChange={setForgotPasswordEmail}
            onClose={closeForgotPasswordModal}
            onSubmit={() => void handleForgotPasswordSubmit()}
            isLoading={forgotPasswordLoading}
            isSuccess={forgotPasswordSuccess}
            error={forgotPasswordError}
          />
        ) : null}
      </div>
    );
  }

  const displayUserName = getUserName(currentUser.email);

  return (
    <div className="min-h-screen bg-[#03060d] text-white">
      <div className="cinematic-bg pointer-events-none fixed inset-0" />

      <div className="mx-auto w-full max-w-6xl px-3 pb-12 app-safe-top sm:px-5 sm:pt-5">
        <header className="mission-header relative mb-3 text-center">
          <div className="mission-header__glow" aria-hidden />
          <div className="relative z-10">
          <div className="absolute top-0 left-0 flex items-center gap-2">
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsUserMenuOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.12)] backdrop-blur transition-all hover:bg-cyan-500/20 hover:text-cyan-100"
              >
                <User className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                חשבון
              </button>

              <AnimatePresence>
                {isUserMenuOpen ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="glass-card gradient-border absolute left-0 top-full z-50 mt-2 w-44 rounded-xl border border-cyan-500/25 bg-slate-950/80 p-2 shadow-[0_0_24px_rgba(34,211,238,0.2)] backdrop-blur"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        setChangePasswordSuccess(false);
                        setChangePasswordError(null);
                        setNewPassword("");
                        setConfirmPassword("");
                        setIsChangePasswordOpen(true);
                      }}
                      className="flex w-full flex-row-reverse items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-cyan-200 transition-all hover:bg-cyan-500/10 hover:text-cyan-100"
                    >
                      <Lock className={CRM_NEON_ICON_CLASS} />
                      שינוי סיסמה
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
              className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.12)] backdrop-blur hover:bg-cyan-500/20 hover:text-cyan-100 transition-all"
            >
              התנתקות
            </button>
          </div>
          {showManagementButton && (
            <div ref={managementMenuRef} className="absolute top-0 right-0 flex flex-row-reverse items-center gap-2">
              {canViewAs && viewedUserId && viewedUserEmail && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.12)] backdrop-blur">
                  <Eye className="h-3.5 w-3.5 shrink-0 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                  מצב מנהל | הנתונים של: {getUserName(viewedUserEmail)}
                </span>
              )}
              <button
                type="button"
                aria-expanded={isManagementMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsManagementMenuOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.12)] backdrop-blur transition-all hover:bg-cyan-500/20 hover:text-cyan-100"
              >
                <UserCog className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                ניהול
              </button>

              <AnimatePresence>
                {isManagementMenuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="glass-card gradient-border absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-cyan-500/25 bg-slate-950/80 p-2 shadow-[0_0_24px_rgba(34,211,238,0.2)] backdrop-blur"
                  >
                    <div className="max-h-56 space-y-1 overflow-y-auto px-1 py-1">
                      {isLoadingAdminUsers ? (
                        <div className="flex items-center justify-center py-4">
                          <span className="h-4 w-4 rounded-full border-2 border-cyan-300/20 border-t-cyan-300 animate-spin shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
                        </div>
                      ) : adminUsersError ? (
                        <p className="px-2 py-2 text-center text-xs text-cyan-200/75">
                          {adminUsersError}
                        </p>
                      ) : adminUsers.length === 0 ? (
                        <p className="px-2 py-2 text-center text-xs text-cyan-200/75">
                          אין משתמשים להצגה
                        </p>
                      ) : (
                        adminUsers.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            role="menuitem"
                            disabled={!canViewAs}
                            onClick={() => {
                              if (!canViewAs) return;
                              setViewedUserId(user.id);
                              setViewedUserEmail(user.email);
                              setActivePage("dashboard");
                              setIsManagementMenuOpen(false);
                              logUserActivity(
                                "view_as_changed",
                                `צפייה כמשתמש: ${getUserName(user.email)}`,
                              );
                            }}
                            className={`flex w-full flex-row-reverse items-center gap-2.5 rounded-lg px-2 py-2 text-right transition-all ${
                              !canViewAs
                                ? "cursor-not-allowed opacity-50"
                                : "hover:bg-cyan-500/10"
                            } ${
                              viewedUserId === user.id
                                ? "border border-cyan-400/25 bg-cyan-500/15"
                                : ""
                            }`}
                          >
                            <img
                              src={getUserAvatar(user.email)}
                              alt={getUserName(user.email)}
                              className="h-8 w-8 shrink-0 rounded-full border border-cyan-400 object-cover shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                            />
                            <div className="min-w-0 flex-1 text-right">
                              <p className="truncate text-xs font-semibold text-cyan-200">
                                {getUserName(user.email)}
                              </p>
                              <p className="truncate text-[11px] text-cyan-300/70">
                                {user.email}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    {showActivityLog ? (
                      <>
                        <div className="my-1 border-t border-cyan-400/20" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsActivityLogOpen(true);
                            setIsManagementMenuOpen(false);
                          }}
                          className="flex w-full flex-row-reverse items-center gap-2 rounded-lg px-3 py-2 text-right text-xs font-semibold text-cyan-200 transition-all hover:bg-cyan-500/10 hover:text-cyan-100"
                        >
                          <ScrollText className="h-4 w-4 shrink-0 text-cyan-300" />
                          יומן פעילות
                        </button>
                      </>
                    ) : null}
                    <div className="my-1 border-t border-cyan-400/20" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (viewedUserId) {
                          logUserActivity("view_as_changed", "חזרה לחשבון המנהל");
                        }
                        setViewedUserId(null);
                        setViewedUserEmail(null);
                        setIsManagementMenuOpen(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-right text-xs font-semibold text-cyan-200 transition-all hover:bg-cyan-500/10 hover:text-cyan-100"
                    >
                      חזרה לחשבון שלי
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
            <img
              src={getUserHeaderLogo(currentUser?.email)}
              alt="BYD Haifa"
              className="mx-auto block h-auto w-[75%] max-w-[560px] sm:w-[70%]"
            />

            <GreetingSection
              userName={displayUserName}
              avatarSrc={getUserAvatar(currentUser?.email)}
            />
            
          </div>

        </header>

        <nav
          className="glass-card gradient-border mb-5 grid gap-2 rounded-2xl p-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(visibleTabs.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {visibleTabs.map((item) => (
            <motion.button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              {...getDashboardInteractionProps(prefersReducedMotion)}
              className={`rounded-xl px-2 py-2 text-xs font-semibold transition sm:text-sm ${
                activePage === item.key
                  ? "nav-tab-active-glow bg-cyan-400/20 text-cyan-100"
                  : "text-cyan-100/70 hover:bg-cyan-300/10"
              }`}
            >
              <span className="mx-auto flex items-center justify-center gap-1.5">
                {item.icon}
                {item.label}
              </span>
            </motion.button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          {activePage === "dashboard" && showPersonalDashboard && (
            <motion.section
              key="dashboard"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              <DashboardReveal index={0}>
                <MarketTicker marketData={marketData} />
              </DashboardReveal>
              <DashboardReveal
                index={1}
                className="glass-card gradient-border floating-card rounded-2xl p-4"
              >
                <label className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
                    <CalendarDays className="h-4 w-4 text-cyan-300" />
                    סינון תקופה לדשבורד
                  </span>
                  <select
                    value={selectedPeriodValue}
                    onChange={(e) => setSelectedPeriodValue(e.target.value)}
                    className="input-neon w-full sm:max-w-xs"
                  >
                    {DASHBOARD_PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </DashboardReveal>

              {!isDashboardYearlyView ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <MonthlyTargetCard
                    key={`deals-target-${selectedPeriodValue}`}
                    entranceIndex={2}
                    periodKey={selectedPeriodValue}
                    title="יעד עסקאות"
                    subtitle="חוזה חתום בחודש הנבחר."
                    icon={<Target className="h-5 w-5" />}
                    target={monthlyTargets.dealsTarget}
                    actual={monthlyApprovedDeals}
                    onTargetChange={(dealsTarget) =>
                      setTargetsByPeriod((prev) => {
                        const next = patchTargetsForPeriod(prev, selectedPeriodValue, {
                          dealsTarget,
                        });
                        persistKpiTargetsIfReady(
                          effectiveUserId,
                          selectedPeriodValue,
                          { dealsTarget },
                          storageReady,
                          dataLoadedForUserIdRef.current,
                          userRole,
                          viewedUserId,
                        );
                        return next;
                      })
                    }
                    tone="cyan"
                  />
                  <MonthlyTargetCard
                    key={`profit-target-${selectedPeriodValue}`}
                    entranceIndex={3}
                    periodKey={selectedPeriodValue}
                    title="יעד רווחיות"
                    subtitle="עסקאות העומדות ביעד הרווחיות."
                    icon={<TrendingUp className="h-5 w-5" />}
                    target={monthlyTargets.profitabilityTarget}
                    actual={monthlyProfitableDeals}
                    minInterestRate={monthlyTargets.profitabilityMinInterestRate}
                    onMinInterestRateChange={(profitabilityMinInterestRate) =>
                      setTargetsByPeriod((prev) => {
                        const next = patchTargetsForPeriod(prev, selectedPeriodValue, {
                          profitabilityMinInterestRate,
                        });
                        persistKpiTargetsIfReady(
                          effectiveUserId,
                          selectedPeriodValue,
                          { profitabilityMinInterestRate },
                          storageReady,
                          dataLoadedForUserIdRef.current,
                          userRole,
                          viewedUserId,
                        );
                        return next;
                      })
                    }
                    onTargetChange={(profitabilityTarget) =>
                      setTargetsByPeriod((prev) => {
                        const next = patchTargetsForPeriod(prev, selectedPeriodValue, {
                          profitabilityTarget,
                        });
                        persistKpiTargetsIfReady(
                          effectiveUserId,
                          selectedPeriodValue,
                          { profitabilityTarget },
                          storageReady,
                          dataLoadedForUserIdRef.current,
                          userRole,
                          viewedUserId,
                        );
                        return next;
                      })
                    }
                    tone="green"
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <StatCard
                  entranceIndex={4}
                  title="סה״כ עסקאות"
                  value={totalDeals}
                  suffix=""
                  tone="blue"
                  icon={<Users className="h-4 w-4" />}
                />
                <StatCard
                  entranceIndex={5}
                  title="סה״כ מימון"
                  value={totalFinancing}
                  suffix=""
                  tone="cyan"
                  formatter={(value) => currency.format(value)}
                  icon={<CircleDollarSign className="h-4 w-4" />}
                />
                <StatCard
                  entranceIndex={6}
                  title="ריבית ממוצעת"
                  value={Number(avgInterest.toFixed(2))}
                  suffix="%"
                  decimals={2}
                  tone="green"
                  icon={<Percent className="h-4 w-4" />}
                />
                <StatCard
                  entranceIndex={7}
                  title="עסקאות מסובסדות"
                  value={subsidizedDealsCount}
                  suffix=""
                  tone="blue"
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
              </div>

              <DashboardReveal
                index={8}
                className="glass-card gradient-border floating-card rounded-2xl p-4"
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-100">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  כרטיסי דירוג סוכנים
                </h2>
                <div className="space-y-3">
                  {rankedAgents.length === 0 ? (
                    <p className="rounded-xl border border-cyan-400/20 bg-slate-900/45 p-4 text-sm text-cyan-200/75">
                      אין נתונים עדיין. הוסף עסקה חדשה כדי להתחיל.
                    </p>
                  ) : (
                    rankedAgents.map((agent, index) => {
                      const colorTheme = ["from-blue-500 via-cyan-400 to-cyan-300", "from-cyan-500 via-sky-400 to-blue-300", "from-emerald-500 via-cyan-400 to-green-300"][index % 3];
                      const rankTextColor = ["text-blue-300", "text-cyan-300", "text-emerald-300"][index % 3];
                      return (
                      <motion.div
                        key={agent.agent}
                        {...getDashboardEntranceProps(prefersReducedMotion, 9 + index)}
                        {...getDashboardInteractionProps(prefersReducedMotion)}
                        className="rounded-2xl border border-cyan-400/25 bg-slate-900/55 p-4 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                      >
                        <div className="mb-3 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-cyan-100 sm:text-base">{agent.agent}</p>
                            <p className="mt-0.5 text-xs text-cyan-200/75">
                              {agent.count} עסקאות | {currency.format(agent.totalAmount)}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold ${rankTextColor}`}>
                            #{index + 1}
                          </span>
                        </div>
                        <motion.div
                          className="h-2.5 overflow-hidden rounded-full bg-cyan-950/80"
                          initial={{ width: prefersReducedMotion ? "100%" : 0 }}
                          animate={{ width: "100%" }}
                          transition={{ duration: prefersReducedMotion ? 0 : 0.45 }}
                        >
                          <motion.div
                            initial={{ width: prefersReducedMotion ? `${Math.max((agent.count / maxDealsByAgent) * 100, 8)}%` : 0 }}
                            animate={{
                              width: `${Math.max((agent.count / maxDealsByAgent) * 100, 8)}%`,
                            }}
                            transition={{ duration: prefersReducedMotion ? 0 : 0.8, ease: "easeOut" }}
                            className={`h-full rounded-full bg-gradient-to-r ${colorTheme} shadow-[0_0_14px_rgba(34,211,238,1)]`}
                          />
                        </motion.div>

                        <div className="mt-3 flex items-end justify-between">
                          <p className="text-[11px] text-cyan-200/70">ביצועי סוכן</p>
                          <p className={`text-2xl font-black tracking-wide drop-shadow-[0_0_14px_rgba(34,211,238,0.55)] ${rankTextColor}`}>
                            {agent.count}
                          </p>
                        </div>
                      </motion.div>
                      );
                    })
                  )}
                </div>
              </DashboardReveal>

              <DashboardReveal
                index={10}
                className="glass-card gradient-border floating-card rounded-2xl p-4"
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-100">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  Top Performer
                </h2>
                {topPerformer ? (
                  <motion.div
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, delay: 0.08 }}
                    className="rounded-xl border border-cyan-300/35 bg-gradient-to-r from-cyan-600/20 via-blue-600/20 to-cyan-500/20 p-4 shadow-[0_0_25px_rgba(34,211,238,0.22)]"
                  >
                    <p className="text-lg font-bold text-cyan-50">{topPerformer.agent}</p>
                    <p className="text-sm text-cyan-200/80">
                      {topPerformer.count} עסקאות |{" "}
                      {currency.format(topPerformer.totalAmount)}
                    </p>
                  </motion.div>
                ) : (
                  <p className="text-sm text-cyan-200/70">טרם נבחר סוכן מוביל.</p>
                )}
              </DashboardReveal>

            
            </motion.section>
          )}

          {activePage === "add" && showPersonalDeals && (
            <motion.section
              key="add"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`glass-card gradient-border rounded-2xl border p-4 sm:p-5 ${
                editingId
                  ? getProfitabilityAccent(formData.interestRate).cardClass
                  : ""
              }`}
            >
              <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-cyan-100 sm:text-lg">
                {editingId && (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${getProfitabilityAccent(formData.interestRate).dotClass}`}
                    aria-hidden
                  />
                )}
                <PlusCircle className="h-4 w-4 text-cyan-300" />
                {editingId ? "עדכון עסקה" : "הוספת עסקה חדשה"}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="תאריך" icon={<CalendarDays className="h-4 w-4" />}>
                    <HebrewDateInput
                      value={formData.date}
                      onChange={(date) => setFormData((prev) => ({ ...prev, date }))}
                      required
                    />
                  </Field>

                  <Field label="סטטוס עסקה" icon={<Trophy className="h-4 w-4" />}>
                    <select
                      value={formData.status}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          status: e.target.value as DealStatus,
                        }))
                      }
                      className="input-neon"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status} className="bg-slate-900">
                          {status}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="סוג מימון" icon={<ShieldCheck className="h-4 w-4" />}>
                    <select
                      value={formData.financingType}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          financingType: e.target.value as FinancingType,
                        }))
                      }
                      className="input-neon"
                    >
                      {FINANCING_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type} className="bg-slate-900">
                          {type}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="שם סוכן" icon={<Users className="h-4 w-4" />}>
                  <div className="flex gap-2">
                    <select
                      required
                      value={formData.agentName}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, agentName: e.target.value }))
                      }
                      className="input-neon min-w-0 flex-1"
                    >
                      <option value="" className="bg-slate-900">
                        בחר סוכן
                      </option>
                      {formData.agentName &&
                        !agentOptions.includes(formData.agentName) && (
                          <option value={formData.agentName} className="bg-slate-900">
                            {formData.agentName}
                          </option>
                        )}
                      {agentOptions.map((agent) => (
                        <option key={agent} value={agent} className="bg-slate-900">
                          {agent}
                        </option>
                      ))}
                    </select>
                    <motion.button
                      type="button"
                      whileHover={{ y: -1, scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setIsAgentModalOpen(true)}
                      aria-label="הוספת סוכן"
                      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-cyan-300/45 bg-cyan-400/15 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.35)]"
                    >
                      <Plus className="h-4 w-4" />
                    </motion.button>
                  </div>
                </Field>

                <Field label="שם לקוח" icon={<Users className="h-4 w-4" />}>
                  <input
                    type="text"
                    required
                    value={formData.customerName}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, customerName: e.target.value }))
                    }
                    className="input-neon"
                    placeholder="לדוגמה: יוסי לוי"
                  />
                </Field>

                <Field label="דגם BYD" icon={<CarFront className="h-4 w-4" />}>
                  <select
                    value={
                      isManualCarModelEntry ? MANUAL_CAR_MODEL_OPTION : formData.carModel
                    }
                    onChange={(e) => {
                      const selection = e.target.value;
                      if (selection === MANUAL_CAR_MODEL_OPTION) {
                        setIsManualCarModelEntry(true);
                        setFormData((prev) => ({ ...prev, carModel: "" }));
                        return;
                      }
                      setIsManualCarModelEntry(false);
                      const price = BYD_PRICE_BY_MODEL[selection];
                      setFormData((prev) => ({
                        ...prev,
                        carModel: selection,
                        ...(price !== undefined ? { vehiclePrice: price } : {}),
                      }));
                    }}
                    className="input-neon"
                  >
                    {BYD_MODELS.map(({ model }) => (
                      <option key={model} value={model} className="bg-slate-900">
                        {model}
                      </option>
                    ))}
                    <option value={MANUAL_CAR_MODEL_OPTION} className="bg-slate-900">
                      {MANUAL_CAR_MODEL_OPTION}
                    </option>
                  </select>
                </Field>

                {isManualCarModelEntry && (
                  <Field label="דגם (הזנה ידנית)" icon={<CarFront className="h-4 w-4" />}>
                    <input
                      type="text"
                      required
                      value={formData.carModel}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, carModel: e.target.value }))
                      }
                      className="input-neon"
                      placeholder="הזן שם דגם"
                    />
                  </Field>
                )}

                <Field
                  label="מחיר רכב (₪)"
                  icon={<CircleDollarSign className="h-4 w-4" />}
                >
                  <input
                    type="number"
                    min={0}
                    required
                    value={formData.vehiclePrice}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        vehiclePrice: Number(e.target.value),
                      }))
                    }
                    className="input-neon"
                  />
                </Field>

                <Field
                  label="תקופה (חודשים)"
                  icon={<CalendarDays className="h-4 w-4" />}
                >
                  <LoanTermSelector
                    value={formData.loanTermMonths}
                    onChange={(loanTermMonths) =>
                      setFormData((prev) => ({ ...prev, loanTermMonths }))
                    }
                  />
                </Field>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="סכום מימון"
                    icon={<CircleDollarSign className="h-4 w-4" />}
                  >
                    <input
                      type="text"
                      min={0}
                      required
                      value={formData.financingAmount === 0 ? "" : formData.financingAmount}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          financingAmount: Number(e.target.value),
                        }))
                      }
                      className="input-neon"
                    />
                  </Field>

                  <Field label="ריבית " icon={<Percent className="h-4 w-4" />}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={formData.interestRate}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          interestRate: Number(e.target.value),
                        }))
                      }
                      className="input-neon"
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <motion.button
                    whileHover={{ y: -2, scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="submit"
                    className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 via-cyan-400 to-sky-300 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(56,189,248,0.75)]"
                  >
                    {editingId ? "שמור שינויים" : "שמור עסקה"}
                  </motion.button>
                  {editingId && (
                    <motion.button
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.99 }}
                      type="button"
                      onClick={resetForm}
                      className="rounded-xl border border-cyan-300/35 px-4 py-2.5 text-sm text-cyan-100"
                    >
                      ביטול
                    </motion.button>
                  )}
                </div>
              </form>
            </motion.section>
          )}

          {activePage === "list" && showPersonalDeals && (
            <motion.section
              key="list"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-3"
            >
              <div className="glass-card gradient-border rounded-2xl p-3">
  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-100">
    <CalendarDays className="h-4 w-4 text-cyan-300" />
   הצגת עסקאות לפי חודש
  </div>

  <select
    value={selectedPeriodValue}
    onChange={(e) => setSelectedPeriodValue(e.target.value)}
    className="mx-auto block w-[210px] rounded-xl border border-cyan-500/40 bg-slate-950 px-4 py-2.5 text-center text-sm font-bold text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)] outline-none"
  >
    {DASHBOARD_PERIOD_OPTIONS.map((option) => (
      <option key={option.value} value={option.value} className="bg-slate-900">
        {option.label}
      </option>
    ))}
  </select>
</div>
              {periodDeals.length === 0 ? (
                <div className="glass-card gradient-border rounded-2xl p-5 text-sm text-cyan-200/75">
                  אין עסקאות להצגה.
                </div>
              ) : (
                periodDeals.map((deal) => {
                  const profitability = getProfitabilityAccent(deal.interestRate);
                  return (
                  <motion.article
                    key={deal.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -3 }}
                    className={`glass-card gradient-border floating-card rounded-2xl border p-4 ${profitability.cardClass}`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold text-cyan-100">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${profitability.dotClass}`}
                            aria-hidden
                          />
                          {deal.customerName}
                        </p>
                        <p className="text-xs text-cyan-200/75 truncate">
                        <span className="whitespace-nowrap">
                        {deal.agentName} · {deal.carModel}· 
</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span
                          className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusStyle(deal.status)}`}
                        >
                          {deal.status}
                        </span>
                        <span className={`text-[10px] font-medium ${profitability.indicatorClass}`}>
                          {profitability.indicatorLabel}
                        </span>
                      </div>
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-cyan-100/85">
                      <p>תאריך: {formatDateIL(deal.date)}</p>
                      <p>סוג מימון: {deal.financingType}</p>
                      <p>תקופה: {formatLoanTerm(deal.loanTermMonths)}</p>
                      <p className={`flex items-center gap-1.5 ${profitability.rateClass}`}>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${profitability.dotClass}`}
                          aria-hidden
                        />
                        ריבית: {deal.interestRate}%
                      </p>
                      <p>מחיר רכב: {currency.format(deal.vehiclePrice)}</p>
                      <p>מימון: {currency.format(deal.financingAmount)}</p>
                    </div>
                    <div className="flex gap-2">
                      <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => startEdit(deal)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-blue-300/40 bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-100 shadow-[0_0_16px_rgba(59,130,246,0.25)]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        עריכה
                      </motion.button>
                      <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => deleteDeal(deal.id)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-100 shadow-[0_0_16px_rgba(244,63,94,0.22)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        מחיקה
                      </motion.button>
                    </div>
                  </motion.article>
                  );
                })
              )}
            </motion.section>
          )}

          {activePage === "amortization" && (
            <motion.section
              key="amortization"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <AmortizationScheduleTab
                onQuoteSent={(context) =>
                  logUserActivity("quote_sent", "נשלחה הצעת מחיר", null, context)
                }
              />
            </motion.section>
          )}
        </AnimatePresence>

        {isAgentModalOpen && (
          <AgentManagementModal
            agents={agents}
            newAgentName={newAgentName}
            onNewAgentNameChange={setNewAgentName}
            onAdd={handleAddAgent}
            onDelete={handleDeleteAgent}
            onClose={() => {
              setIsAgentModalOpen(false);
              setNewAgentName("");
            }}
          />
        )}
        {showActivityLog ? (
          <ActivityLogPanel
            open={isActivityLogOpen}
            onClose={() => setIsActivityLogOpen(false)}
          />
        ) : null}
        {isChangePasswordOpen ? (
          <ChangePasswordModal
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            onNewPasswordChange={setNewPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onClose={closeChangePasswordModal}
            onSubmit={() => void handleChangePasswordSubmit()}
            isLoading={changePasswordLoading}
            isSuccess={changePasswordSuccess}
            error={changePasswordError}
          />
        ) : null}
      </div>
    </div>
  );
}

function AmortizationScheduleTab({
  onQuoteSent,
}: {
  onQuoteSent?: (context: ActivityNotificationContext) => void;
}) {
  const [loanAmount, setLoanAmount] = useState("150000");
  const [termMonths, setTermMonths] = useState("60");
  const [annualRate, setAnnualRate] = useState("6.5");
  const [balloon, setBalloon] = useState("0");
  const [earlyPayoffMonth, setEarlyPayoffMonth] = useState(String(DEFAULT_EARLY_PAYOFF_MONTH));
  const [offerCarModel, setOfferCarModel] = useState<string>(BYD_MODELS[0].model);
  const [offerCustomerName, setOfferCustomerName] = useState("");
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);

  const result = useMemo(() => {
    const principal = Number(loanAmount);
    const months = Math.round(Number(termMonths));
    const rate = Number(annualRate);
    const balloonAmount = Number(balloon);
    if (
      !Number.isFinite(principal) ||
      !Number.isFinite(months) ||
      !Number.isFinite(rate) ||
      !Number.isFinite(balloonAmount)
    ) {
      return null;
    }
    return calculateLoanRepayment(principal, months, rate, balloonAmount);
  }, [loanAmount, termMonths, annualRate, balloon]);

  const loanTermMonths = result?.schedule.length ?? Math.max(1, Math.round(Number(termMonths)) || 1);

  const payoffMonth = useMemo(
    () => clampEarlyPayoffMonth(Number(earlyPayoffMonth), loanTermMonths),
    [earlyPayoffMonth, loanTermMonths],
  );

  const earlyPayoff = useMemo(() => {
    if (!result) return null;
    return calculateEarlyPayoff(result.schedule, payoffMonth);
  }, [result, payoffMonth]);

  useEffect(() => {
    setEarlyPayoffMonth((prev) => String(clampEarlyPayoffMonth(Number(prev), loanTermMonths)));
  }, [loanTermMonths]);

  const formatMoney = (value: number) => loanCurrency.format(value);

  const closeOfferModal = useCallback(() => {
    setIsOfferModalOpen(false);
  }, []);

  return (
    <>
      {!isOfferModalOpen ? (
    <div className="space-y-4">
      <motion.div className="glass-card gradient-border rounded-2xl p-4 sm:p-5">
        <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-cyan-100 sm:text-lg">
          <Calculator className="h-4 w-4 text-cyan-300" />
          לוח סילוקין
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="סכום הלוואה" icon={<CircleDollarSign className="h-4 w-4" />}>
            <input
              type="number"
              min={0}
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              className="input-neon"
            />
          </Field>
          <Field label="תקופה בחודשים" icon={<CalendarDays className="h-4 w-4" />}>
            <input
              type="number"
              min={1}
              value={termMonths}
              onChange={(e) => setTermMonths(e.target.value)}
              className="input-neon"
            />
          </Field>
          <Field label="ריבית שנתית" icon={<Percent className="h-4 w-4" />}>
            <input
              type="number"
              min={0}
              step={0.01}
              value={annualRate}
              onChange={(e) => setAnnualRate(e.target.value)}
              className="input-neon"
            />
          </Field>
          <Field label="בלון / יתרה בסוף תקופה" icon={<Target className="h-4 w-4" />}>
            <input
              type="number"
              min={0}
              value={balloon}
              onChange={(e) => setBalloon(e.target.value)}
              className="input-neon"
            />
          </Field>
          <Field label="דגם רכב (להצעה)" icon={<CarFront className="h-4 w-4" />}>
            <select
              value={offerCarModel}
              onChange={(e) => setOfferCarModel(e.target.value)}
              className="input-neon"
            >
              {BYD_MODELS.map((entry) => (
                <option key={entry.model} value={entry.model} className="bg-slate-900">
                  {entry.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="שם לקוח (להצעה)" icon={<Users className="h-4 w-4" />}>
            <input
              type="text"
              value={offerCustomerName}
              onChange={(e) => setOfferCustomerName(e.target.value)}
              className="input-neon"
              placeholder="לדוגמה: יוסי לוי"
            />
          </Field>
        </div>

        <motion.button
          type="button"
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          disabled={!result}
          onClick={() => setIsOfferModalOpen(true)}
          className="mt-5 w-full rounded-xl border border-cyan-300/45 bg-gradient-to-r from-cyan-600/25 via-blue-600/25 to-cyan-500/25 px-4 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          📤 הצעת מימון
        </motion.button>
      </motion.div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AmortizationOutputCard
          label="החזר חודשי"
          value={result ? formatMoney(result.monthlyPayment) : "—"}
        />
        <AmortizationOutputCard
          label="סך ריבית"
          value={result ? formatMoney(result.totalInterest) : "—"}
        />
        <AmortizationOutputCard
          label="סך החזר כולל"
          value={result ? formatMoney(result.totalRepayment) : "—"}
        />
        <AmortizationOutputCard
          label="יתרה בסוף תקופה"
          value={result ? formatMoney(result.endingBalance) : "—"}
        />
      </div>

      <motion.div className="glass-card gradient-border rounded-2xl p-4 sm:p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cyan-100 sm:text-base">
          <TrendingUp className="h-4 w-4 text-cyan-300" />
          סימולציית פירעון מוקדם
        </h3>
        <p className="mb-4 text-[11px] text-cyan-200/65 sm:text-xs">
          ללא עמלות פירעון מוקדם — מבוסס על לוח הסילוקין
        </p>

        <div className="mb-4 max-w-xs">
          <Field label="פירעון אחרי X חודשים" icon={<CalendarDays className="h-4 w-4" />}>
            <input
              type="number"
              min={1}
              max={loanTermMonths}
              value={earlyPayoffMonth}
              onChange={(e) => setEarlyPayoffMonth(e.target.value)}
              onBlur={() => {
                setEarlyPayoffMonth(String(payoffMonth));
              }}
              className="input-neon"
              disabled={!result}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AmortizationOutputCard
            label="סך ריבית ששולמה עד הפירעון"
            value={earlyPayoff ? formatMoney(earlyPayoff.totalInterestPaid) : "—"}
          />
          <AmortizationOutputCard
            label="יתרת קרן לפירעון בחודש X"
            value={earlyPayoff ? formatMoney(earlyPayoff.principalBalanceAtPayoff) : "—"}
          />
          <AmortizationOutputCard
            label="סך תשלומים ששולמו עד הפירעון"
            value={earlyPayoff ? formatMoney(earlyPayoff.totalPaymentsMade) : "—"}
          />
          <AmortizationOutputCard
            label="סך עלות בפועל עד הפירעון"
            value={earlyPayoff ? formatMoney(earlyPayoff.totalActualCost) : "—"}
          />
        </div>
      </motion.div>

      <motion.div className="glass-card gradient-border rounded-2xl p-4 sm:p-5">
        <h3 className="mb-4 text-sm font-semibold text-cyan-100">לוח סילוקין חודשי</h3>
        {!result ? (
          <p className="rounded-xl border border-cyan-400/20 bg-slate-900/45 p-4 text-sm text-cyan-200/75">
            הזן נתוני הלוואה תקינים כדי ליצור לוח סילוקין.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-cyan-400/20">
            <table className="min-w-full text-right text-xs text-cyan-100/90 sm:text-sm">
              <thead>
                <tr className="border-b border-cyan-400/25 bg-slate-900/65 text-cyan-200/80">
                  <th className="px-3 py-2.5 font-semibold">חודש</th>
                  <th className="px-3 py-2.5 font-semibold">החזר חודשי</th>
                  <th className="px-3 py-2.5 font-semibold">על חשבון ריבית</th>
                  <th className="px-3 py-2.5 font-semibold">על חשבון קרן</th>
                  <th className="px-3 py-2.5 font-semibold">יתרה</th>
                </tr>
              </thead>
              <tbody>
                {result.schedule.map((row) => (
                  <tr
                    key={row.month}
                    className="border-b border-cyan-400/10 bg-slate-900/35 even:bg-slate-900/50"
                  >
                    <td className="px-3 py-2" dir="ltr">
                      {row.month}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                      {formatMoney(row.payment)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                      {formatMoney(row.interest)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                      {formatMoney(row.principal)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                      {formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
      ) : null}

      <AnimatePresence>
        {isOfferModalOpen && result ? (
          <FinancingOfferModal
            customerName={offerCustomerName}
            onCustomerNameChange={setOfferCustomerName}
            carModel={offerCarModel}
            onCarModelChange={setOfferCarModel}
            financingAmount={Number(loanAmount)}
            termMonths={Math.round(Number(termMonths))}
            annualRate={Number(annualRate)}
            monthlyPayment={result.monthlyPayment}
            onClose={closeOfferModal}
            onReturnToSchedule={closeOfferModal}
            onShareSuccess={() =>
              onQuoteSent?.({
                customer_name: offerCustomerName.trim() || null,
                car_model: offerCarModel,
                amount: Number(loanAmount),
              })
            }
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function FinancingOfferModal({
  customerName,
  onCustomerNameChange,
  carModel,
  onCarModelChange,
  financingAmount,
  termMonths,
  annualRate,
  monthlyPayment,
  onClose,
  onReturnToSchedule,
  onShareSuccess,
}: {
  customerName: string;
  onCustomerNameChange: (name: string) => void;
  carModel: string;
  onCarModelChange: (model: string) => void;
  financingAmount: number;
  termMonths: number;
  annualRate: number;
  monthlyPayment: number;
  onClose: () => void;
  onReturnToSchedule: () => void;
  onShareSuccess?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const rateLabel = formatProposalRateLabel(annualRate);
  const shareText = buildFinancingOfferShareText(customerName);

  const captureOfferImage = useCallback(async () => {
    if (!cardRef.current) return null;
    return toPng(cardRef.current, {
      cacheBust: true,
      pixelRatio: 3,
      backgroundColor: "#03060d",
    });
  }, []);

  const downloadOfferImage = useCallback(
    async (filename = `byd-haifa-financing-${Date.now()}.png`) => {
      const dataUrl = await captureOfferImage();
      if (!dataUrl) return null;
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();
      return dataUrl;
    },
    [captureOfferImage],
  );

  const handleShare = useCallback(async () => {
    if (!cardRef.current || isExporting) return;

    if (!isMobileShareDevice()) {
      setShowExportDialog(true);
      return;
    }

    setIsExporting(true);
    try {
      const dataUrl = await captureOfferImage();
      if (!dataUrl) return;

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], "byd-haifa-financing-offer.png", { type: "image/png" });

      if ("share" in navigator && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "הצעת מימון BYD חיפה",
            text: shareText,
          });
          setShareSuccess(true);
          onShareSuccess?.();
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      if ("share" in navigator) {
        try {
          await navigator.share({
            title: "הצעת מימון BYD חיפה",
            text: shareText,
          });
          setShareSuccess(true);
          onShareSuccess?.();
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      setShowExportDialog(true);
    } finally {
      setIsExporting(false);
    }
  }, [captureOfferImage, isExporting, onShareSuccess, shareText]);

  const handleDownloadImage = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await downloadOfferImage("byd-haifa-financing-offer.png");
      setShareSuccess(true);
      onShareSuccess?.();
      setShowExportDialog(false);
    } finally {
      setIsExporting(false);
    }
  }, [downloadOfferImage, isExporting, onShareSuccess]);

  const handlePrintOffer = useCallback(() => {
    const logoUrl = `${window.location.origin}/logo.png`;
    const printHtml = buildFinancingOfferPrintHtml({
      customerName,
      carModel,
      financingAmount,
      termMonths,
      annualRate,
      monthlyPayment,
      logoUrl,
    });
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;

    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    if (printWindow.document.readyState === "complete") {
      triggerPrint();
    } else {
      printWindow.onload = triggerPrint;
    }
    setShowExportDialog(false);
  }, [
    annualRate,
    carModel,
    customerName,
    financingAmount,
    monthlyPayment,
    termMonths,
  ]);

  const handleReturnToSchedule = useCallback(() => {
    onReturnToSchedule();
  }, [onReturnToSchedule]);

  if (!isMounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden p-2 sm:p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[#03060d]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#03060d] via-[#060d18] to-[#03060d]"
      />
      <motion.button
        type="button"
        aria-label="סגירה"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-[#03060d]"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="relative z-10 flex w-full max-w-lg max-h-[calc(100dvh-0.75rem)] flex-col gap-1.5 overflow-hidden sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="glass-card gradient-border flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-300/35 bg-gradient-to-b from-slate-900 via-[#060d18] to-[#03060d] shadow-[0_0_48px_rgba(34,211,238,0.2)]">
          <div ref={cardRef} id="financing-offer-card" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="border-b border-cyan-400/20 bg-gradient-to-r from-cyan-500/10 via-transparent to-blue-500/10 px-3 pb-2 pt-3 sm:px-4">
              <img
                src="/logo.png"
                alt="BYD Haifa"
                className="mx-auto h-auto w-full max-w-[128px] drop-shadow-[0_0_16px_rgba(34,211,238,0.22)] sm:max-w-[150px]"
              />
              <h3 className="mt-1 text-center text-base font-bold tracking-wide text-cyan-50 sm:text-lg">
                הצעת מימון
              </h3>
            </div>

            <div className="space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="rounded-xl border border-cyan-400/20 bg-slate-900/45 px-2.5 py-2">
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-cyan-300/75 sm:text-[11px]">
                  <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  שם לקוח
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  placeholder="הזן שם לקוח"
                  className="input-neon w-full text-sm font-semibold text-cyan-50"
                />
              </div>

              <div className="rounded-xl border border-cyan-400/20 bg-slate-900/45 px-2.5 py-2">
                <label className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-cyan-300/75 sm:text-[11px]">
                  <CarFront className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  דגם רכב
                </label>
                <select
                  value={carModel}
                  onChange={(e) => onCarModelChange(e.target.value)}
                  className="input-neon w-full text-sm font-semibold text-cyan-50"
                >
                  {BYD_MODELS.map((entry) => (
                    <option key={entry.model} value={entry.model} className="bg-slate-900">
                      {entry.model}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <OfferDetailRow
                  compact
                  icon={<CircleDollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                  label="סכום מימון"
                  value={formatProposalShekels(financingAmount)}
                  valueDir="ltr"
                />
                <OfferDetailRow
                  compact
                  icon={<CalendarDays className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                  label="תקופה"
                  value={formatProposalTerm(termMonths)}
                  valueDir="ltr"
                />
                <OfferDetailRow
                  compact
                  icon={<Percent className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                  label="ריבית"
                  value={rateLabel}
                  valueDir="ltr"
                />
              </div>

              <div className="rounded-xl border border-cyan-300/35 bg-gradient-to-br from-cyan-500/15 via-slate-900/60 to-blue-600/10 px-3 py-3 text-center shadow-[inset_0_0_28px_rgba(34,211,238,0.08)] sm:py-3.5">
                <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-cyan-300/75 sm:text-[11px]">
                  החזר חודשי
                </p>
                <p
                  className="text-3xl font-black leading-none tracking-tight text-cyan-50 drop-shadow-[0_0_28px_rgba(34,211,238,0.5)] sm:text-4xl"
                  dir="ltr"
                >
                  {formatProposalShekels(monthlyPayment, 2)}
                </p>
              </div>
            </div>

            <div className="border-t border-cyan-400/15 bg-slate-950/60 px-3 py-2 sm:px-4">
              <p className="text-center text-[9px] leading-snug text-cyan-200/50 sm:text-[10px]">
                המימון מוצע על ידי שלמה מימון בע"מ, ח.פ. 515455137 מספר רישיון: 56249, חברה בעלת רישיון מורחב למתן אשראי מאת רשות שוק ההון, ביטוח וחיסכון, בכפוף לשיקול דעתה ולתנאיה. אי-עמידה בפירעון ההלוואה או בהחזר האשראי עלולה לגרור חיוב בריבית פיגורים והליכי הוצאה לפועל.
              </p>
            </div>
          </div>

          <div className="shrink-0 border-t border-cyan-400/15 bg-slate-900/40 p-2.5 sm:p-3">
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              disabled={isExporting}
              onClick={handleShare}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/40 bg-blue-500/15 px-4 py-2.5 text-sm font-semibold text-blue-50 shadow-[0_0_18px_rgba(59,130,246,0.22)] disabled:opacity-50"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              📤 שתף
            </motion.button>
          </div>
        </div>

        {shareSuccess ? (
          <p className="shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-200 sm:text-sm">
            ההצעה נשלחה בהצלחה
          </p>
        ) : null}

        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleReturnToSchedule}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-300/45 bg-gradient-to-r from-cyan-600/30 via-blue-600/30 to-cyan-500/30 px-4 py-2.5 text-sm font-bold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] sm:min-h-[48px] sm:text-base"
        >
          חזרה ללוח סילוקין
        </motion.button>
      </motion.div>
      </div>

      {showExportDialog ? (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="ייצוא הצעת מימון"
        >
          <button
            type="button"
            aria-label="סגירה"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowExportDialog(false)}
          />
          <div className="glass-card gradient-border relative z-10 w-full max-w-sm rounded-2xl border border-cyan-500/25 bg-slate-950/95 p-4 shadow-[0_0_32px_rgba(34,211,238,0.18)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowExportDialog(false)}
                className="rounded-lg p-1.5 text-cyan-300/80 transition-colors hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                <X className="h-5 w-5" />
              </button>
              <h2 className="text-base font-bold text-cyan-100 sm:text-lg">ייצוא הצעת מימון</h2>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleDownloadImage()}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-400/25 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
              >
                <Download className="h-4 w-4 shrink-0 text-cyan-300" />
                <span>הורד תמונה</span>
              </button>
              <button
                type="button"
                onClick={handlePrintOffer}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-400/25 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:bg-cyan-500/10"
              >
                <Printer className="h-4 w-4 shrink-0 text-cyan-300" />
                <span>הדפס / שמור PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setShowExportDialog(false)}
                className="flex w-full items-center justify-center rounded-xl border border-cyan-400/15 bg-transparent px-4 py-3 text-sm font-semibold text-cyan-200/80 transition-colors hover:bg-cyan-500/10 hover:text-cyan-50"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

function OfferDetailRow({
  icon,
  label,
  value,
  valueDir = "rtl",
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueDir?: "ltr" | "rtl";
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border border-cyan-400/15 bg-slate-900/45 ${
        compact ? "px-3 py-2" : "px-4 py-3"
      }`}
    >
      <span className={`flex items-center gap-1.5 text-cyan-200/75 ${compact ? "text-xs sm:text-sm" : "text-sm"}`}>
        <span className="text-cyan-300/70">{icon}</span>
        {label}
      </span>
      <span
        className={`font-semibold text-cyan-50 ${compact ? "text-xs sm:text-sm" : "text-sm sm:text-base"}`}
        dir={valueDir}
      >
        {value}
      </span>
    </div>
  );
}

function AmortizationOutputCard({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="glass-card gradient-border floating-card rounded-2xl p-4"
    >
      <p className="mb-1 text-[11px] text-cyan-200/70 sm:text-xs">{label}</p>
      <p className="text-xl font-black text-cyan-300 drop-shadow-[0_0_14px_rgba(34,211,238,0.45)] sm:text-2xl">
        <span dir="ltr" className="tabular-nums">
          {value}
        </span>
      </p>
    </motion.div>
  );
}

function DealActivityTicker({ deals }: { deals: Deal[] }) {
  const loopDeals = deals.length > 0 ? [...deals, ...deals] : [];
  const tickerDuration = `${Math.max(28, deals.length * 6)}s`;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="glass-card gradient-border floating-card overflow-hidden rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-cyan-400/15 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-100 sm:text-sm">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          פעילות עסקאות חיה
        </h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/55">LIVE</span>
      </div>

      {deals.length === 0 ? (
        <p className="px-4 py-3 text-xs text-cyan-200/70">
          אין עסקאות להצגה. הוסף עסקה חדשה כדי להפעיל את הטיקר.
        </p>
      ) : (
        <div
          className="deal-ticker-wrap relative py-2.5"
          dir="ltr"
          aria-live="polite"
          aria-label="טיקר פעילות עסקאות"
        >
          <div
            className="deal-ticker-track gap-0 px-3"
            style={{ "--ticker-duration": tickerDuration } as React.CSSProperties}
          >
            {loopDeals.map((deal, index) => (
              <TickerDealItem key={`${deal.id}-${index}`} deal={deal} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function TickerDealItem({ deal }: { deal: Deal }) {
  const accent = getTickerStatusAccent(deal.status);

  return (
    <div className="flex shrink-0 items-center">
      <div
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 ${accent.borderClass}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent.dotClass}`} aria-hidden />
        <span className={`text-[11px] font-semibold ${accent.textClass}`}>{deal.status}</span>
        <span className="text-cyan-400/25" aria-hidden>
          |
        </span>
        <span className="flex items-center gap-1 text-[11px] text-cyan-100/88">
          <Users className="h-3 w-3 text-cyan-300/70" aria-hidden />
          {deal.agentName}
        </span>
        <span className="text-cyan-400/25" aria-hidden>
          |
        </span>
        <span className="text-[11px] text-cyan-100/82">{deal.customerName}</span>
        <span className="text-cyan-400/25" aria-hidden>
          |
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-50/90">
          <CircleDollarSign className="h-3 w-3 text-cyan-300/65" aria-hidden />
          {currency.format(deal.financingAmount)}
        </span>
        <span className="text-cyan-400/25" aria-hidden>
          |
        </span>
        <span className="flex max-w-[11rem] items-center gap-1 truncate text-[11px] text-cyan-100/75 sm:max-w-none">
          <CarFront className="h-3 w-3 shrink-0 text-cyan-300/65" aria-hidden />
          <span className="truncate">{deal.carModel}</span>
        </span>
      </div>
      <span className="mx-5 shrink-0 text-[10px] text-cyan-400/35" aria-hidden>
        ◆
      </span>
    </div>
  );
}

function AgentManagementModal({
  agents,
  newAgentName,
  onNewAgentNameChange,
  onAdd,
  onDelete,
  onClose,
}: {
  agents: string[];
  newAgentName: string;
  onNewAgentNameChange: (value: string) => void;
  onAdd: () => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="סגירה"
        onClick={onClose}
        className="absolute inset-0 bg-[#03060d]/75 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card gradient-border relative z-10 w-full max-w-md rounded-2xl border p-4 sm:p-5"
      >
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-cyan-100">
          <Users className="h-4 w-4 text-cyan-300" />
          Add Agent
        </h3>

        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-cyan-200/85">
            Agent Name
          </span>
          <input
            type="text"
            value={newAgentName}
            onChange={(e) => onNewAgentNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            className="input-neon"
            placeholder="לדוגמה: דוד כהן"
            autoFocus
          />
        </label>

        <motion.button
          type="button"
          whileHover={{ y: -1, scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={onAdd}
          disabled={!newAgentName.trim()}
          className="mb-5 w-full rounded-xl bg-gradient-to-r from-blue-500 via-cyan-400 to-sky-300 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(56,189,248,0.75)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </motion.button>

        <div className="border-t border-cyan-400/20 pt-4">
          <p className="mb-3 text-xs font-medium text-cyan-200/80">סוכנים שמורים</p>
          {agents.length === 0 ? (
            <p className="rounded-xl border border-cyan-400/20 bg-slate-900/45 p-3 text-sm text-cyan-200/70">
              אין סוכנים שמורים עדיין.
            </p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {agents.map((agent) => (
                <li
                  key={agent}
                  className="flex items-center justify-between gap-2 rounded-xl border border-cyan-400/20 bg-slate-900/45 px-3 py-2"
                >
                  <span className="truncate text-sm text-cyan-100">{agent}</span>
                  <motion.button
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => onDelete(agent)}
                    aria-label={`מחיקת ${agent}`}
                    className="flex shrink-0 items-center justify-center rounded-lg border border-rose-300/40 bg-rose-500/15 p-1.5 text-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </motion.button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function MonthlyTargetCard({
  title,
  subtitle,
  icon,
  target,
  actual,
  onTargetChange,
  minInterestRate,
  onMinInterestRateChange,
  tone = "cyan",
  entranceIndex = 0,
  periodKey,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  target: number;
  actual: number;
  onTargetChange: (value: number) => void;
  minInterestRate?: number;
  onMinInterestRateChange?: (value: number) => void;
  tone?: "cyan" | "green";
  entranceIndex?: number;
  periodKey: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [draftTarget, setDraftTarget] = useState(String(target));
  const [draftMinInterest, setDraftMinInterest] = useState(
    String(minInterestRate ?? DEFAULT_PROFITABILITY_MIN_INTEREST_RATE),
  );
  const draftTargetRef = useRef(String(target));
  const draftMinInterestRef = useRef(String(minInterestRate ?? DEFAULT_PROFITABILITY_MIN_INTEREST_RATE));
  const targetRef = useRef(target);
  const minInterestRef = useRef(minInterestRate ?? DEFAULT_PROFITABILITY_MIN_INTEREST_RATE);
  const onTargetChangeRef = useRef(onTargetChange);
  const onMinInterestRateChangeRef = useRef(onMinInterestRateChange);
  const toneText = tone === "green" ? "text-emerald-300" : "text-cyan-300";
  const progressPercent = target > 0 ? Math.round((actual / target) * 100) : 0;
  const progressWidth = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
  const gradient =
    tone === "green"
      ? "from-emerald-500 via-cyan-400 to-green-300"
      : "from-blue-500 via-cyan-400 to-cyan-300";

  useEffect(() => {
    setDraftTarget(String(target));
    if (minInterestRate != null) {
      setDraftMinInterest(String(minInterestRate));
    }
  }, [periodKey, target, minInterestRate]);

  useEffect(() => {
    draftTargetRef.current = draftTarget;
  }, [draftTarget]);

  useEffect(() => {
    draftMinInterestRef.current = draftMinInterest;
  }, [draftMinInterest]);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    minInterestRef.current = minInterestRate ?? DEFAULT_PROFITABILITY_MIN_INTEREST_RATE;
  }, [minInterestRate]);

  useEffect(() => {
    onTargetChangeRef.current = onTargetChange;
  }, [onTargetChange]);

  useEffect(() => {
    onMinInterestRateChangeRef.current = onMinInterestRateChange;
  }, [onMinInterestRateChange]);

  useEffect(() => {
    return () => {
      const nextTarget = normalizeTarget(draftTargetRef.current, targetRef.current);
      if (nextTarget !== targetRef.current) {
        onTargetChangeRef.current(nextTarget);
      }

      if (onMinInterestRateChangeRef.current) {
        const nextMinInterest = normalizeInterestRate(
          draftMinInterestRef.current,
          minInterestRef.current,
        );
        if (nextMinInterest !== minInterestRef.current) {
          onMinInterestRateChangeRef.current(nextMinInterest);
        }
      }
    };
  }, [periodKey]);

  const commitTarget = () => {
    const nextTarget = normalizeTarget(draftTarget, target);
    setDraftTarget(String(nextTarget));
    if (nextTarget !== target) {
      onTargetChange(nextTarget);
    }
  };

  const commitMinInterest = () => {
    if (!onMinInterestRateChange || minInterestRate == null) return;
    const nextMinInterest = normalizeInterestRate(draftMinInterest, minInterestRate);
    setDraftMinInterest(String(nextMinInterest));
    if (nextMinInterest !== minInterestRate) {
      onMinInterestRateChange(nextMinInterest);
    }
  };

  const hasMinInterestInput = onMinInterestRateChange != null && minInterestRate != null;
  const targetInputClassName = hasMinInterestInput
    ? "input-neon w-full text-center text-sm font-bold"
    : "input-neon w-20 text-center text-sm font-bold sm:w-24";

  return (
    <motion.div
      {...getDashboardEntranceProps(prefersReducedMotion, entranceIndex)}
      {...getDashboardInteractionProps(prefersReducedMotion)}
      className="glass-card gradient-border floating-card rounded-2xl p-4 sm:p-5"
    >
      {hasMinInterestInput ? (
        <div className="mb-4 min-w-0">
          <h2 className={`flex items-center gap-2 text-sm font-semibold sm:text-base ${toneText}`}>
            {icon}
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[11px] text-cyan-200/70 sm:text-xs">{subtitle}</p>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="min-w-0 text-right">
              <span className="mb-1 block text-[10px] font-medium text-cyan-200/75">
                יעד עסקאות
              </span>
              <input
                type="number"
                min={0}
                value={draftTarget}
                onChange={(e) => setDraftTarget(e.target.value)}
                onBlur={commitTarget}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className={targetInputClassName}
              />
            </label>
            <label className="min-w-0 text-right">
              <span className="mb-1 block text-[10px] font-medium text-cyan-200/75">
                ריבית מינימום (%)
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={draftMinInterest}
                onChange={(e) => setDraftMinInterest(e.target.value)}
                onBlur={commitMinInterest}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className={targetInputClassName}
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`flex items-center gap-2 text-sm font-semibold sm:text-base ${toneText}`}>
              {icon}
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-[11px] text-cyan-200/70 sm:text-xs">{subtitle}</p>
            ) : null}
          </div>
          <label className="shrink-0 text-right">
            <span className="mb-1 block text-[10px] font-medium text-cyan-200/75">יעד</span>
            <input
              type="number"
              min={0}
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value)}
              onBlur={commitTarget}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className={targetInputClassName}
            />
          </label>
        </div>
      )}

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-cyan-200/70">יעד / ביצוע בפועל</p>
          <p className={`text-2xl font-black sm:text-3xl ${toneText} drop-shadow-[0_0_16px_rgba(34,211,238,0.55)]`}>
            <span dir="ltr" className="tabular-nums">
              {actual} / {target}
            </span>
          </p>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-cyan-200/70">אחוז השלמה</p>
          <p className={`text-2xl font-black sm:text-3xl ${toneText}`}>
            <span dir="ltr" className="tabular-nums">
              {progressPercent}%
            </span>
          </p>
        </div>
      </div>

      <div className="h-3 overflow-hidden rounded-full border border-cyan-400/25 bg-cyan-950/80 shadow-[inset_0_0_12px_rgba(34,211,238,0.12)]">
        <motion.div
          initial={{ width: prefersReducedMotion ? `${progressWidth}%` : 0 }}
          animate={{ width: `${progressWidth}%` }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.7, ease: "easeOut" }}
          className={`h-full rounded-full bg-gradient-to-r ${gradient} shadow-[0_0_18px_rgba(34,211,238,0.65)]`}
        />
      </div>
    </motion.div>
  );
}

function LoanTermSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (months: number) => void;
}) {
  const progress =
    ((value - LOAN_TERM_MIN) / (LOAN_TERM_MAX - LOAN_TERM_MIN)) * 100;

  return (
    <div className="w-full space-y-3">
      <p className="text-sm font-semibold tracking-wide text-cyan-50 drop-shadow-[0_0_14px_rgba(34,211,238,0.5)]">
        תקופה נבחרת: {formatLoanTerm(value)}
      </p>
      <input
        type="range"
        min={LOAN_TERM_MIN}
        max={LOAN_TERM_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="תקופה (חודשים)"
        className="loan-term-slider w-full"
        style={{ "--loan-term-progress": `${progress}%` } as React.CSSProperties}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  suffix,
  icon,
  decimals = 0,
  tone = "cyan",
  formatter,
  entranceIndex = 0,
}: {
  title: string;
  value: number;
  suffix: string;
  icon: React.ReactNode;
  decimals?: number;
  tone?: "blue" | "cyan" | "green";
  formatter?: (value: number) => string;
  entranceIndex?: number;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const toneText = {
    blue: "text-blue-300",
    cyan: "text-cyan-300",
    green: "text-emerald-300",
  }[tone];

  return (
    <motion.div
      {...getDashboardEntranceProps(prefersReducedMotion, entranceIndex)}
      {...getDashboardInteractionProps(prefersReducedMotion)}
      className="glass-card gradient-border floating-card kpi-card-glow rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={`mb-1 flex items-center gap-2 text-[11px] sm:text-xs ${toneText}`}>
            {icon}
            <span>{title}</span>
          </div>
          <p className="text-[11px] text-cyan-200/65">נתוני חודש נבחר</p>
        </div>
        <p className={`text-2xl font-black sm:text-3xl ${toneText} drop-shadow-[0_0_16px_rgba(34,211,238,0.62)]`}>
          <AnimatedCounter value={value} decimals={decimals} formatter={formatter} />
          {suffix}
        </p>
      </div>
    </motion.div>
  );
}

function HebrewDateInput({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (isoDate: string) => void;
  required?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(() => isoDateToDisplay(value));

  useEffect(() => {
    setDisplayValue(isoDateToDisplay(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      required={required}
      placeholder="31/05/2026"
      dir="ltr"
      value={displayValue}
      onChange={(e) => {
        const formatted = formatDisplayDateInput(e.target.value);
        setDisplayValue(formatted);
        if (formatted.length === 10) {
          const iso = displayDateToIso(formatted);
          if (iso !== null) onChange(iso);
        }
      }}
      onBlur={() => {
        const iso = displayDateToIso(displayValue);
        if (iso !== null) {
          onChange(iso);
          setDisplayValue(isoDateToDisplay(iso));
          return;
        }
        if (value) {
          setDisplayValue(isoDateToDisplay(value));
          return;
        }
        setDisplayValue("");
        onChange("");
      }}
      className="input-neon text-left tracking-wide"
      aria-label="תאריך בפורמט יום/חודש/שנה"
    />
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-cyan-200/85">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function AnimatedCounter({
  value,
  decimals = 0,
  formatter,
}: {
  value: number;
  decimals?: number;
  formatter?: (value: number) => string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    const duration = 700;
    const start = 0;
    const diff = value;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(start + diff * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };

    setDisplayValue(0);
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, prefersReducedMotion]);

  return (
    <>
      {formatter
        ? formatter(displayValue)
        : displayValue.toLocaleString("he-IL", {
            maximumFractionDigits: decimals,
            minimumFractionDigits: decimals,
          })}
    </>
  );
}
