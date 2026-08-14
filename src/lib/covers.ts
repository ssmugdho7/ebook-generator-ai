import { ALL_ICONS, type BrandIcon, type LineIcon } from "@/lib/generated-icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverStyleId =
  | "bold-editorial"
  | "illustrated"
  | "badge-grid"
  | "dark-glow"
  | "dark-mono"
  | "dark-gradient"
  | "dark-neon"
  | "minimal-lux";

export interface CoverStyleMeta {
  id: CoverStyleId;
  name: string;
  hint: string;
}

export interface CoverSize {
  id: string;
  name: string;
  width: number;
  height: number;
  label: string;
}

export interface CoverPalette {
  page_bg: string;
  accent: string;
  heading: string;
  text: string;
  muted?: string;
  accent_soft?: string;
  block_bg?: string;
  title_page_bg?: string;
}

export interface CoverRequest {
  title: string;
  subtitle?: string;
  tagline?: string;
  punchWord?: string | null;
  styleId: CoverStyleId;
  size: CoverSize;
  palette: CoverPalette;
}

export interface ContrastCheck {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
}

export interface CoverResult {
  svg: string;
  width: number;
  height: number;
  styleId: CoverStyleId;
  checks: ContrastCheck[];
  info: {
    punchWord: string | null;
    category: string;
    hero: string;
    iconCount: number;
    titlePx: number;
    subtitlePx: number;
    lines: number;
  };
}

// ---------------------------------------------------------------------------
// Sizes + styles
// ---------------------------------------------------------------------------

export const COVER_SIZES: CoverSize[] = [
  { id: "standard", name: "Standard eBook", width: 1600, height: 2400, label: "1600 × 2400" },
  { id: "kindle", name: "Amazon Kindle", width: 1600, height: 2560, label: "1600 × 2560" },
  { id: "square", name: "Square (Social)", width: 1200, height: 1200, label: "1200 × 1200" },
  { id: "a4", name: "A4 Portrait", width: 2480, height: 3508, label: "2480 × 3508" },
  { id: "wide", name: "Wide Banner", width: 1920, height: 1080, label: "1920 × 1080" },
  { id: "booklet", name: "Booklet", width: 1200, height: 1800, label: "1200 × 1800" },
];

export const COVER_STYLES: CoverStyleMeta[] = [
  {
    id: "bold-editorial",
    name: "Bold Editorial",
    hint: "Big serif title on an ink slab",
  },
  { id: "illustrated", name: "Illustrated", hint: "Central hero illustration + icon row" },
  { id: "badge-grid", name: "Badge + Grid", hint: "Dot grid, icon chips gallery" },
  { id: "dark-glow", name: "Dark Glow", hint: "Dark field, radial accent glow" },
  { id: "dark-mono", name: "Dark Mono", hint: "Monochrome dark, single accent color" },
  { id: "dark-gradient", name: "Dark Gradient", hint: "Dark diagonal gradient band" },
  { id: "dark-neon", name: "Dark Neon", hint: "Neon accent outlines on dark" },
  { id: "minimal-lux", name: "Minimal Lux", hint: "Whitespace, hairline divider, gold" },
];

// ---------------------------------------------------------------------------
// Color helpers (mirrors backend _wcag_contrast)
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "#000").replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function isLight(hex: string): boolean {
  return relativeLuminance(hex) > 0.4;
}

function shade(hex: string, toward: "black" | "white", amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = toward === "black" ? [0, 0, 0] : [255, 255, 255];
  const mix = target.map((t, i) => Math.round((1 - amt) * [r, g, b][i] + amt * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function darken(hex: string, amt: number): string {
  return shade(hex, "black", amt);
}

export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const dir = isLight(bg) ? "black" : "white";
  let c = fg;
  for (let i = 0; i < 24 && contrastRatio(c, bg) < min; i++) {
    c = shade(c, dir, 0.15);
  }
  return contrastRatio(c, bg) >= min ? c : dir === "black" ? "#000000" : "#ffffff";
}

export function normalizePalette(p: CoverPalette): Required<CoverPalette> {
  return {
    page_bg: p.page_bg || "#ffffff",
    accent: p.accent || "#2563eb",
    heading: p.heading || "#111827",
    text: p.text || "#374151",
    muted: p.muted || "#6b7280",
    accent_soft: p.accent_soft || "#dbeafe",
    block_bg: p.block_bg || "#f3f4f6",
    title_page_bg: p.title_page_bg || "#f9fafb",
  };
}

// ---------------------------------------------------------------------------
// Text measurement + fitting
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "our", "this", "that",
  "from", "into", "about", "over", "under", "how", "what", "when",
  "where", "why", "who", "are", "was", "were", "will", "has", "have",
  "had", "not", "but", "its", "it's", "of", "a", "an", "to", "in",
  "on", "at", "by", "is", "be", "being", "been", "up", "down", "out",
  "off", "so", "or", "as", "do", "does", "did",
]);

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  try {
    measureCtx = document.createElement("canvas").getContext("2d");
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

export function measureText(text: string, font: string): number {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * parseFloat(font) * 0.55;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function detectPunchWord(title: string): string | null {
  const words = title
    .split(/[\s—–,.;:!?/()]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9'’]/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return null;
  return words[words.length - 1];
}

export function getPunchOptions(title: string): { value: string; label: string }[] {
  const words = title
    .split(/[\s—–,.;:!?/()]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9'’]/g, ""))
    .filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const out = words.filter((w) => {
    if (seen.has(w.toLowerCase())) return false;
    seen.add(w.toLowerCase());
    return true;
  });
  return out.map((w) => ({ value: w, label: w }));
}

export function splitPunch(
  line: string,
  punch: string | null | undefined
): { before: string; punch: string; after: string } {
  if (!punch) return { before: line, punch: "", after: "" };
  const idx = line.toLowerCase().indexOf(punch.toLowerCase());
  if (idx < 0) return { before: line, punch: "", after: "" };
  return {
    before: line.slice(0, idx),
    punch: line.slice(idx, idx + punch.length),
    after: line.slice(idx + punch.length),
  };
}

interface WrapResult {
  lines: string[];
  fontSize: number;
}

function hardBreak(word: string, font: string, maxW: number, acc: string[]): string {
  let rest = word;
  let cur = "";
  while (rest.length) {
    const next = cur + rest[0];
    rest = rest.slice(1);
    if (measureText(next, font) > maxW) {
      if (!cur) {
        acc.push(next);
        continue;
      }
      acc.push(cur);
      cur = rest ? rest[0] : "";
      if (rest) rest = rest.slice(1);
      else return "";
    } else {
      cur = next;
    }
  }
  return cur;
}

function wrapFit(
  text: string,
  fontFamily: string,
  weight: number,
  maxW: number,
  maxH: number,
  lineHeight: number,
  minPx: number,
  maxPx: number,
  maxLines: number
): WrapResult {
  const testFont = (px: number) => `${weight} ${px}px ${fontFamily}`;
  const wrapAt = (px: number): string[] => {
    const font = testFont(px);
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (measureText(candidate, font) <= maxW) {
        cur = candidate;
      } else if (cur) {
        lines.push(cur);
        cur = measureText(word, font) <= maxW ? word : hardBreak(word, font, maxW, lines);
      } else {
        cur = hardBreak(word, font, maxW, lines);
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const fits = (px: number) => {
    const lines = wrapAt(px);
    if (lines.length > maxLines) return false;
    return lines.length * px * lineHeight <= maxH;
  };
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  for (let i = 0; i < 24 && lo <= hi; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { lines: wrapAt(best), fontSize: best };
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Icons + topic detection
// ---------------------------------------------------------------------------

type AnyIcon = BrandIcon | LineIcon;

function iconById(id: string): AnyIcon | undefined {
  return ALL_ICONS[id];
}

function brandHex(id: string): string | undefined {
  const i = ALL_ICONS[id] as BrandIcon | undefined;
  return i && "hex" in i ? i.hex : undefined;
}

export function iconSvg(id: string, size: number, color: string): string {
  const icon = iconById(id);
  if (!icon) return "";
  if ("d" in icon) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${icon.d}" fill="${color}"/></svg>`;
  }
  const sw = Math.max(1.5, (2 * size) / 24);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.svg}</svg>`;
}

interface Topic {
  category: string;
  hero: string;
  icons: string[];
  punchFallback: string | null;
}

const TOPIC_DEFS: { category: string; hero: string; icons: string[]; punchFallback: string | null }[] = [
  { category: "frontend", hero: "layers", icons: ["react", "javascript", "typescript", "nextdotjs", "tailwindcss"], punchFallback: null },
  { category: "backend", hero: "server", icons: ["nodedotjs", "python", "graphql", "postgresql", "docker"], punchFallback: null },
  { category: "data-ai", hero: "brain", icons: ["python", "tensorflow", "pytorch", "pandas", "redis"], punchFallback: null },
  { category: "devops", hero: "layers", icons: ["docker", "kubernetes", "terraform", "github", "linux"], punchFallback: null },
  { category: "git-workflow", hero: "layers", icons: ["git", "github", "gitlab", "markdown", "npm"], punchFallback: null },
  { category: "security", hero: "shield", icons: ["lock", "key", "shield-check", "git", "terminal"], punchFallback: null },
  { category: "finance", hero: "chart", icons: ["banknote", "line-chart", "bitcoin", "ethereum", "wallet"], punchFallback: "Money" },
  { category: "marketing", hero: "rocket", icons: ["rocket", "target", "zap", "trending-up", "lightbulb"], punchFallback: "Growth" },
  { category: "health", hero: "heart", icons: ["heart", "activity", "stethoscope", "pill", "leaf"], punchFallback: "Health" },
  { category: "food", hero: "coffee", icons: ["utensils", "coffee", "star", "leaf", "clock"], punchFallback: "Kitchen" },
  { category: "nature", hero: "plant", icons: ["leaf", "sprout", "flower-2", "mountain", "sun"], punchFallback: "Garden" },
  { category: "science", hero: "atom", icons: ["atom", "flask-conical", "microscope", "brain", "dna"], punchFallback: "Science" },
  { category: "music", hero: "music", icons: ["music", "play", "star", "heart", "zap"], punchFallback: "Music" },
  { category: "photo-art", hero: "compass", icons: ["camera", "palette", "pen-tool", "sparkles", "star"], punchFallback: "Design" },
  { category: "writing", hero: "book", icons: ["book-open", "book", "pen-tool", "type", "feather"], punchFallback: "Story" },
  { category: "productivity", hero: "target", icons: ["target", "zap", "clock", "trending-up", "check"], punchFallback: "Focus" },
  { category: "education", hero: "school", icons: ["graduation-cap", "school", "book-open", "brain", "users"], punchFallback: "Learn" },
  { category: "travel", hero: "compass", icons: ["plane", "compass", "map", "camera", "mountain"], punchFallback: "Journey" },
  { category: "gaming", hero: "layers", icons: ["gamepad-2", "zap", "star", "rocket", "cpu"], punchFallback: null },
  { category: "self-help", hero: "sprout", icons: ["sprout", "heart", "sun", "sparkles", "target"], punchFallback: "Mindset" },
  { category: "pets", hero: "heart", icons: ["heart", "paw-print", "sun", "sparkles", "leaf"], punchFallback: "Pets" },
  { category: "parenting", hero: "heart", icons: ["heart", "baby", "gift", "sun", "sparkles"], punchFallback: "Family" },
];

const KEYWORD_MAP: { cat: string; keywords: string[] }[] = [
  { cat: "frontend", keywords: ["react", "next", "nextjs", "frontend", "front-end", "component", "hook", "hooks", "jsx", "spa", "tailwind", "css", "javascript", "typescript", "ui", "web app"] },
  { cat: "backend", keywords: ["backend", "back-end", "api", "rest", "server", "node", "django", "flask", "express", "fastapi", "graphql", "microservice", "http"] },
  { cat: "data-ai", keywords: ["ai", "machine learning", "deep learning", "neural", "tensorflow", "pytorch", "llm", "gpt", "model", "data", "database", "sql", "analytics", "big data", "data science", "statistics", "pandas", "numpy", "training", "pipeline"] },
  { cat: "devops", keywords: ["devops", "docker", "kubernetes", "k8s", "cloud", "aws", "azure", "deploy", "deployment", "ci/cd", "ci", "cd", "terraform", "infra", "infrastructure", "container", "serverless"] },
  { cat: "git-workflow", keywords: ["git", "github", "gitlab", "version control", "collaboration", "teamwork", "merge", "branch"] },
  { cat: "security", keywords: ["security", "hack", "hacking", "hacker", "cyber", "cybersecurity", "privacy", "encrypt", "pentest", "threat", "password", "vulnerab"] },
  { cat: "finance", keywords: ["finance", "financial", "money", "invest", "investing", "investor", "stock", "trading", "crypto", "cryptocurrency", "bitcoin", "budget", "wealth", "saving", "savings", "debt", "retirement", "banking"] },
  { cat: "marketing", keywords: ["market", "marketing", "growth", "sales", "seo", "brand", "branding", "social media", "advertis", "content", "startup", "audience", "launch"] },
  { cat: "health", keywords: ["health", "fitness", "nutrition", "diet", "wellness", "yoga", "workout", "sleep", "mental", "habit", "muscle", "meditation", "stress", "heart health", "gym", "exercise", "weight", "protein", "supplement", "testosterone", "hormone", "cardio", "strength", "lean", "fat", "abs", "biceps", "chest", "legs", "squat", "deadlift", "bench", "bulk", "cut", "shred", "blueprint", "physique", "body", "regimen", "training", "endurance", "stamina", "recovery", "built", "ironclad", "male"] },
  { cat: "food", keywords: ["cook", "cooking", "recipe", "kitchen", "food", "bake", "baking", "bread", "meal", "culinary", "chef", "wine"] },
  { cat: "nature", keywords: ["garden", "gardening", "plant", "plants", "nature", "grow", "growing", "farming", "green", "organic", "soil", "harvest", "wild"] },
  { cat: "science", keywords: ["science", "physics", "chemistry", "biology", "lab", "research", "math", "mathematics", "universe", "quantum", "genetics", "experiment", "theory"] },
  { cat: "music", keywords: ["music", "guitar", "piano", "song", "audio", "sound", "band", "producer", "mix", "vinyl"] },
  { cat: "photo-art", keywords: ["photography", "photo", "design", "art", "draw", "paint", "painting", "creative", "illustrat", "sketch"] },
  { cat: "writing", keywords: ["writing", "write", "book", "novel", "story", "stories", "blog", "essay", "read", "reader", "poetry", "author", "publish"] },
  { cat: "productivity", keywords: ["productivity", "focus", "todo", "task", "plan", "planning", "system", "time", "organize", "organise", "routine", "discipline"] },
  { cat: "education", keywords: ["education", "educate", "learn", "learning", "course", "teach", "teaching", "study", "school", "student", "teacher", "exam", "tutor", "curriculum"] },
  { cat: "travel", keywords: ["travel", "trip", "adventure", "explore", "world", "map", "journey", "wander", "backpack", "destination"] },
  { cat: "gaming", keywords: ["game", "gaming", "rpg", "esports", "play", "board game", "video game", "level", "strategy"] },
  { cat: "self-help", keywords: ["self-help", "mindful", "mindfulness", "meditate", "meditation", "happiness", "habit", "mindset", "spirituality", "manifest", "positive", "blueprint", "routine", "discipline", "goal", "routine", "improve", "growth", "change", "transform", "better", "success"] },
  { cat: "pets", keywords: ["dog", "cat", "pet", "pets", "animal", "puppy", "kitten"] },
  { cat: "parenting", keywords: ["baby", "parent", "parenting", "mom", "dad", "pregnancy", "toddler", "child", "kids"] },
];

export function detectTopic(text: string): Topic {
  const hay = ` ${text.toLowerCase()} `;
  let bestCat: (typeof TOPIC_DEFS)[number] | null = null;
  let bestScore = 0;
  for (const row of KEYWORD_MAP) {
    let score = 0;
    for (const kw of row.keywords) {
      if (hay.includes(kw)) score += kw.length > 5 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = TOPIC_DEFS.find((t) => t.category === row.cat) || null;
    }
  }
  if (bestCat) {
    return { ...bestCat, icons: bestCat.icons.filter((id) => iconById(id)) };
  }
  // No confident match — omit icons entirely rather than showing unrelated ones
  return {
    category: "general",
    hero: "orb",
    icons: [],
    punchFallback: null,
  };
}

// ---------------------------------------------------------------------------
// Hero illustrations (authored in a 24x24 viewport, scaled by caller)
// ---------------------------------------------------------------------------

type HeroFn = (accent: string, soft: string) => string;

const HEROES: Record<string, HeroFn> = {
  plant: (accent, soft) => `
    <path d="M12 20v-8" stroke="${accent}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M12 13c-4 0-6-2.5-5-5 3-.5 5 1 5 5z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>
    <path d="M12 11c0-4 2-6.5 5-6.5.5 3-1.5 5-5 6.5z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>
    <path d="M12 16c0-3.5 2-5.5 4.5-5.5.5 2.5-1 4.5-4.5 5.5z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>
    <path d="M12 20.5c-2.8 0-5-.8-5-1.8 0-1 2.2-1.8 5-1.8s5 .8 5 1.8c0 1-2.2 1.8-5 1.8z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>`,
  orb: (accent, soft) => `
    <circle cx="12" cy="12" r="9" fill="none" stroke="${soft}" stroke-width="1"/>
    <circle cx="12" cy="12" r="6" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.7"/>
    <circle cx="12" cy="12" r="2.6" fill="${accent}"/>`,
  chart: (accent, soft) => `
    <path d="M4 19.5h16" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6 16l4-5 3.5 3 4.5-6.5" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="18" cy="7.5" r="1.4" fill="${accent}"/>
    <circle cx="10" cy="11" r="1.2" fill="${soft}" stroke="${accent}" stroke-width="1.2"/>`,
  rocket: (accent, soft) => `
    <path d="M12 3c2.5 2 4 5 4 9l-2 3H10l-2-3c0-4 1.5-7 4-9z" fill="${soft}" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round"/>
    <circle cx="12" cy="9.5" r="1.7" fill="${accent}"/>
    <path d="M10 15l-2.5 2.5M14 15l2.5 2.5M11 18.5h2" stroke="${accent}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M9.5 18.5c-1.5 1-1.5 2.5-.5 3M14.5 18.5c1.5 1 1.5 2.5.5 3" stroke="${accent}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  target: (accent, soft) => `
    <circle cx="12" cy="12" r="9" fill="none" stroke="${soft}" stroke-width="1.4"/>
    <circle cx="12" cy="12" r="5.5" fill="none" stroke="${accent}" stroke-width="1.4"/>
    <circle cx="12" cy="12" r="2" fill="${accent}"/>`,
  layers: (accent, soft) => `
    <path d="M12 4L21 9.5 12 15 3 9.5z" fill="${soft}" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M5.2 12L3 13.5l9 5.5 9-5.5-2.2-1.5M5.2 15L3 16.5l9 5.5 9-5.5-2.2-1.5" fill="none" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round" opacity="0.75"/>`,
  heart: (accent, soft) => `
    <path d="M12 20.5C6 16 3.5 12.8 3.5 9.6 3.5 7.1 5.4 5.5 7.7 5.5c1.7 0 3.3 1 4.3 2.6 1-1.6 2.6-2.6 4.3-2.6 2.3 0 4.2 1.6 4.2 4.1 0 3.2-2.5 6.4-8.5 10.9z" fill="${soft}" stroke="${accent}" stroke-width="1.4" stroke-linejoin="round"/>`,
  atom: (accent, soft) => `
    <circle cx="12" cy="12" r="1.6" fill="${accent}"/>
    <ellipse cx="12" cy="12" rx="9" ry="3.8" fill="none" stroke="${accent}" stroke-width="1.2" transform="rotate(30 12 12)"/>
    <ellipse cx="12" cy="12" rx="9" ry="3.8" fill="none" stroke="${accent}" stroke-width="1.2" transform="rotate(150 12 12)" opacity="0.75"/>
    <ellipse cx="12" cy="12" rx="9" ry="3.8" fill="none" stroke="${soft}" stroke-width="1.2"/>`,
  coffee: (accent, soft) => `
    <path d="M6 8h9v6a3.5 3.5 0 0 1-3.5 3.5h-2A3.5 3.5 0 0 1 6 14z" fill="${soft}" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M15 9h2a2.5 2.5 0 0 1 0 5h-2" fill="none" stroke="${accent}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M9 18.5v1M12 18.5v1M6 6.5c0-1 .8-1.5 1.5-2 .7-.5.5-1.5.5-1.5M11 6.5c0-1 .8-1.5 1.5-2 .7-.5.5-1.5.5-1.5" stroke="${accent}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  compass: (accent, soft) => `
    <circle cx="12" cy="12" r="9" fill="none" stroke="${accent}" stroke-width="1.3"/>
    <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="${soft}" stroke="${accent}" stroke-width="1.1" stroke-linejoin="round"/>`,
  book: (accent, soft) => `
    <path d="M5 5.5C5 4 6 3.5 7.5 3.5c2 0 4 1 4.5 3v14c-.5-2-2.5-3-4.5-3C6 17.5 5 18 5 19.5z" fill="${soft}" stroke="${accent}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M19 5.5C19 4 18 3.5 16.5 3.5c-2 0-4 1-4.5 3v14c.5-2 2.5-3 4.5-3 1.5 0 2.5.5 2.5 2z" fill="${soft}" stroke="${accent}" stroke-width="1.2" stroke-linejoin="round"/>`,
  music: (accent, soft) => `
    <path d="M9 18.5V6.5L18 5v12.5" fill="none" stroke="${accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="6.5" cy="18.5" r="2.5" fill="${soft}" stroke="${accent}" stroke-width="1.2"/>
    <circle cx="15.5" cy="17.5" r="2.5" fill="${soft}" stroke="${accent}" stroke-width="1.2"/>`,
  school: (accent, soft) => `
    <path d="M12 4L2.5 9 12 14l9.5-5z" fill="${soft}" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M6.5 11.5V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.5M2.5 9v5.5" stroke="${accent}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  sprout: (accent, soft) => `
    <path d="M12 21v-9" stroke="${accent}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M12 13c-3.5 0-5.5-2-5.5-5 3 0 5 1.5 5.5 5z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>
    <path d="M12 10c0-3.5 2-5 4.5-5 .5 3-1 4-4.5 5z" fill="${soft}" stroke="${accent}" stroke-width="1.1"/>`,
  shield: (accent, soft) => `
    <path d="M12 3l7 2.5v5c0 4.5-3 8-7 10.5-4-2.5-7-6-7-10.5v-5z" fill="${soft}" stroke="${accent}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M9 11.5l2 2 4-4" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  server: (accent, soft) => `
    <rect x="3.5" y="4" width="17" height="7" rx="2" fill="${soft}" stroke="${accent}" stroke-width="1.3"/>
    <rect x="3.5" y="13" width="17" height="7" rx="2" fill="none" stroke="${accent}" stroke-width="1.3"/>
    <path d="M7 7.5h.01M7 16.5h.01" stroke="${accent}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M10.5 7.5h6M10.5 16.5h6" stroke="${accent}" stroke-width="1.3" stroke-linecap="round"/>`,
  brain: (accent, soft) => `
    <path d="M9.5 7.5a2 2 0 1 1 2.5 1.9V14a2.2 2.2 0 0 1-1.5 2.1 2 2 0 1 1-2.4-2.6c-.4-.4-.7-1-.7-1.6s.3-1.2.7-1.6a2 2 0 0 1 1.4-2.8z" fill="${soft}" stroke="${accent}" stroke-width="1.2"/>
    <path d="M14.5 7.5a2 2 0 1 0-2.5 1.9V14a2.2 2.2 0 0 0 1.5 2.1 2 2 0 1 0 2.4-2.6c.4-.4.7-1 .7-1.6s-.3-1.2-.7-1.6a2 2 0 0 0-1.4-2.8z" fill="${soft}" stroke="${accent}" stroke-width="1.2"/>`,
};

function heroSvg(
  kind: string,
  accent: string,
  soft: string,
  box: { x: number; y: number; w: number; h: number }
): string {
  const fn = HEROES[kind] || HEROES.orb;
  return `<g transform="translate(${box.x} ${box.y}) scale(${box.w / 24})">${fn(accent, soft)}</g>`;
}

// ---------------------------------------------------------------------------
// Tiny SVG element builders
// ---------------------------------------------------------------------------

const r = (n: number) => Math.round(n * 100) / 100;

function sRect(x: number, y: number, w: number, h: number, fill: string, extra = ""): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}" ${extra}/>`;
}

function sRoundRect(x: number, y: number, w: number, h: number, rx: number, fill: string, extra = ""): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${r(rx)}" fill="${fill}" ${extra}/>`;
}

function sLine(x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, extra = ""): string {
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${r(width)}" ${extra}/>`;
}

function sTextLine(
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  anchor: "start" | "middle" | "end" = "start"
): string {
  return `<text x="${r(x)}" y="${r(y)}" ${font} fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
}

function addCheck(
  checks: ContrastCheck[],
  label: string,
  fg: string,
  bg: string,
  min: number
): void {
  const ratio = contrastRatio(fg, bg);
  checks.push({ label, fg, bg, ratio, min, ok: ratio >= min });
}

function bandGlow(cx: number, cy: number, rMax: number, color: string, opacity: number): string {
  return `<radialGradient id="glow${cx.toFixed(0)}${cy.toFixed(0)}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </radialGradient><circle cx="${cx}" cy="${cy}" r="${rMax}" fill="url(#glow${cx.toFixed(0)}${cy.toFixed(0)})"/>`;
}

// ---------------------------------------------------------------------------
// Layout building blocks
// ---------------------------------------------------------------------------

interface TextBlockOpts {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  weight: number;
  lineHeight: number;
  anchor: "start" | "middle";
  fill: string;
  bg: string;
  punch?: string | null;
  punchFill?: string;
  checkLabel: string;
  maxW: number;
  maxH: number;
  minPx: number;
  maxPx: number;
  maxLines: number;
  letterSpacing?: number;
}

function textBlock(b: TextBlockOpts, checks: ContrastCheck[]) {
  const wrap = wrapFit(
    b.text,
    b.fontFamily,
    b.weight,
    b.maxW,
    b.maxH,
    b.lineHeight,
    b.minPx,
    b.maxPx,
    b.maxLines
  );
  const lh = wrap.fontSize * b.lineHeight;
  const startY = b.y;
  const ls = b.letterSpacing ?? 0;
  let svg = "";
  let punchUsed = false;
  wrap.lines.forEach((line, i) => {
    const y = startY + i * lh;
    const parts = splitPunch(line, b.punch);
    svg += `<text x="${r(b.x)}" y="${r(y)}" font-family="${b.fontFamily}" font-weight="${b.weight}" font-size="${wrap.fontSize}" fill="${b.fill}" text-anchor="${b.anchor}" letter-spacing="${ls}">`;
    if (parts.punch) {
      punchUsed = true;
      svg += `<tspan>${esc(parts.before)}</tspan>`;
      svg += `<tspan fill="${b.punchFill || b.fill}">${esc(parts.punch)}</tspan>`;
      svg += `<tspan>${esc(parts.after)}</tspan>`;
    } else {
      svg += esc(line);
    }
    svg += `</text>`;
  });
  addCheck(checks, b.checkLabel, b.fill, b.bg, 4.5);
  if (punchUsed && b.punchFill) {
    addCheck(checks, `${b.checkLabel} (punch)`, b.punchFill, b.bg, 4.5);
  }
  return { svg, fontSize: wrap.fontSize, lines: wrap.lines.length };
}

function drawBadge(
  checks: ContrastCheck[],
  pal: Required<CoverPalette>,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { fieldBg: string; onDark: boolean }
): { w: number; h: number; svg: string } {
  const chipBg = opts.onDark
    ? ensureContrast(pal.accent, opts.fieldBg, 3)
    : ensureContrast(pal.accent, opts.fieldBg, 4.5);
  const fg = ensureContrast("#ffffff", chipBg, 4.5);
  const font = `700 ${size}px system-ui, sans-serif`;
  const w = measureText(text.toUpperCase(), font) + size * 2.4;
  const h = size * 2.3;
  addCheck(checks, `badge:${text}`, fg, chipBg, 4.5);
  return {
    w,
    h,
    svg: `${sRoundRect(x, y, w, h, h / 2, chipBg)}<text x="${r(x + w / 2)}" y="${r(y + h / 2 + size * 0.36)}" font-family="system-ui, sans-serif" font-weight="700" font-size="${size}" fill="${fg}" text-anchor="middle" letter-spacing="${size * 0.16}">${esc(text.toUpperCase())}</text>`,
  };
}

function drawIconRow(
  checks: ContrastCheck[],
  pal: Required<CoverPalette>,
  ids: string[],
  cx: number,
  y: number,
  chip: number,
  gap: number,
  opts: { fieldBg: string; onDark: boolean }
): { w: number; svg: string } {
  if (ids.length === 0) return { w: 0, svg: "" };
  const total = ids.length * chip + (ids.length - 1) * gap;
  const startX = cx - total / 2;
  const iconSize = chip * 0.52;
  const checkBg = opts.onDark ? opts.fieldBg : pal.accent_soft;
  const chipBg = opts.onDark ? "rgba(255,255,255,0.14)" : pal.accent_soft;
  let svg = "";
  ids.forEach((id, i) => {
    const cxx = startX + i * (chip + gap) + chip / 2;
    const bh = brandHex(id);
    // Brand icons use their canonical color directly — these are decorative
    // topic indicators inside chip containers, not semantic UI controls that
    // require forced contrast.  Line icons still get contrast-checked.
    const color = bh || ensureContrast(pal.accent, checkBg, 3);
    if (!bh) addCheck(checks, `icon:${id}`, color, checkBg, 3);
    svg += `${sRoundRect(cxx - chip / 2, y, chip, chip, chip * 0.28, chipBg)}<g transform="translate(${cxx - iconSize / 2} ${y + (chip - iconSize) / 2})">${iconSvg(id, iconSize, color)}</g>`;
  });
  return { w: total, svg };
}

// ---------------------------------------------------------------------------
// Style renderers
// ---------------------------------------------------------------------------

interface StyleCtx {
  W: number;
  H: number;
  pal: Required<CoverPalette>;
  topic: Topic;
  punch: string | null;
  title: string;
  subtitle: string;
  tagline: string;
  checks: ContrastCheck[];
  info: CoverResult["info"];
}

function resolveTextColors(ctx: StyleCtx, bg: string) {
  return {
    heading: ensureContrast(ctx.pal.heading, bg, 4.5),
    text: ensureContrast(ctx.pal.text, bg, 4.5),
    muted: ensureContrast(ctx.pal.muted, bg, 4.5),
    accent: ensureContrast(ctx.pal.accent, bg, 4.5),
  };
}

// -- Bold Editorial ---------------------------------------------------------

function renderBoldEditorial(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.07;
  const cw = W - PAD * 2;
  const bg = pal.page_bg;
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  const slabH = H * 0.30;
  const slabBg = ensureContrast(pal.accent, bg, 4.5);
  const slabFg = ensureContrast("#ffffff", slabBg, 4.5);
  parts.push(sRect(0, H - slabH, W, slabH, slabBg));
  parts.push(bandGlow(W * 0.82, H - slabH * 0.3, W * 0.5, slabFg, 0.1));

  const badge = drawBadge(ctx.checks, pal, "A Practical Guide", PAD, H * 0.09, W * 0.018, { fieldBg: bg, onDark: false });
  parts.push(badge.svg);

  const title = textBlock(
    {
      text: ctx.title,
      x: PAD,
      y: H * 0.20,
      fontFamily: "Georgia, 'Times New Roman', serif",
      weight: 800,
      lineHeight: 1.08,
      anchor: "start",
      fill: c.heading,
      bg,
      punchFill: c.accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: cw,
      maxH: H * 0.34,
      minPx: W * 0.045,
      maxPx: W * 0.115,
      maxLines: 4,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const ruleY = H * 0.56;
  parts.push(sLine(PAD, ruleY, PAD + W * 0.24, ruleY, c.accent, W * 0.006));

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: PAD,
      y: H * 0.62,
      fontFamily: "system-ui, sans-serif",
      weight: 500,
      lineHeight: 1.35,
      anchor: "start",
      fill: c.text,
      bg,
      checkLabel: "subtitle",
      maxW: cw * 0.82,
      maxH: H * 0.12,
      minPx: W * 0.02,
      maxPx: W * 0.034,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  const bottomY = H - slabH * 0.45;
  parts.push(sLine(PAD, bottomY - W * 0.016, PAD + W * 0.1, bottomY - W * 0.016, slabFg, W * 0.003));
  parts.push(
    sTextLine(ctx.tagline || "Start reading today", PAD, bottomY, `font-family="system-ui, sans-serif" font-weight="500" font-size="${W * 0.02}px"`, slabFg, "start")
  );

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Illustrated ------------------------------------------------------------

function renderIllustrated(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.07;
  const cw = W - PAD * 2;
  const bg = pal.page_bg;
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  // Central hero illustration — large, centered, the visual focal point
  parts.push(bandGlow(W / 2, H * 0.28, W * 0.5, pal.accent, 0.14));
  const heroSize = W * 0.35;
  parts.push(
    heroSvg(
      ctx.topic.hero,
      ensureContrast(pal.accent, bg, 3),
      pal.accent_soft,
      { x: W / 2 - heroSize / 2, y: H * 0.08, w: heroSize, h: heroSize }
    )
  );

  const badge = drawBadge(ctx.checks, pal, "Discover", PAD, H * 0.06, W * 0.016, { fieldBg: bg, onDark: false });
  parts.push(badge.svg);

  const title = textBlock(
    {
      text: ctx.title,
      x: PAD,
      y: H * 0.50,
      fontFamily: "system-ui, sans-serif",
      weight: 800,
      lineHeight: 1.1,
      anchor: "start",
      fill: c.heading,
      bg,
      punchFill: c.accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: cw,
      maxH: H * 0.18,
      minPx: W * 0.045,
      maxPx: W * 0.10,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: PAD,
      y: H * 0.66,
      fontFamily: "system-ui, sans-serif",
      weight: 500,
      lineHeight: 1.4,
      anchor: "start",
      fill: c.text,
      bg,
      checkLabel: "subtitle",
      maxW: cw * 0.9,
      maxH: H * 0.10,
      minPx: W * 0.021,
      maxPx: W * 0.034,
      maxLines: 2,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, W / 2, H * 0.80, W * 0.085, W * 0.018, { fieldBg: bg, onDark: false });
  parts.push(row.svg);

  const ruleY = H * 0.90;
  parts.push(sLine(PAD, ruleY, PAD + W * 0.14, ruleY, c.accent, W * 0.004));
  parts.push(
    sTextLine(ctx.tagline || "Made for curious minds", PAD, ruleY + W * 0.028, `font-family="system-ui, sans-serif" font-weight="500" font-size="${W * 0.018}px"`, c.muted, "start")
  );

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Badge + Grid -----------------------------------------------------------

function renderBadgeGrid(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.07;
  const cw = W - PAD * 2;
  const bg = pal.page_bg;
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  const dot = W * 0.012;
  const step = W * 0.055;
  const dotFill = ensureContrast(pal.accent, bg, 2) === pal.accent ? pal.accent : pal.block_bg;
  parts.push(
    `<defs><pattern id="dotgrid${W}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${dot / 2}" cy="${dot / 2}" r="${dot / 4}" fill="${dotFill}" opacity="0.35"/></pattern></defs>`
  );
  parts.push(sRect(0, 0, W, H, `url(#dotgrid${W})`));

  parts.push(sRect(0, 0, W, W * 0.012, c.accent));
  parts.push(sRect(W - W * 0.012, 0, W * 0.012, W * 0.012, c.accent));

  const badge = drawBadge(ctx.checks, pal, "Field Guide", PAD, H * 0.09, W * 0.016, { fieldBg: bg, onDark: false });
  parts.push(badge.svg);

  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, W / 2, H * 0.20, W * 0.095, W * 0.02, { fieldBg: bg, onDark: false });
  parts.push(row.svg);

  const title = textBlock(
    {
      text: ctx.title,
      x: W / 2,
      y: H * 0.40,
      fontFamily: "system-ui, sans-serif",
      weight: 800,
      lineHeight: 1.12,
      anchor: "middle",
      fill: c.heading,
      bg,
      punchFill: c.accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: cw,
      maxH: H * 0.20,
      minPx: W * 0.045,
      maxPx: W * 0.105,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: W / 2,
      y: H * 0.63,
      fontFamily: "system-ui, sans-serif",
      weight: 500,
      lineHeight: 1.4,
      anchor: "middle",
      fill: c.text,
      bg,
      checkLabel: "subtitle",
      maxW: cw * 0.9,
      maxH: H * 0.10,
      minPx: W * 0.02,
      maxPx: W * 0.034,
      maxLines: 2,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  const ruleY = H * 0.78;
  parts.push(sLine(PAD, ruleY, W - PAD, ruleY, c.accent, W * 0.004));
  parts.push(
    sTextLine(ctx.tagline || "Build something great", W / 2, H * 0.84, `font-family="system-ui, sans-serif" font-weight="600" font-size="${W * 0.02}px"`, c.accent, "middle")
  );

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Dark Glow --------------------------------------------------------------

function renderDarkGlow(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.08;
  const bg = isLight(pal.page_bg) ? darken(pal.page_bg, 0.86) : pal.page_bg;
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  parts.push(bandGlow(W / 2, H * 0.18, W * 0.55, pal.accent, 0.45));
  parts.push(bandGlow(W * 0.2, H * 0.82, W * 0.5, pal.accent, 0.22));

  const accentOnDark = ensureContrast(pal.accent, bg, 3);
  const heroSize = W * 0.24;
  parts.push(
    heroSvg(ctx.topic.hero, accentOnDark, "rgba(255,255,255,0.10)", { x: W / 2 - heroSize / 2, y: H * 0.06, w: heroSize, h: heroSize })
  );

  const title = textBlock(
    {
      text: ctx.title,
      x: PAD,
      y: H * 0.35,
      fontFamily: "system-ui, sans-serif",
      weight: 800,
      lineHeight: 1.1,
      anchor: "start",
      fill: c.heading,
      bg,
      punchFill: c.accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: W - PAD * 2,
      maxH: H * 0.22,
      minPx: W * 0.045,
      maxPx: W * 0.10,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: PAD,
      y: H * 0.58,
      fontFamily: "system-ui, sans-serif",
      weight: 400,
      lineHeight: 1.4,
      anchor: "start",
      fill: c.text,
      bg,
      checkLabel: "subtitle",
      maxW: W * 0.72,
      maxH: H * 0.10,
      minPx: W * 0.02,
      maxPx: W * 0.032,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, W / 2, H * 0.72, W * 0.09, W * 0.02, { fieldBg: bg, onDark: true });
  parts.push(row.svg);

  const ruleY = H * 0.66;
  parts.push(sLine(PAD, ruleY, PAD + W * 0.14, ruleY, accentOnDark, W * 0.004));
  if (ctx.tagline) {
    parts.push(
      sTextLine(ctx.tagline, PAD, ruleY + W * 0.028, `font-family="system-ui, sans-serif" font-weight="500" font-size="${W * 0.017}px"`, c.muted, "start")
    );
  }

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Dark Mono ---------------------------------------------------------------

function renderDarkMono(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.08;
  const bg = isLight(pal.page_bg) ? darken(pal.page_bg, 0.90) : pal.page_bg;
  const mono = ensureContrast(pal.accent, bg, 4);
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  // Thin mono accent line at top
  parts.push(sLine(PAD, H * 0.10, W - PAD, H * 0.10, mono, W * 0.002));

  // Hero icon — small, monochrome
  const heroSize = W * 0.12;
  parts.push(
    heroSvg(ctx.topic.hero, mono, "rgba(255,255,255,0.06)", { x: PAD, y: H * 0.14, w: heroSize, h: heroSize })
  );

  const title = textBlock(
    {
      text: ctx.title,
      x: PAD,
      y: H * 0.36,
      fontFamily: "system-ui, sans-serif",
      weight: 800,
      lineHeight: 1.1,
      anchor: "start",
      fill: c.heading,
      bg,
      punchFill: mono,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: W - PAD * 2,
      maxH: H * 0.22,
      minPx: W * 0.045,
      maxPx: W * 0.10,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: PAD,
      y: H * 0.59,
      fontFamily: "system-ui, sans-serif",
      weight: 400,
      lineHeight: 1.5,
      anchor: "start",
      fill: c.muted,
      bg,
      checkLabel: "subtitle",
      maxW: W * 0.75,
      maxH: H * 0.10,
      minPx: W * 0.02,
      maxPx: W * 0.032,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  // Icon row — monochrome chips
  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, PAD, H * 0.76, W * 0.075, W * 0.016, { fieldBg: bg, onDark: true });
  parts.push(row.svg);

  // Tagline
  if (ctx.tagline) {
    parts.push(
      sTextLine(ctx.tagline, PAD, H * 0.90, `font-family="system-ui, sans-serif" font-weight="400" font-size="${W * 0.016}px"`, c.muted, "start")
    );
  }

  // Bottom mono line
  parts.push(sLine(PAD, H - PAD, W - PAD, H - PAD, mono, W * 0.002));

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Dark Gradient -----------------------------------------------------------

function renderDarkGradient(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.08;
  const bg = isLight(pal.page_bg) ? darken(pal.page_bg, 0.88) : pal.page_bg;
  const accent = ensureContrast(pal.accent, bg, 3);
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  // Diagonal gradient band
  const gradId = "dgrad";
  parts.push(
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${accent}" stop-opacity="0.5"/>` +
    `<stop offset="100%" stop-color="${accent}" stop-opacity="0"/>` +
    `</linearGradient></defs>`
  );
  parts.push(sRect(0, H * 0.15, W, H * 0.35, `url(#${gradId})`, `opacity="0.35"`));

  // Hero icon — centered in gradient band
  const heroSize = W * 0.18;
  parts.push(
    heroSvg(ctx.topic.hero, accent, "rgba(255,255,255,0.08)", { x: W / 2 - heroSize / 2, y: H * 0.18, w: heroSize, h: heroSize })
  );

  const title = textBlock(
    {
      text: ctx.title,
      x: W / 2,
      y: H * 0.44,
      fontFamily: "Georgia, serif",
      weight: 700,
      lineHeight: 1.1,
      anchor: "middle",
      fill: c.heading,
      bg,
      punchFill: accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: W - PAD * 2,
      maxH: H * 0.22,
      minPx: W * 0.045,
      maxPx: W * 0.10,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: W / 2,
      y: H * 0.63,
      fontFamily: "system-ui, sans-serif",
      weight: 400,
      lineHeight: 1.5,
      anchor: "middle",
      fill: c.muted,
      bg,
      letterSpacing: W * 0.003,
      checkLabel: "subtitle",
      maxW: W * 0.7,
      maxH: H * 0.10,
      minPx: W * 0.02,
      maxPx: W * 0.03,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  // Icon row
  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, W / 2, H * 0.78, W * 0.085, W * 0.018, { fieldBg: bg, onDark: true });
  parts.push(row.svg);

  // Tagline
  if (ctx.tagline) {
    parts.push(
      sTextLine(ctx.tagline, W / 2, H * 0.91, `font-family="system-ui, sans-serif" font-weight="400" font-size="${W * 0.016}px"`, c.muted, "middle")
    );
  }

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Dark Neon ---------------------------------------------------------------

function renderDarkNeon(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.08;
  const bg = isLight(pal.page_bg) ? darken(pal.page_bg, 0.92) : pal.page_bg;
  const neon = ensureContrast(pal.accent, bg, 5);
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  // Neon glow bands
  parts.push(bandGlow(W / 2, H * 0.08, W * 0.4, neon, 0.30));
  parts.push(bandGlow(W / 2, H * 0.92, W * 0.3, neon, 0.15));

  // Top neon line
  parts.push(sLine(PAD, H * 0.06, W - PAD, H * 0.06, neon, W * 0.003));

  // Hero icon — neon tinted
  const heroSize = W * 0.16;
  parts.push(
    heroSvg(ctx.topic.hero, neon, `${neon}33`, { x: PAD, y: H * 0.10, w: heroSize, h: heroSize })
  );

  // Neon accent frame around hero
  parts.push(
    sRoundRect(
      PAD - W * 0.008,
      H * 0.10 - W * 0.008,
      heroSize + W * 0.016,
      heroSize + W * 0.016,
      0,
      "none",
      `stroke="${neon}" stroke-width="${W * 0.003}" opacity="0.5"`
    )
  );

  const title = textBlock(
    {
      text: ctx.title,
      x: PAD,
      y: H * 0.38,
      fontFamily: "system-ui, sans-serif",
      weight: 800,
      lineHeight: 1.1,
      anchor: "start",
      fill: c.heading,
      bg,
      punchFill: neon,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: W - PAD * 2,
      maxH: H * 0.22,
      minPx: W * 0.045,
      maxPx: W * 0.10,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: PAD,
      y: H * 0.60,
      fontFamily: "system-ui, sans-serif",
      weight: 400,
      lineHeight: 1.5,
      anchor: "start",
      fill: c.muted,
      bg,
      checkLabel: "subtitle",
      maxW: W * 0.72,
      maxH: H * 0.10,
      minPx: W * 0.02,
      maxPx: W * 0.032,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  // Neon divider
  parts.push(sLine(PAD, H * 0.74, W - PAD, H * 0.74, neon, W * 0.002));

  // Icon row
  const row = drawIconRow(ctx.checks, pal, ctx.topic.icons, PAD, H * 0.78, W * 0.085, W * 0.018, { fieldBg: bg, onDark: true });
  parts.push(row.svg);

  // Tagline
  if (ctx.tagline) {
    parts.push(
      sTextLine(ctx.tagline, PAD, H * 0.91, `font-family="system-ui, sans-serif" font-weight="500" font-size="${W * 0.016}px"`, neon, "start")
    );
  }

  // Bottom neon line
  parts.push(sLine(PAD, H * 0.96, W - PAD, H * 0.96, neon, W * 0.003));

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// -- Minimal Lux ------------------------------------------------------------

function renderMinimalLux(ctx: StyleCtx): string {
  const { W, H, pal } = ctx;
  const PAD = W * 0.09;
  const bg = pal.page_bg;
  const c = resolveTextColors(ctx, bg);
  const parts: string[] = [];
  parts.push(sRect(0, 0, W, H, bg));

  const hairline = ensureContrast(pal.accent_soft, bg, 2);
  parts.push(sLine(PAD, PAD * 0.55, W - PAD, PAD * 0.55, hairline, W * 0.003));
  parts.push(sLine(PAD, PAD * 0.55, PAD, PAD * 0.55 + W * 0.03, c.accent, W * 0.006));

  const badge = drawBadge(ctx.checks, pal, "Essential", W / 2, H * 0.16, W * 0.014, { fieldBg: bg, onDark: false });
  parts.push(badge.svg);

  const title = textBlock(
    {
      text: ctx.title,
      x: W / 2,
      y: H * 0.32,
      fontFamily: "Georgia, 'Times New Roman', serif",
      weight: 600,
      lineHeight: 1.15,
      anchor: "middle",
      fill: c.heading,
      bg,
      punchFill: c.accent,
      punch: ctx.punch,
      checkLabel: "title",
      maxW: W - PAD * 2,
      maxH: H * 0.18,
      minPx: W * 0.05,
      maxPx: W * 0.095,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(title.svg);

  const sub = textBlock(
    {
      text: ctx.subtitle,
      x: W / 2,
      y: H * 0.55,
      fontFamily: "system-ui, sans-serif",
      weight: 400,
      lineHeight: 1.5,
      anchor: "middle",
      fill: c.muted,
      bg,
      letterSpacing: W * 0.004,
      checkLabel: "subtitle",
      maxW: W * 0.7,
      maxH: H * 0.10,
      minPx: W * 0.019,
      maxPx: W * 0.03,
      maxLines: 3,
    },
    ctx.checks
  );
  parts.push(sub.svg);

  const dividerY = H * 0.66;
  parts.push(sLine(W / 2 - W * 0.05, dividerY, W / 2 + W * 0.05, dividerY, hairline, W * 0.003));
  parts.push(
    sTextLine(ctx.tagline || "Less is more", W / 2, H * 0.72, `font-family="system-ui, sans-serif" font-weight="400" font-size="${W * 0.016}px"`, c.muted, "middle")
  );

  parts.push(sRect(0, H - W * 0.006, W, W * 0.006, c.accent));
  parts.push(sLine(PAD * 0.9, H - PAD, W - PAD * 0.9, H - PAD, hairline, W * 0.003));

  ctx.info.titlePx = title.fontSize;
  ctx.info.subtitlePx = sub.fontSize;
  ctx.info.lines = title.lines;
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

const RENDERERS: Record<CoverStyleId, (ctx: StyleCtx) => string> = {
  "bold-editorial": renderBoldEditorial,
  illustrated: renderIllustrated,
  "badge-grid": renderBadgeGrid,
  "dark-glow": renderDarkGlow,
  "dark-mono": renderDarkMono,
  "dark-gradient": renderDarkGradient,
  "dark-neon": renderDarkNeon,
  "minimal-lux": renderMinimalLux,
};

export function renderCover(req: CoverRequest): CoverResult {
  const W = req.size.width;
  const H = req.size.height;
  const pal = normalizePalette(req.palette);
  const topic = detectTopic(`${req.title} ${req.subtitle || ""} ${req.tagline || ""}`.trim());

  const explicit = req.punchWord !== undefined && req.punchWord !== null;
  const punch: string | null = explicit
    ? req.punchWord!.toLowerCase() === "none"
      ? null
      : req.punchWord!
    : detectPunchWord(req.title) ?? topic.punchFallback ?? null;

  const checks: ContrastCheck[] = [];
  const info: CoverResult["info"] = {
    punchWord: punch,
    category: topic.category,
    hero: topic.hero,
    iconCount: topic.icons.length,
    titlePx: 0,
    subtitlePx: 0,
    lines: 0,
  };

  const ctx: StyleCtx = {
    W,
    H,
    pal,
    topic,
    punch,
    title: req.title,
    subtitle: req.subtitle || "A Visual Learning Guide",
    tagline: req.tagline || "",
    checks,
    info,
  };

  const body = RENDERERS[req.styleId] ? RENDERERS[req.styleId](ctx) : renderIllustrated(ctx);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return { svg, width: W, height: H, styleId: req.styleId, checks, info };
}

// ---------------------------------------------------------------------------
// Browser rasterization (preview + PNG download)
// ---------------------------------------------------------------------------

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function rasterizeCover(
  svg: string,
  width: number,
  height: number,
  maxDim?: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const scale = maxDim ? Math.min(1, maxDim / Math.max(width, height)) : 1;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx2 = canvas.getContext("2d");
      if (!ctx2) return reject(new Error("no 2d context"));
      ctx2.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("failed to rasterize cover"));
    img.src = svgToDataUrl(svg);
  });
}

export async function coverToPng(svg: string, width: number, height: number): Promise<Blob> {
  const canvas = await rasterizeCover(svg, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encode failed"));
    }, "image/png");
  });
}
