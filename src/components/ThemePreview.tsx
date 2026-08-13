"use client";

interface ThemePreviewProps {
  theme: string;
}

const THEMES = {
  "Academic Textbook": {
    bg: "#ffffff",
    text: "#1a1a2e",
    heading: "#16213e",
    codeBg: "#f0f0f5",
    accent: "#0f3460",
    label: "Academic Textbook",
    desc: "Formal, serif fonts, structured layout",
  },
  "Modern Tech Blog": {
    bg: "#ffffff",
    text: "#2d3748",
    heading: "#1a202c",
    codeBg: "#1e1e2e",
    accent: "#6366f1",
    label: "Modern Tech Blog",
    desc: "Clean sans-serif, vibrant accents",
  },
  "Dark Mode Minimalist": {
    bg: "#0f172a",
    text: "#e2e8f0",
    heading: "#f8fafc",
    codeBg: "#1e293b",
    accent: "#38bdf8",
    label: "Dark Mode Minimalist",
    desc: "Dark background, minimal styling",
  },
};

export default function ThemePreview({ theme }: ThemePreviewProps) {
  const t = THEMES[theme as keyof typeof THEMES] || THEMES["Modern Tech Blog"];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-700/50">
      <div
        className="p-4"
        style={{ backgroundColor: t.bg, minHeight: "140px" }}
      >
        <p
          className="mb-1 text-xs font-bold uppercase tracking-wider"
          style={{ color: t.accent }}
        >
          {t.label}
        </p>
        <h4
          className="mb-2 text-lg font-bold"
          style={{ color: t.heading }}
        >
          Chapter Title
        </h4>
        <p className="mb-2 text-xs leading-relaxed" style={{ color: t.text }}>
          This is how your content will appear with the selected theme.
        </p>
        <div
          className="rounded-md p-2"
          style={{ backgroundColor: t.codeBg }}
        >
          <code
            className="text-[10px]"
            style={{ color: t.text, fontFamily: "monospace" }}
          >
            const hello = &quot;world&quot;;
          </code>
        </div>
        <p className="mt-2 text-[10px] italic" style={{ color: t.text, opacity: 0.7 }}>
          {t.desc}
        </p>
      </div>
    </div>
  );
}
