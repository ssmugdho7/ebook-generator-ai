import { build } from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "cover-previews");
const BUNDLE = path.join(__dirname, ".cover-bundle.js");

const GOOD = {
  page_bg: "#fbfbfa",
  accent: "#f59e0b",
  heading: "#1c1917",
  text: "#44403c",
  muted: "#78716c",
  accent_soft: "#fef3c7",
  block_bg: "#f5f5f4",
  title_page_bg: "#f7f7f6",
};

const BAD_ACCENT = {
  page_bg: "#ffffff",
  accent: "#fef08a",
  heading: "#1e293b",
  text: "#334155",
  muted: "#64748b",
  accent_soft: "#fef9c3",
  block_bg: "#f3f4f6",
  title_page_bg: "#fafafa",
};

const TOPICS = [
  {
    id: "react-hooks",
    title: "React Hooks",
    subtitle: "A visual guide for modern frontend developers",
    tagline: "Start building today",
    expect: { category: "frontend", hero: "layers" },
  },
  {
    id: "mediterranean-kitchen",
    title: "The Mediterranean Kitchen",
    subtitle: "Fresh recipes for everyday cooking",
    tagline: "Slow food, fast weeknights",
    expect: { category: "food", hero: "coffee" },
  },
  {
    id: "long-productivity",
    title:
      "A Very Long and Comprehensive Title About Practical Productivity Systems for Busy Professionals",
    subtitle: "Habits, focus and workflows that survive real schedules",
    tagline: "",
    expect: { category: "productivity", hero: "target" },
  },
  {
    id: "strange-light",
    title: "Strange Light",
    subtitle: "Poems from the northern coast",
    tagline: "",
    expect: { category: "general", hero: "orb" },
  },
];

const STYLES = ["bold-editorial", "illustrated", "badge-grid", "dark-glow", "minimal-lux"];
const SIZE = { id: "standard", name: "Standard eBook", width: 1600, height: 2400, label: "1600 × 2400" };

const TEMPLATES = [];
for (const name of fs.readdirSync(path.join(ROOT, "backend", "templates")).filter((f) => f.endsWith(".json"))) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, "backend", "templates", name), "utf8"));
  const p = t.palette;
  TEMPLATES.push({
    id: name.replace(/\.json$/, ""),
    palette: {
      page_bg: p.page_bg,
      accent: p.accent,
      heading: p.heading,
      text: p.text,
      muted: p.muted,
      accent_soft: p.accent_soft,
      block_bg: p.block_bg,
      title_page_bg: p.title_page_bg,
    },
  });
}

await build({
  entryPoints: [path.join(__dirname, "cover-entry.ts")],
  bundle: true,
  format: "iife",
  globalName: "__covers",
  platform: "browser",
  alias: { "@": path.join(ROOT, "src") },
  outfile: BUNDLE,
  logLevel: "warning",
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.addScriptTag({ path: BUNDLE });

const results = await page.evaluate(
  async ({ topics, styles, size, good, bad, templates }) => {
    const C = window.__covers;
    const out = [];

    const rasterStats = async (svg, width, height) => {
      const canvas = await C.rasterizeCover(svg, width, height, 320);
      const ctx = canvas.getContext("2d");
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const px = canvas.width * canvas.height;
      const colors = new Set();
      let ink = 0;
      for (let i = 0; i < img.length; i += 16) {
        colors.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (Math.abs(r - 251) + Math.abs(g - 251) + Math.abs(b - 250) > 24) ink++;
      }
      const uniq = colors.size;
      const inkRatio = ink / Math.max(1, px / 4);
      return { canvas, uniq, inkRatio };
    };

    const textLayout = (svg) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      host.innerHTML = svg;
      const root = host.querySelector("svg");
      const W = parseFloat(root.getAttribute("width"));
      const H = parseFloat(root.getAttribute("height"));
      const texts = [...root.querySelectorAll("text")];
      const boxes = texts.map((t) => {
        const b = t.getBBox();
        const punch = t.querySelector("tspan[fill]");
        return {
          text: (t.textContent || "").slice(0, 28),
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
          punch: punch ? punch.textContent : null,
        };
      });
      host.remove();
      const violations = boxes.filter(
        (b) => b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1 || b.w <= 0 || b.h <= 0
      );
      return {
        W,
        H,
        textCount: boxes.length,
        violations,
        hasPunch: boxes.some((b) => b.punch),
        maxRight: Math.max(0, ...boxes.map((b) => b.x + b.w)),
        maxBottom: Math.max(0, ...boxes.map((b) => b.y + b.h)),
      };
    };

    for (const topic of topics) {
      const topicDetect = C.detectTopic(`${topic.title} ${topic.subtitle}`);
      const punchAuto = C.detectPunchWord(topic.title);
      const punchOpts = C.getPunchOptions(topic.title);
      for (const style of styles) {
        const render = (palette, punchWord) =>
          C.renderCover({
            title: topic.title,
            subtitle: topic.subtitle,
            tagline: topic.tagline,
            punchWord,
            styleId: style,
            size,
            palette,
          });
        const result = render(good, undefined);
        const checksOk = result.checks.every((c) => c.ok);
        const textSizes = [...result.svg.matchAll(/font-size="([^"]+)"/g)].map((m) => parseFloat(m[1]));
        const allTextPositive = textSizes.every((s) => s > 0) && textSizes.length > 0;
        const layout = textLayout(result.svg);
        const stats = await rasterStats(result.svg, result.width, result.height);
        const punch = result.info.punchWord;

        const badPunch = render(bad, undefined);
        const textChecks = badPunch.checks.filter((c) => c.min >= 4.5);
        const iconChecks = badPunch.checks.filter((c) => c.min < 4.5);

        out.push({
          topic: topic.id,
          style,
          category: topicDetect.category,
          hero: topicDetect.hero,
          punchAuto,
          punchUsed: punch,
          punchOptsCount: punchOpts.length,
          checksOk,
          checkCount: result.checks.length,
          iconCount: result.info.iconCount,
          allTextPositive,
          inBounds: layout.violations.length === 0,
          violations: layout.violations.length,
          textCount: layout.textCount,
          hasPunch: layout.hasPunch,
          uniq: stats.uniq,
          inkRatio: Math.round(stats.inkRatio * 1000) / 1000,
          badAccentChecksOk: badPunch.checks.every((c) => c.ok),
          badAccentMinTextRatio: Math.min(...textChecks.map((c) => c.ratio)),
          badAccentMinIconRatio: iconChecks.length
            ? Math.min(...iconChecks.map((c) => c.ratio))
            : null,
          png: stats.canvas.toDataURL("image/png"),
        });
      }
    }
    for (const tpl of templates) {
      for (const style of styles) {
        const result = C.renderCover({
          title: "React Hooks",
          subtitle: "A visual guide for modern frontend developers",
          tagline: "Start building today",
          punchWord: undefined,
          styleId: style,
          size,
          palette: tpl.palette,
        });
        const layout = textLayout(result.svg);
        const stats = await rasterStats(result.svg, result.width, result.height);
        const textChecks = result.checks.filter((c) => c.min >= 4.5);
        out.push({
          topic: `template:${tpl.id}`,
          style,
          category: "template",
          hero: "template",
          punchAuto: result.info.punchWord,
          punchUsed: result.info.punchWord,
          punchOptsCount: 0,
          checksOk: result.checks.every((c) => c.ok),
          checkCount: result.checks.length,
          iconCount: result.info.iconCount,
          allTextPositive: true,
          inBounds: layout.violations.length === 0,
          violations: layout.violations.length,
          textCount: layout.textCount,
          hasPunch: layout.hasPunch,
          uniq: stats.uniq,
          inkRatio: Math.round(stats.inkRatio * 1000) / 1000,
          badAccentChecksOk: true,
          badAccentMinTextRatio: Math.min(...textChecks.map((c) => c.ratio)),
          badAccentMinIconRatio: null,
          png: null,
        });
      }
    }
    return out;
  },
  { topics: TOPICS, styles: STYLES, size: SIZE, good: GOOD, bad: BAD_ACCENT, templates: TEMPLATES }
);

await browser.close();

fs.mkdirSync(OUT_DIR, { recursive: true });
let fails = 0;
const table = [];
for (const r of results) {
  const id = `${r.topic}__${r.style}`;
  if (r.png) {
    fs.writeFileSync(path.join(OUT_DIR, `${id}.png`), Buffer.from(r.png.split(",")[1], "base64"));
  }
  const ok =
    r.checksOk &&
    r.allTextPositive &&
    r.inBounds &&
    r.uniq > 3 &&
    r.inkRatio > 0.02 &&
    r.badAccentChecksOk &&
    r.badAccentMinTextRatio >= 4.5;
  if (!ok) fails++;
  table.push({
    combo: id,
    ok,
    checks: r.checksOk,
    inBounds: r.inBounds,
    punchRendered: r.hasPunch,
    minTextRatio: Math.round(r.badAccentMinTextRatio * 100) / 100,
    minIconRatio: r.badAccentMinIconRatio === null ? "-" : Math.round(r.badAccentMinIconRatio * 100) / 100,
    uniq: r.uniq,
    ink: r.inkRatio,
  });
}

console.table(table);
console.log(`\nTotal combos: ${results.length}, failures: ${fails}`);
console.log("Topic detection + punch:");
for (const t of TOPICS) {
  const r = results.find((x) => x.topic === t.id);
  const match = r.category === t.expect.category && r.hero === t.expect.hero;
  console.log(
    `  ${t.id}: category=${r.category} (expect ${t.expect.category}, ${match ? "OK" : "MISMATCH"}), ` +
      `hero=${r.hero} (expect ${t.expect.hero}), punchAuto=${r.punchAuto}, opts=${r.punchOptsCount}`
  );
  if (!match) fails++;
}
console.log(`Previews written to ${path.relative(process.cwd(), OUT_DIR)}`);
process.exit(fails === 0 ? 0 : 1);
