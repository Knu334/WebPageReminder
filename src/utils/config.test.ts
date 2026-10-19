import { describe, it, expect } from "vitest";
import { normalizeConfig, configKey, isConfigured, originPatterns, loadSettings } from "@/utils/config";

const good = { apiBaseUrl: "https://a.example.com", authBaseUrl: "https://b.example.com", clientId: "abc123", imageHost: "https://c.example.com" };

describe("config", () => {
  it("R-CFG-02: normalizes", () => {
    expect(normalizeConfig({ ...good, apiBaseUrl: "https://a.example.com/" })).toEqual({ ok: true, config: good });
  });
  it("R-CFG-02: rejects bad urls", () => {
    for (const bad of ["http://a.example.com", "https://a.example.com/path", "https://a.example.com?q=1", "https://a.example.com#h", "not a url"])
      expect(normalizeConfig({ ...good, apiBaseUrl: bad }).ok).toBe(false);
    expect(normalizeConfig({ ...good, clientId: "ABC" }).ok).toBe(false);
  });
  it("R-STO-10 R-CFG-05: key and patterns", () => {
    expect(configKey(good)).toBe("https://a.example.com|https://b.example.com|abc123|https://c.example.com");
    expect(originPatterns(good)).toEqual(["https://a.example.com/*", "https://b.example.com/*", "https://c.example.com/*"]);
  });
  it("R-CFG-01: loadSettings drops old url and does not throw", async () => {
    await chrome.storage.local.set({ settings: { autoOpen: true, webPush: false, connectionType: "server", url: "http://localhost:3000" } });
    const s = await loadSettings();
    expect(s).not.toHaveProperty("url");
    expect(s.connectionType).toBe("server");
    expect(isConfigured(s)).toBe(false);
  });
  it("R-STO-05: loadSettings defaults when empty", async () => {
    expect((await loadSettings()).connectionType).toBe("local");
  });
});
