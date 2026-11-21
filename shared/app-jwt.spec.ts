import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createAppJwt } from "./app-jwt.ts";

const NOW = 1_800_000_000;

/** Match the RSA key shape GitHub generates for apps. */
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

/** GitHub app keys use both PEM encodings. */
const PKCS1_KEY = privateKey.export({ type: "pkcs1", format: "pem" });
const PKCS8_KEY = privateKey.export({ type: "pkcs8", format: "pem" });

/**
 * Decodes a JWT header or payload segment.
 *
 * @param part Base64url-encoded segment.
 * @returns The parsed JSON.
 */
function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Splits a JWT into the pieces assertions need.
 *
 * @param jwt The JWT.
 * @returns The decoded header and payload, the signed part, and the signature.
 */
function decode(jwt: string) {
  const [header = "", payload = "", signature = ""] = jwt.split(".");

  return {
    header: decodePart(header),
    payload: decodePart(payload),
    signed: `${header}.${payload}`,
    signature: Buffer.from(signature, "base64url"),
  };
}

describe("createAppJwt()", () => {
  it("should create a JWT signed with RS256", () => {
    expect.hasAssertions();

    const jwt = createAppJwt({
      clientId: "Iv23liabc",
      privateKey: PKCS1_KEY,
      now: NOW,
    });
    const { header, signed, signature } = decode(jwt);

    expect(jwt.split(".")).toHaveLength(3);
    expect(header).toStrictEqual({ alg: "RS256", typ: "JWT" });
    expect(verify("sha256", Buffer.from(signed), publicKey, signature)).toBe(
      true,
    );
  });

  it("should be issued by the app, a little in the past, for less than 10 minutes", () => {
    expect.hasAssertions();

    const { payload } = decode(
      createAppJwt({ clientId: "Iv23liabc", privateKey: PKCS1_KEY, now: NOW }),
    );

    expect(payload).toStrictEqual({
      iat: NOW - 30,
      exp: NOW - 30 + 600,
      iss: "Iv23liabc",
    });
  });

  it("should accept a PKCS#8 key", () => {
    expect.hasAssertions();

    const { signed, signature } = decode(
      createAppJwt({ clientId: "Iv23liabc", privateKey: PKCS8_KEY, now: NOW }),
    );

    expect(verify("sha256", Buffer.from(signed), publicKey, signature)).toBe(
      true,
    );
  });

  it("should accept a key with its line breaks escaped", () => {
    expect.hasAssertions();

    const escaped = PKCS1_KEY.replaceAll("\n", String.raw`\n`);
    const { signed, signature } = decode(
      createAppJwt({ clientId: "Iv23liabc", privateKey: escaped, now: NOW }),
    );

    expect(escaped).not.toContain("\n");
    expect(verify("sha256", Buffer.from(signed), publicKey, signature)).toBe(
      true,
    );
  });

  it.for([
    ["a backslash in front of it, as act passes it", `\\${PKCS8_KEY}`],
    [
      "indented lines",
      PKCS1_KEY.split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    ],
    ["Windows line breaks", PKCS8_KEY.replaceAll("\n", "\r\n")],
    ["no trailing line break", PKCS1_KEY.trim()],
  ] as const)("should accept a key with %s", ([, key]) => {
    expect.hasAssertions();

    const { signed, signature } = decode(
      createAppJwt({ clientId: "Iv23liabc", privateKey: key, now: NOW }),
    );

    expect(verify("sha256", Buffer.from(signed), publicKey, signature)).toBe(
      true,
    );
  });

  it("should throw for something that isn't a private key", () => {
    expect.hasAssertions();

    expect(() =>
      createAppJwt({ clientId: "Iv23liabc", privateKey: "not a key" }),
    ).toThrow("The private key of the GitHub App can't be read");
  });
});
