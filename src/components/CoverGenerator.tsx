"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { TemplateInfo } from "@/lib/api";
import {
  COVER_SIZES,
  COVER_STYLES,
  renderCover,
  rasterizeCover,
  coverToPng,
  detectPunchWord,
  detectTopic,
  getPunchOptions,
  type CoverStyleId,
  type CoverSize,
  type CoverPalette,
} from "@/lib/covers";

interface CoverGeneratorProps {
  title: string;
  subtitle?: string;
  template?: TemplateInfo | null;
  onClose: () => void;
  onSelect?: (coverDataUrl: string) => void;
}

const NONE = "__none__";

function dataUrlOf(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export default function CoverGenerator({
  title,
  subtitle,
  template,
  onClose,
  onSelect,
}: CoverGeneratorProps) {
  const palette: CoverPalette = useMemo(
    () =>
      template?.palette
        ? {
            page_bg: template.palette.page_bg,
            accent: template.palette.accent,
            heading: template.palette.heading,
            text: template.palette.text,
            muted: template.palette.muted,
            accent_soft: template.palette.accent_soft,
            block_bg: template.palette.block_bg,
            title_page_bg: template.palette.title_page_bg,
          }
        : {
            page_bg: "#ffffff",
            accent: "#2563eb",
            heading: "#111827",
            text: "#374151",
          },
    [template]
  );

  const punchOptions = useMemo(() => {
    const titleWords = getPunchOptions(title);
    // Always include common accent words as fallback options
    const commonWords = [
      { value: "Guide", label: "Guide" },
      { value: "Deep Dive", label: "Deep Dive" },
      { value: "Mastery", label: "Mastery" },
      { value: "Essentials", label: "Essentials" },
      { value: "Handbook", label: "Handbook" },
      { value: "Playbook", label: "Playbook" },
      { value: "Blueprint", label: "Blueprint" },
      { value: "Masterclass", label: "Masterclass" },
    ];
    // Merge: title words first, then common words (skip duplicates)
    const seen = new Set(titleWords.map((w) => w.value.toLowerCase()));
    const extras = commonWords.filter((w) => !seen.has(w.value.toLowerCase()));
    return [...titleWords, ...extras];
  }, [title]);
  const [punch, setPunch] = useState<string>(() => {
    const auto = detectPunchWord(title) ?? detectTopic(title).punchFallback;
    return auto ? auto : NONE;
  });
  const [tagline, setTagline] = useState("");
  const [badgeText, setBadgeText] = useState("");
  const [styleId, setStyleId] = useState<CoverStyleId>("bold-editorial");
  const [sizeId, setSizeId] = useState("standard");
  const [downloading, setDownloading] = useState(false);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string>("");
  const [checks, setChecks] = useState<{ ok: boolean; total: number; failed: string[] }>({
    ok: true,
    total: 0,
    failed: [],
  });
  const renderToken = useRef(0);

  const currentSize: CoverSize =
    COVER_SIZES.find((s) => s.id === sizeId) || COVER_SIZES[0];

  const buildRequest = useCallback(
    (style: CoverStyleId, size: CoverSize) => ({
      title,
      subtitle: subtitle || "A Visual Learning Guide",
      tagline: tagline.trim(),
      badge_text: badgeText.trim(),
      punchWord: punch === NONE ? "none" : punch,
      styleId: style,
      size,
      palette,
    }),
    [title, subtitle, tagline, badgeText, punch, palette]
  );

  useEffect(() => {
    const token = ++renderToken.current;
    const timer = setTimeout(async () => {
      const result = renderCover(buildRequest(styleId, currentSize));
      setChecks({
        ok: result.checks.every((c) => c.ok),
        total: result.checks.length,
        failed: result.checks.filter((c) => !c.ok).map((c) => c.label),
      });
      try {
        const canvas = await rasterizeCover(result.svg, result.width, result.height, 1600);
        if (token === renderToken.current) setPreview(dataUrlOf(canvas));
      } catch {
        /* preview rasterization failed; keep previous */
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [styleId, sizeId, punch, tagline, badgeText, palette, buildRequest, currentSize]);

  useEffect(() => {
    let cancelled = false;
    const size = { id: "thumb", name: "Thumb", width: 300, height: 450, label: "300 × 450" };
    (async () => {
      const entries = await Promise.all(
        COVER_STYLES.map(async (s) => {
          const result = renderCover(buildRequest(s.id, size));
          const canvas = await rasterizeCover(result.svg, result.width, result.height, 120);
          return [s.id, dataUrlOf(canvas)] as const;
        })
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [buildRequest]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const result = renderCover(buildRequest(styleId, currentSize));
      const blob = await coverToPng(result.svg, result.width, result.height);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const slug = title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      link.download = `${slug}-cover-${styleId}-${currentSize.id}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [buildRequest, styleId, currentSize, title]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      {/* my-auto (not items-center alone) keeps a tall modal fully
          scrollable instead of clipping its top edge. */}
      <div className="mx-4 my-auto max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-card-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Download Cover</h2>
            <p className="mt-1 text-sm text-text-muted">
              5 professional layouts with automatic topic icons and WCAG contrast
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted hover:bg-accent/10 hover:text-accent"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            {/* Styles */}
            <div>
              <h3 className="mb-3 text-sm font-semibold text-foreground">Style</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {COVER_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setStyleId(style.id)}
                    className={`rounded-xl border p-2 text-left transition-all ${
                      styleId === style.id
                        ? "border-accent/60 bg-accent/10 ring-1 ring-accent/30"
                        : "border-card-border bg-background hover:border-accent/30"
                    }`}
                  >
                    <div className="relative mb-2 aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-200">
                      {thumbs[style.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbs[style.id]}
                          alt={style.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-text-muted">
                          ...
                        </div>
                      )}
                    </div>
                    <span className="block text-[11px] font-semibold text-foreground">
                      {style.name}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-tight text-text-muted">
                      {style.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">
                  Accent word
                </span>
                <select
                  value={punch}
                  onChange={(e) => setPunch(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value={NONE}>None (plain title)</option>
                  {punchOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">
                  Tagline <span className="font-normal text-text-muted">(optional)</span>
                </span>
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Empty = no tagline line"
                  maxLength={60}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">
                  Badge label <span className="font-normal text-text-muted">(optional)</span>
                </span>
                <input
                  value={badgeText}
                  onChange={(e) => setBadgeText(e.target.value)}
                  placeholder='e.g. "Field Guide"'
                  maxLength={30}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">
                  Size
                </span>
                <select
                  value={sizeId}
                  onChange={(e) => setSizeId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  {COVER_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.label})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Preview + download — shown FIRST on phones so users see the
              artwork and its actions without scrolling past the whole form */}
          <div className="order-first space-y-4 lg:order-none">
            <div className="overflow-hidden rounded-xl border border-card-border bg-white">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Cover preview"
                  className="mx-auto h-auto max-h-[52vh] w-full object-contain sm:max-h-none"
                  style={{ aspectRatio: `${currentSize.width}/${currentSize.height}` }}
                />
              ) : (
                <div
                  className="flex items-center justify-center text-text-muted"
                  style={{ aspectRatio: `${currentSize.width}/${currentSize.height}` }}
                >
                  <LoadingSpinner size="sm" />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">
                {currentSize.width} × {currentSize.height} px
              </span>
              <span
                className={
                  checks.ok
                    ? "inline-flex items-center gap-1 font-medium text-emerald-600"
                    : "inline-flex items-center gap-1 font-medium text-red-600"
                }
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${checks.ok ? "bg-emerald-500" : "bg-red-500"}`}
                />
                {checks.ok
                  ? `WCAG contrast: ${checks.total} pairs pass`
                  : `Contrast issues: ${checks.failed.join(", ")}`}
              </span>
            </div>
            {onSelect && (
              <button
                onClick={() => preview && onSelect(preview)}
                disabled={!preview}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent transition-all hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Use this cover
              </button>
            )}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <LoadingSpinner size="sm" /> Rendering PNG...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Cover (PNG)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
