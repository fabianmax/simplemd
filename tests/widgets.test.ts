// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { TableWidget } from "../src/editor/live-preview/widgets";

describe("TableWidget sanitization (string-in/string-out, no hooks)", () => {
  it("renders a plain table", () => {
    const w = new TableWidget("| a | b |\n|---|---|\n| 1 | 2 |");
    const dom = w.toDOM();
    expect(dom.querySelector("table")).toBeTruthy();
    expect(dom.querySelectorAll("td").length).toBe(2);
  });

  it("strips script/img/event-handler injection attempts", () => {
    const evil =
      "| a |\n|---|\n| <script>alert(1)</script> <img src=x onerror=alert(1)> |";
    const dom = new TableWidget(evil).toDOM();
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector("img")).toBeNull();
    // markdown-it (html:false) escapes raw HTML to text; dangerous strings may
    // appear as visible TEXT — safe. No element may carry an event handler.
    for (const el of dom.querySelectorAll("*")) {
      expect(el.getAttributeNames().some((a) => a.startsWith("on"))).toBe(false);
    }
  });

  it("keeps safe inline formatting, drops data: URLs", () => {
    const md = "| a |\n|---|\n| **bold** [x](data:text/html,<script>) |";
    const dom = new TableWidget(md).toDOM();
    expect(dom.querySelector("strong")).toBeTruthy();
    const a = dom.querySelector("a");
    expect(a?.getAttribute("href") ?? "").not.toContain("data:");
  });
});
