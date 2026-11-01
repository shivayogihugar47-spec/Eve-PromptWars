/**
 * Neon Functions client helpers
 *
 * Each deployed function gets a public HTTPS URL injected as an env var:
 *   NEON_FUNCTION_<SLUG_UPPERCASE>_BASE_URL
 *
 * Current deployed functions:
 *   hello  → NEON_FUNCTION_HELLO_BASE_URL
 *
 * Functions are long-running Node.js HTTP handlers that run next to your
 * Neon database in the same region. They are suitable for:
 *   - AI agents / LLM streaming that would timeout on Vercel edge
 *   - WebSocket / SSE servers
 *   - Webhook handlers
 *   - Scheduled (cron) work via Function Triggers
 *
 * Usage example (calling the hello function):
 *   const text = await callHello();
 *
 * The function URLs are branch-scoped — each branch (dev, preview, production)
 * runs its own isolated function at its own URL.
 */

/** Base URLs for deployed Neon Functions. */
export const functionUrls = {
  hello: process.env.NEON_FUNCTION_HELLO_BASE_URL ?? "",
} as const;

/**
 * Call the hello Neon Function and return its text response.
 * Used as a liveness probe in /api/health.
 */
export async function callHello(): Promise<string> {
  const base = functionUrls.hello;
  if (!base) throw new Error("NEON_FUNCTION_HELLO_BASE_URL is not set.");
  const res = await fetch(base);
  if (!res.ok) throw new Error(`hello function returned HTTP ${res.status}`);
  return res.text();
}
