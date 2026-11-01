import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: mocks.create } };
  },
}));

import { llmJson } from "@/lib/llm";

describe("llmJson", () => {
  beforeEach(() => {
    mocks.create.mockReset();
  });

  it("does not retry the fallback model when the provider reports insufficient credits", async () => {
    const creditError = Object.assign(new Error("Insufficient credits"), { status: 402 });
    mocks.create.mockRejectedValue(creditError);

    await expect(llmJson(
      "Test prompt",
      [{ role: "user", content: "Unique credit test" }],
      z.object({ ok: z.boolean() }),
    )).rejects.toBe(creditError);

    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("gives the fallback model schema correction guidance after invalid JSON data", async () => {
    mocks.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ ok: "yes" }) } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      });

    await expect(llmJson(
      "Test prompt",
      [{ role: "user", content: "Unique schema correction test" }],
      z.object({ ok: z.boolean() }),
    )).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].messages[1].content).toContain("did not match the required JSON schema");
    expect(mocks.create.mock.calls[1][0].messages[1].content).toContain("ok");
  });
});
