import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeChoice,
  readThemeChoice,
  storeThemeChoice,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("theme choice", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts on system when nothing has been chosen", () => {
    expect(readThemeChoice()).toBe("system");
  });

  it("ignores a stored value that is not a theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");

    expect(readThemeChoice()).toBe("system");
  });

  it.each(["light", "dark"] as const)("round-trips %s", (choice) => {
    storeThemeChoice(choice);

    expect(readThemeChoice()).toBe(choice);
  });

  /**
   * `system` is the absence of the attribute, not the string "system". The
   * stylesheet keys on `:root:not([data-theme="light"])` inside its
   * prefers-color-scheme query, so a literal "system" would happen to work —
   * but only by not being the string "light", which is not a property worth
   * depending on.
   */
  it("stores system as the absence of a value", () => {
    storeThemeChoice("dark");
    storeThemeChoice("system");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemeChoice()).toBe("system");
  });

  it("applies an explicit choice to the document", () => {
    applyThemeChoice("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyThemeChoice("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes the attribute for system, rather than writing it", () => {
    applyThemeChoice("dark");
    applyThemeChoice("system");

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("survives storage that throws, as private browsing does", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    expect(readThemeChoice()).toBe("system");
    expect(() => storeThemeChoice("dark")).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("the theme applied before the app loads", () => {
  const root = path.resolve(__dirname, "../..");

  /**
   * The CSP is `script-src 'self'`, which refuses inline scripts. The theme
   * bootstrap was inline, so in production it never ran — and nothing failed
   * locally, because Vite's dev server sends no CSP at all.
   */
  it("keeps index.html free of inline scripts the CSP would refuse", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];

    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body.trim()).toBe("");
    }
  });

  it("reads the same key the app writes", () => {
    const bootstrap = fs.readFileSync(path.join(root, "public/theme-init.js"), "utf8");

    expect(bootstrap).toContain(`'${THEME_STORAGE_KEY}'`);
  });
});
