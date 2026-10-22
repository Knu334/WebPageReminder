export const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const randomToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

const sha256 = async (data: ArrayBuffer | string): Promise<ArrayBuffer> =>
  crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);

export const codeChallenge = async (verifier: string): Promise<string> =>
  base64url(new Uint8Array(await sha256(verifier)));

export const sha256Hex = async (data: ArrayBuffer | string): Promise<string> =>
  [...new Uint8Array(await sha256(data))].map((b) => b.toString(16).padStart(2, "0")).join("");
