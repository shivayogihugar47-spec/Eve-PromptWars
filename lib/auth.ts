/**
 * Neon Auth helpers
 *
 * Neon Auth is Managed Better Auth. It injects two env vars:
 *   NEON_AUTH_BASE_URL  – Auth server base URL (includes database path segment)
 *   NEON_AUTH_JWKS_URL  – JWKS endpoint for verifying tokens server-side
 *
 * The app uses @neon/auth which wraps Better Auth's client methods
 * (signIn.email, getSession, etc.) and handles iframe-popup OAuth, JWT
 * provisioning, and Neon-specific OAuth verifier — do NOT use bare better-auth/client.
 *
 * Auth clients and protected route handlers are configured in ./auth/.
 */

/** Auth configuration read from environment. */
export const authConfig = {
  /** Auth server base URL – present when Neon Auth is enabled on the branch. */
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? "",

  /** JWKS endpoint for server-side token verification. */
  jwksUrl: process.env.NEON_AUTH_JWKS_URL ?? "",

  /** Whether auth env vars are present and non-empty. */
  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.jwksUrl && process.env.NEON_AUTH_COOKIE_SECRET && process.env.NEON_AUTH_COOKIE_SECRET.length >= 32);
  },
} as const;
