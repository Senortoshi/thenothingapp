/**
 * IRI-6: Content Moderation Unit Tests
 *
 * Tests moderateComment from src/services/moderation.service.ts.
 *
 * Strategy:
 *   - When OPENAI_API_KEY is unset → keyword filter path
 *   - When OPENAI_API_KEY is set → OpenAI API path (fetch is mocked)
 *
 * All external I/O (fetch) is mocked via vi.spyOn.
 * NCMEC reporting is on standby (inline no-op in moderation.service.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  moderateComment,
  ModerationUnavailableError,
  buildCrisisResources,
} from "@/services/moderation.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOpenAiKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = key;
  }
}

function mockFetchResponse(status: number, body: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function mockFetchRejection(error: Error) {
  return vi.spyOn(global, "fetch").mockRejectedValueOnce(error);
}

// ---------------------------------------------------------------------------
// Keyword filter path (no OPENAI_API_KEY)
// ---------------------------------------------------------------------------

describe("moderateComment — keyword filter (no API key)", () => {
  beforeEach(() => setOpenAiKey(undefined));
  afterEach(() => vi.restoreAllMocks());

  it("approves clearly benign content", async () => {
    const result = await moderateComment("The weather today is lovely.");
    expect(result.approved).toBe(true);
  });

  it("approves a comment with XSS payload (stored raw; XSS is not a moderation violation)", async () => {
    const result = await moderateComment('<script>alert("xss")</script>');
    expect(result.approved).toBe(true);
  });

  it("approves an empty-looking comment (schema rejects empty, but moderation layer is lenient)", async () => {
    const result = await moderateComment("  ");
    expect(result.approved).toBe(true);
  });

  it("rejects content matching a credible threat pattern", async () => {
    const result = await moderateComment("I will kill you tonight");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("violence_threatening");
  });

  it("rejects content matching a bomb threat pattern", async () => {
    const result = await moderateComment("bomb threat at the school");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("violence_threatening");
  });

  it("rejects content matching a CSAM keyword (tier 1)", async () => {
    const result = await moderateComment("csam is illegal");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("csam");
  });

  it("rejects content matching child abuse pattern", async () => {
    const result = await moderateComment("child porn is wrong");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("csam");
  });

  it("rejects pedophilia keyword", async () => {
    const result = await moderateComment("pedophile ring exposed");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("csam");
  });

  it("returns violationDetails when content is rejected", async () => {
    const result = await moderateComment("I will kill you");
    expect(result.violationDetails).toBeDefined();
    expect(typeof result.violationDetails).toBe("string");
  });

  it("does not return violationCategory when content is approved", async () => {
    const result = await moderateComment("Totally fine message");
    expect(result.violationCategory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OpenAI API path (OPENAI_API_KEY set)
// ---------------------------------------------------------------------------

describe("moderateComment — OpenAI API path", () => {
  beforeEach(() => setOpenAiKey("sk-test-key-12345"));
  afterEach(() => {
    vi.restoreAllMocks();
    setOpenAiKey(undefined);
  });

  function openAiOkResponse(flagged: boolean, categories: Record<string, boolean> = {}) {
    return {
      id: "modr-test",
      model: "text-moderation-latest",
      results: [{ flagged, categories, category_scores: {} }],
    };
  }

  it("approves benign content that OpenAI does not flag", async () => {
    mockFetchResponse(200, openAiOkResponse(false));
    const result = await moderateComment("Nice day today.");
    expect(result.approved).toBe(true);
  });

  it("rejects content that OpenAI flags as hate speech", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { hate: true }));
    const result = await moderateComment("I hate [group]");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("hate_speech");
  });

  it("rejects content that OpenAI flags as violence", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { violence: true }));
    const result = await moderateComment("I will hurt you");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("violence");
  });

  it("rejects content flagged as sexual/minors (CSAM)", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "sexual/minors": true }));
    const result = await moderateComment("csam content here");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("csam");
  });

  it("maps unknown OpenAI category to the raw category name", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "some/new-category": true }));
    const result = await moderateComment("something new");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("some/new-category");
  });

  it("throws ModerationUnavailableError when fetch rejects (network failure) — fail CLOSED", async () => {
    mockFetchRejection(new Error("Network unreachable"));
    await expect(moderateComment("Hello")).rejects.toBeInstanceOf(
      ModerationUnavailableError
    );
  });

  it("throws ModerationUnavailableError on HTTP 500 from OpenAI — fail CLOSED", async () => {
    mockFetchResponse(500, { error: "Internal Server Error" });
    await expect(moderateComment("Hello")).rejects.toBeInstanceOf(
      ModerationUnavailableError
    );
  });

  it("throws ModerationUnavailableError on HTTP 429 (rate limited) — fail CLOSED", async () => {
    mockFetchResponse(429, { error: "Rate limited" });
    await expect(moderateComment("Hello")).rejects.toBeInstanceOf(
      ModerationUnavailableError
    );
  });

  it("throws ModerationUnavailableError when results array is empty — fail CLOSED", async () => {
    mockFetchResponse(200, { id: "x", model: "y", results: [] });
    await expect(moderateComment("Hello")).rejects.toBeInstanceOf(
      ModerationUnavailableError
    );
  });

  it("calls fetch with the correct OpenAI endpoint and API key", async () => {
    const spy = mockFetchResponse(200, openAiOkResponse(false));
    await moderateComment("Test");
    expect(spy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key-12345",
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// LB-10: Crisis resources — OpenAI self-harm categories
// ---------------------------------------------------------------------------

describe("moderateComment — crisis resources for self-harm categories (OpenAI path)", () => {
  beforeEach(() => setOpenAiKey("sk-test-key-12345"));
  afterEach(() => {
    vi.restoreAllMocks();
    setOpenAiKey(undefined);
  });

  function openAiOkResponse(flagged: boolean, categories: Record<string, boolean> = {}) {
    return {
      id: "modr-test",
      model: "text-moderation-latest",
      results: [{ flagged, categories, category_scores: {} }],
    };
  }

  it("includes crisisResources when OpenAI flags self-harm", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm": true }));
    const result = await moderateComment("I want to hurt myself");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("self_harm");
    expect(result.crisisResources).toBeDefined();
    expect(result.crisisResources?.message).toBe(
      "If you or someone you know is struggling, help is available."
    );
  });

  it("includes crisisResources when OpenAI flags self-harm/intent", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm/intent": true }));
    const result = await moderateComment("I am planning to end it");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("self_harm_intent");
    expect(result.crisisResources).toBeDefined();
  });

  it("includes crisisResources when OpenAI flags self-harm/instructions", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm/instructions": true }));
    const result = await moderateComment("instructions for self harm");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("self_harm_instructions");
    expect(result.crisisResources).toBeDefined();
  });

  it("crisisResources contains exactly two resources with required fields", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm": true }));
    const result = await moderateComment("self harm content");
    expect(result.crisisResources?.resources).toHaveLength(2);
    for (const r of result.crisisResources!.resources) {
      expect(r.name).toBeTruthy();
      expect(r.contact).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it("includes 988 Lifeline as the first resource", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm": true }));
    const result = await moderateComment("self harm content");
    expect(result.crisisResources?.resources[0].name).toBe("988 Suicide & Crisis Lifeline");
    expect(result.crisisResources?.resources[0].contact).toBe("Call or text 988");
    expect(result.crisisResources?.resources[0].url).toBe("https://988lifeline.org");
  });

  it("includes Crisis Text Line as the second resource", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { "self-harm": true }));
    const result = await moderateComment("self harm content");
    expect(result.crisisResources?.resources[1].name).toBe("Crisis Text Line");
    expect(result.crisisResources?.resources[1].contact).toBe("Text HOME to 741741");
    expect(result.crisisResources?.resources[1].url).toBe("https://www.crisistextline.org");
  });

  it("does NOT include crisisResources for non-self-harm violations", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { hate: true }));
    const result = await moderateComment("hate speech content");
    expect(result.approved).toBe(false);
    expect(result.violationCategory).toBe("hate_speech");
    expect(result.crisisResources).toBeUndefined();
  });

  it("does NOT include crisisResources for violence violations", async () => {
    mockFetchResponse(200, openAiOkResponse(true, { violence: true }));
    const result = await moderateComment("violent content");
    expect(result.crisisResources).toBeUndefined();
  });

  it("does NOT include crisisResources when content is approved", async () => {
    mockFetchResponse(200, openAiOkResponse(false));
    const result = await moderateComment("nice content");
    expect(result.approved).toBe(true);
    expect(result.crisisResources).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LB-10: buildCrisisResources — unit contract
// ---------------------------------------------------------------------------

describe("buildCrisisResources", () => {
  it("returns a message string", () => {
    const cr = buildCrisisResources();
    expect(typeof cr.message).toBe("string");
    expect(cr.message.length).toBeGreaterThan(0);
  });

  it("returns exactly two resources", () => {
    const cr = buildCrisisResources();
    expect(cr.resources).toHaveLength(2);
  });

  it("all resources have name, contact, and https url", () => {
    const cr = buildCrisisResources();
    for (const r of cr.resources) {
      expect(typeof r.name).toBe("string");
      expect(typeof r.contact).toBe("string");
      expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it("is idempotent — returns equal structures on each call", () => {
    expect(buildCrisisResources()).toEqual(buildCrisisResources());
  });
});

// ---------------------------------------------------------------------------
// ModerationUnavailableError — class contract
// ---------------------------------------------------------------------------

describe("ModerationUnavailableError", () => {
  it("is an instance of Error", () => {
    const err = new ModerationUnavailableError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name 'ModerationUnavailableError'", () => {
    const err = new ModerationUnavailableError("test");
    expect(err.name).toBe("ModerationUnavailableError");
  });

  it("carries the provided message", () => {
    const err = new ModerationUnavailableError("service down");
    expect(err.message).toBe("service down");
  });
});
