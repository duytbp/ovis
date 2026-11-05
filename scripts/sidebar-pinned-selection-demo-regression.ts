/**
 * A pinned agent's selected, hovered and keyboard-focused row stays inside its card's edge.
 * Runs the real demo at desktop and phone widths, in light and dark; uses no live herdr state.
 * Usage: UI_EVIDENCE_DIR=<dir> bun scripts/sidebar-pinned-selection-demo-regression.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import panes from "../site/demo/fixtures/panes.json";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

const app = mkdtempSync(join(tmpdir(), "ovis-pinned-selection-"));
const evidence = process.env["UI_EVIDENCE_DIR"];
const failures: string[] = [];
try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, '<script src="./demo-transport.js"></script><script type="module"'));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    let file: string;
    try { file = decodeURIComponent(new URL(request.url).pathname.slice(1)); }
    catch { return new Response("bad path", { status: 400 }); }
    if (!file || file.endsWith("/")) file += "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
  } });
  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
    try {
      for (const width of [1280, 390]) for (const mode of ["dark", "light"] as const) {
        const phone = width === 390;
        const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: mode, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, locale: "en-US" });
        try {
          await context.addInitScript(({ mode, ids }) => {
            localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme: mode, palette: "codex", defaultView: "chat" }));
            localStorage.setItem("ovis:sidebar-agent-pins", JSON.stringify(ids.map((id) => `local:${id}`)));
          }, { mode, ids: [panes.api, panes.web, panes.flaky, panes.omp] });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${server.port}/`);
          await page.locator(".conn-live").waitFor({ state: "attached" });
          const openSidebar = async () => {
            if (phone && await page.locator(".sidebar.is-open").count() === 0) {
              await page.getByRole("button", { name: "Open workspace list", exact: true }).click();
              await page.locator(".sidebar.is-open").waitFor();
            }
            const toggle = page.locator(".agent-section-toggle");
            if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
          };
          await openSidebar();
          const card = page.locator(".agents-sidebar .agent-list-pinned");
          await card.waitFor();
          assert.equal(await card.locator(".agent-item").count(), 4, "the fixture pins four synthetic agents");
          const inspect = async (state: string) => {
            const result = await card.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const css = getComputedStyle(element);
              const rows = [...element.querySelectorAll(".agent-item")].map((row) => {
                const rect = row.getBoundingClientRect();
                return { left: rect.left - box.left - parseFloat(css.borderLeftWidth), right: box.right - rect.right - parseFloat(css.borderRightWidth), radius: parseFloat(getComputedStyle(row).borderTopLeftRadius) };
              });
              return { padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map(parseFloat), radius: parseFloat(css.borderTopLeftRadius), rows };
            });
            console.log(JSON.stringify({ width, mode, state, ...result }));
            try {
              assert.ok(result.padding[0]! >= 8 && result.padding.slice(1).every((padding) => padding >= 4), "the agent-list reset must not erase the pinned card's padding");
              for (const row of result.rows) {
                assert.ok(row.left >= 3.9 && row.right >= 3.9, "every pinned row is inset from the frame, including the selected one");
                assert.ok(result.radius >= row.radius + 4, "the card's radius wraps the inset row's radius");
              }
            } catch (error) { failures.push(`${width}/${mode}/${state}: ${String(error)}`); }
          };
          for (const [name, index] of [["first", 0], ["middle", 1], ["last", 3]] as const) {
            await card.locator(".agent-item > .agent-row").nth(index).click();
            await openSidebar();
            await card.locator(".agent-item.is-selected").waitFor();
            await page.mouse.move(width - 1, 0);
            await inspect(`selected-${name}`);
            if (evidence) {
              mkdirSync(evidence, { recursive: true });
              await page.locator(".agents-sidebar").screenshot({ path: join(evidence, `pinned-${width}-${mode}-${name}.png`), animations: "disabled" });
            }
          }
          if (!phone) {
            await card.locator(".agent-item > .agent-row").nth(1).hover();
            await inspect("hover");
          }
          await card.locator(".agent-item.is-selected > .agent-row").focus();
          await page.keyboard.press("Shift");
          assert.ok(await card.locator(".agent-item.is-selected > .agent-row").evaluate((row) => row.matches(":focus-visible")), "keyboard selection keeps its visible focus ring");
          await inspect("focus");
          await page.emulateMedia({ forcedColors: "active" });
          assert.equal(await card.locator(".agent-item.is-selected").evaluate((row) => getComputedStyle(row, "::before").borderLeftStyle), "solid", "high contrast keeps the selected row's leading cue");
          assert.deepEqual(errors, [], "the demo has no page errors");
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  } finally { server.stop(true); }
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log("PASS pinned agent selection stays inset at 390 and 1280, light/dark, first/middle/last, hover, focus and forced colors");
} finally { rmSync(app, { recursive: true, force: true }); }
