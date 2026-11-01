import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "@/lib/apiRequest";

const schema = z.object({ name: z.string().max(5) });

function createRequest(body: string, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
    body,
  });
}

describe("parseJsonBody", () => {
  it("parses a valid, bounded JSON body", async () => {
    const result = await parseJsonBody(createRequest('{"name":"Eve"}'), schema);
    expect(result).toEqual({ success: true, data: { name: "Eve" } });
  });

  it("rejects malformed JSON and schema violations", async () => {
    const malformed = await parseJsonBody(createRequest("{"), schema);
    const invalid = await parseJsonBody(createRequest('{"name":"Eve Planner"}'), schema);
    expect(malformed).toMatchObject({ success: false, status: 400 });
    expect(invalid).toMatchObject({ success: false, status: 400 });
  });

  it("rejects bodies that exceed the declared or streamed byte limit", async () => {
    const declaredTooLarge = await parseJsonBody(
      createRequest('{"name":"Eve"}', { "content-length": "20" }),
      schema,
      10,
    );
    const streamedTooLarge = await parseJsonBody(createRequest('{"name":"Eve"}'), schema, 5);
    expect(declaredTooLarge).toMatchObject({ success: false, status: 413 });
    expect(streamedTooLarge).toMatchObject({ success: false, status: 413 });
  });
});
