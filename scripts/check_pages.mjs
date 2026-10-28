// Smoke test: serve the site, open every page in headless Chrome and fail on JavaScript errors,
// missing local files or pages that don't render. Run by .github/workflows/check-pages.yml.
//
//   npm install --no-save puppeteer-core@23.11.1
//   CHROME=/path/to/chrome node scripts/check_pages.mjs
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";

async function pages(dir = ROOT, depth = 0) {
  const out = [];
  for (const name of await readdir(dir)) {
    if (name.startsWith(".") || ["node_modules", "data", "scripts", "assets", "tests"].includes(name)) continue;
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      if (depth < 2) out.push(...(await pages(path, depth + 1)));
    } else if (name === "index.html") {
      out.push(path.slice(ROOT.length).replace(/index\.html$/, "") || "/");
    }
  }
  return out;
}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
let failed = 0;
for (const path of await pages()) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  const problems = [];
  page.on("pageerror", (err) => problems.push(`script error: ${err.message}`));
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400 && !r.url().endsWith("favicon.ico")) problems.push(`${r.status()} ${r.url().slice(base.length)}`);
  });
  await page.goto(base + path, { waitUntil: "networkidle0", timeout: 60000 }).catch((err) => problems.push(`load: ${err.message}`));
  await new Promise((r) => setTimeout(r, 500));
  const charts = await page.evaluate(() => document.querySelectorAll("main svg, main table, main canvas, .pipeline").length);
  if (charts === 0) problems.push("nothing rendered (no charts or tables)");
  // Phone width: the page must not scroll sideways.
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 400));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 1) problems.push(`scrolls sideways by ${wide}px at 390px wide`);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${path} (${charts} charts/tables)`);
  problems.forEach((p) => console.log(`       ${p}`));
  if (problems.length) failed++;
  await page.close();
}
await browser.close();
server.close();
if (failed) {
  console.error(`${failed} page(s) failed`);
  process.exit(1);
}
