import { it, expect } from "vitest";
import { codeChallenge, randomToken, sha256Hex, base64url } from "@/background/pkce";

it("R-LOGIN-04: RFC 7636 appendix B", async () => {
  expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});
it("R-LOGIN-04: randomToken", () => expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/));
it("R-STO-09: sha256Hex", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
});
