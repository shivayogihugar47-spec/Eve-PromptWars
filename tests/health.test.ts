import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ sql: mocks.sql }));

import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports healthy only when the database schema and AI configuration are ready", async () => {
    mocks.sql.mockResolvedValueOnce([{ result: 1 }]).mockResolvedValueOnce([]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "ok",
      openrouter: "configured",
    });
  });

  it("reports outdated schema when required tables or columns are missing", async () => {
    mocks.sql
      .mockResolvedValueOnce([{ result: 1 }])
      .mockRejectedValueOnce({ code: "42703" });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      database: "schema_outdated",
      openrouter: "configured",
    });
  });

  it("reports an unavailable database for non-schema readiness failures", async () => {
    mocks.sql
      .mockResolvedValueOnce([{ result: 1 }])
      .mockRejectedValueOnce(new Error("query failed"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      database: "unavailable",
      openrouter: "configured",
    });
  });

  it("reports an unavailable database when the connection check fails", async () => {
    mocks.sql.mockRejectedValueOnce(new Error("connection failed"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      database: "unavailable",
      openrouter: "configured",
    });
  });
});
