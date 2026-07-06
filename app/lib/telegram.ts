/**
 * Server-only Telegram Bot API helper.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export function isTelegramConfigured(): boolean {
  if (process.env.TELEGRAM_NOTIFICATIONS_ENABLED === "false") {
    return false;
  }

  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    return;
  }

  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.warn("telegram send failed:", response.status, body);
    }
  } catch (error) {
    console.warn(
      "telegram send failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
