import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  // Warn at startup; hard errors will surface at query time.
  console.warn("[db] DATABASE_URL is not set.");
}

/**
 * Neon serverless SQL tag.
 * Usage: `await sql\`SELECT * FROM events WHERE id = ${id}\``
 */
export const sql = neon(process.env.DATABASE_URL ?? "");
