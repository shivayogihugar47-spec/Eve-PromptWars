import { createNeonAuth } from "@neon/auth/next/server";

type AuthInstance = ReturnType<typeof createNeonAuth>;
let authInstance: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !cookieSecret || cookieSecret.length < 32) {
    throw new Error("Configure NEON_AUTH_BASE_URL and a 32-character NEON_AUTH_COOKIE_SECRET.");
  }
  authInstance ??= createNeonAuth({ baseUrl, cookies: { secret: cookieSecret } });
  return authInstance;
}

export async function getAuthenticatedUser() {
  const { data, error } = await getAuth().getSession();
  if (error) throw new Error("Unable to verify the current account session.");
  return data?.user ?? null;
}
