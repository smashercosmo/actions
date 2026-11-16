import { describe, expect, expectTypeOf, it } from "vitest";

import type { Infer } from "./schema.ts";

import {
  array,
  boolean,
  number,
  object,
  optional,
  parse,
  string,
  url,
} from "./schema.ts";

const LABEL = "GitHub API GET /user";

describe("parse()", () => {
  it.for([
    ["string", string(), "octocat"],
    ["number", number(), 42],
    ["boolean", boolean(), false],
    ["URL", url(), "https://github.com/octocat"],
  ] as const)("should accept a %s", ([, schema, value]) => {
    expect.hasAssertions();

    expect(parse<unknown>(schema, value, LABEL)).toBe(value);
  });

  it.for([
    ["a string", string(), 42, "a number"],
    ["a number", number(), "42", "a string"],
    ["a boolean", boolean(), "true", "a string"],
    ["a URL", url(), "github.com", "a string"],
    ["a URL", url(), 42, "a number"],
    ["an array", array(string()), {}, "an object"],
    ["an object", object({}), [], "an array"],
    // oxlint-disable-next-line unicorn/no-null -- JSON has null, which has to be told apart from an object.
    ["an object", object({}), null, "null"],
    ["a string", string(), undefined, "nothing"],
  ] as const)(
    "should throw for something other than %s",
    ([expected, schema, value, got]) => {
      expect.hasAssertions();

      expect(() => parse(schema, value, LABEL)).toThrow(
        `${LABEL} returned an unexpected value: expected ${expected}, got ${got}`,
      );
    },
  );

  it("should check every item of an array", () => {
    expect.hasAssertions();

    expect(parse(array(number()), [1, 2], LABEL)).toStrictEqual([1, 2]);
    expect(() => parse(array(number()), [1, "2"], LABEL)).toThrow(
      "expected a number at [1], got a string",
    );
  });

  it("should keep only the properties of the shape", () => {
    expect.hasAssertions();

    const schema = object({ id: number(), login: string() });

    expect(
      parse(schema, { id: 1, login: "octocat", site_admin: false }, LABEL),
    ).toStrictEqual({ id: 1, login: "octocat" });
  });

  it("should tell where a nested value is wrong", () => {
    expect.hasAssertions();

    const schema = object({
      repository: object({ releases: array(object({ url: url() })) }),
    });

    expect(() =>
      parse(
        schema,
        { repository: { releases: [{ url: "https://x.y" }, { url: "x" }] } },
        LABEL,
      ),
    ).toThrow("expected a URL at repository.releases[1].url, got a string");
  });

  it("should throw for a missing property", () => {
    expect.hasAssertions();

    expect(() => parse(object({ id: number() }), {}, LABEL)).toThrow(
      "expected a number at id, got nothing",
    );
  });

  it("should accept a missing optional property", () => {
    expect.hasAssertions();

    const schema = object({ version: optional(string()) });

    expect(parse(schema, {}, LABEL)).toStrictEqual({ version: undefined });
    expect(parse(schema, { version: "1.0.0" }, LABEL)).toStrictEqual({
      version: "1.0.0",
    });
  });

  it("should not show the value that doesn't match", () => {
    expect.hasAssertions();

    expect(() =>
      parse(object({ token: number() }), { token: "ghs_secret" }, LABEL),
    ).toThrow(expect.not.stringContaining("ghs_secret"));
  });

  it("should type the result after the schema", () => {
    expect.hasAssertions();

    const schema = object({
      id: number(),
      tags: array(string()),
      draft: optional(boolean()),
      release: object({ url: url() }),
    });
    const value = { id: 1, tags: ["v1.0.0"], release: { url: "https://x.y" } };

    expectTypeOf<Infer<typeof schema>>().toEqualTypeOf<{
      id: number;
      tags: string[];
      draft: boolean | undefined;
      release: { url: string };
    }>();
    expect(parse(schema, value, LABEL)).toStrictEqual({
      ...value,
      draft: undefined,
    });
  });
});
