/**
 * telegram-alert.mjs — alertas Telegram opcionales para la demo.
 *
 * Lee credenciales desde el entorno (no commitear tokens):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   DEMO_TELEGRAM_ALERTS=true   (interruptor general, default: false)
 *
 * Si no está configurado o DEMO_TELEGRAM_ALERTS no es "true", las alertas se
 * imprimen en consola en modo MOCK y la función devuelve { sent: false, mock: true }.
 *
 * Inspirado en clientes/Talo/core/telegram_notifier.py (send_tamper_alarm),
 * reimplementado de forma autónoma para esta demo pública.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const ALERTS_ENABLED =
  (process.env.DEMO_TELEGRAM_ALERTS ?? "").trim().toLowerCase() === "true";

export function telegramConfigured() {
  return ALERTS_ENABLED && Boolean(TELEGRAM_BOT_TOKEN) && Boolean(TELEGRAM_CHAT_ID);
}

async function sendRaw(text) {
  if (!telegramConfigured()) {
    console.log("[MOCK TELEGRAM ALERT]");
    console.log(text);
    return { sent: false, mock: true };
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    return { sent: res.ok, mock: false, status: res.status };
  } catch (error) {
    console.error(`TELEGRAM ERROR: ${error.message}`);
    return { sent: false, mock: false, error: error.message };
  }
}

/** Alerta crítica: el agente se detuvo por ruptura de integridad (STOP_BY_INTEGRITY). */
export async function sendIntegrityStopAlert({ agent, failedAt, action, sandbox }) {
  const text = [
    "🚨 Agent stopped",
    "",
    `Agent: ${agent}`,
    "Reason: memory integrity failed",
    `Failed entry: ${failedAt}`,
    `Action blocked: ${action ?? "(none pending)"}`,
    `Sandbox: ${sandbox}`,
    "Human review required.",
  ].join("\n");

  return sendRaw(text);
}

/** Alerta suave: solicitud sensible retenida esperando al owner (WAIT_FOR_OWNER). */
export async function sendOwnerReviewAlert({ agent, action, memory, decision }) {
  const text = [
    "⚠️ Sensitive request held for owner review",
    "",
    `Agent: ${agent}`,
    `Action: ${action}`,
    "Reason: owner authorization missing",
    `Memory: ${memory}`,
    `Decision: ${decision}`,
  ].join("\n");

  return sendRaw(text);
}
