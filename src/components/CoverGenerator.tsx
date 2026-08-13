"use client";

import { useState, useRef, useCallback } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";

interface CoverGeneratorProps {
  title: string;
  subtitle?: string;
  templateId: string;
  onClose: () => void;
}

interface CoverVariant {
  id: string;
  name: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, title: string, subtitle: string) => void;
}

interface CoverSize {
  id: string;
  name: string;
  width: number;
  height: number;
  label: string;
}

const COVER_SIZES: CoverSize[] = [
  { id: "standard", name: "Standard eBook", width: 1600, height: 2400, label: "1600 × 2400" },
  { id: "kindle", name: "Amazon Kindle", width: 1600, height: 2560, label: "1600 × 2560" },
  { id: "square", name: "Square (Social)", width: 1200, height: 1200, label: "1200 × 1200" },
  { id: "a4", name: "A4 Portrait", width: 2480, height: 3508, label: "2480 × 3508" },
  { id: "wide", name: "Wide Banner", width: 1920, height: 1080, label: "1920 × 1080" },
  { id: "booklet", name: "Booklet", width: 1200, height: 1800, label: "1200 × 1800" },
];

const COVERS: CoverVariant[] = [
  {
    id: "minimal",
    name: "Minimal",
    render: (ctx, w, h, title, subtitle) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1e293b";
      ctx.font = `bold ${Math.floor(w / 18)}px Georgia, serif`;
      ctx.textAlign = "center";
      wrapText(ctx, title, w / 2, h / 2 - h * 0.05, w - w * 0.15, Math.floor(w / 16));
      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.floor(w / 40)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, w / 2, h / 2 + h * 0.12);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(w / 2 - w * 0.05, h / 2 + h * 0.16, w * 0.1, h * 0.005);
    },
  },
  {
    id: "gradient",
    name: "Gradient",
    render: (ctx, w, h, title, subtitle) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#3b82f6");
      grad.addColorStop(1, "#8b5cf6");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.floor(w / 18)}px Georgia, serif`;
      ctx.textAlign = "center";
      wrapText(ctx, title, w / 2, h / 2 - h * 0.05, w - w * 0.15, Math.floor(w / 16));
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `${Math.floor(w / 40)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, w / 2, h / 2 + h * 0.12);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(w / 2 - w * 0.05, h / 2 + h * 0.16, w * 0.1, h * 0.005);
    },
  },
  {
    id: "dark",
    name: "Dark",
    render: (ctx, w, h, title, subtitle) => {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f1f5f9";
      ctx.font = `bold ${Math.floor(w / 18)}px Georgia, serif`;
      ctx.textAlign = "center";
      wrapText(ctx, title, w / 2, h / 2 - h * 0.05, w - w * 0.15, Math.floor(w / 16));
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${Math.floor(w / 40)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, w / 2, h / 2 + h * 0.12);
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(w / 2 - w * 0.05, h / 2 + h * 0.16, w * 0.1, h * 0.005);
    },
  },
  {
    id: "nature",
    name: "Nature",
    render: (ctx, w, h, title, subtitle) => {
      ctx.fillStyle = "#ecfdf5";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#065f46";
      ctx.font = `bold ${Math.floor(w / 18)}px Georgia, serif`;
      ctx.textAlign = "center";
      wrapText(ctx, title, w / 2, h / 2 - h * 0.05, w - w * 0.15, Math.floor(w / 16));
      ctx.fillStyle = "#047857";
      ctx.font = `${Math.floor(w / 40)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, w / 2, h / 2 + h * 0.12);
      ctx.fillStyle = "#10b981";
      ctx.fillRect(w / 2 - w * 0.05, h / 2 + h * 0.16, w * 0.1, h * 0.005);
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    render: (ctx, w, h, title, subtitle) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#f97316");
      grad.addColorStop(1, "#ec4899");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.floor(w / 18)}px Georgia, serif`;
      ctx.textAlign = "center";
      wrapText(ctx, title, w / 2, h / 2 - h * 0.05, w - w * 0.15, Math.floor(w / 16));
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `${Math.floor(w / 40)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, w / 2, h / 2 + h * 0.12);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(w / 2 - w * 0.05, h / 2 + h * 0.16, w * 0.1, h * 0.005);
    },
  },
];

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line + word + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line.trim(), x, currentY);
      line = word + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
}

export default function CoverGenerator({
  title,
  subtitle,
  templateId,
  onClose,
}: CoverGeneratorProps) {
  const [selectedCover, setSelectedCover] = useState("minimal");
  const [selectedSize, setSelectedSize] = useState("standard");
  const [downloading, setDownloading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentSize = COVER_SIZES.find((s) => s.id === selectedSize) || COVER_SIZES[0];

  const renderCover = useCallback(
    (coverId: string, sizeId: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cover = COVERS.find((c) => c.id === coverId);
      const size = COVER_SIZES.find((s) => s.id === sizeId) || COVER_SIZES[0];
      if (!cover) return;

      canvas.width = size.width;
      canvas.height = size.height;
      cover.render(ctx, size.width, size.height, title, subtitle || "A Visual Learning Guide");
    },
    [title, subtitle]
  );

  const handleDownload = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setDownloading(true);
    try {
      const link = document.createElement("a");
      const sizeLabel = currentSize.id !== "standard" ? `-${currentSize.id}` : "";
      link.download = `${title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-cover${sizeLabel}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setDownloading(false);
    }
  }, [title, currentSize]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-card-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Download Cover</h2>
            <p className="mt-1 text-sm text-text-muted">
              Choose a style and size for your ebook cover
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

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Cover variants */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Choose a style</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {COVERS.map((cover) => (
                <button
                  key={cover.id}
                  onClick={() => {
                    setSelectedCover(cover.id);
                    renderCover(cover.id, selectedSize);
                  }}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    selectedCover === cover.id
                      ? "border-accent/60 bg-accent/10 ring-1 ring-accent/30"
                      : "border-card-border bg-background hover:border-accent/30"
                  }`}
                >
                  <div className="mb-2 h-20 overflow-hidden rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20">
                    <div className="flex h-full items-center justify-center text-xs text-text-muted">
                      {cover.name}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-foreground">{cover.name}</span>
                </button>
              ))}
            </div>

            {/* Size selector */}
            <div className="mt-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Choose a size</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COVER_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => {
                      setSelectedSize(size.id);
                      renderCover(selectedCover, size.id);
                    }}
                    className={`rounded-lg border p-2.5 text-left transition-all ${
                      selectedSize === size.id
                        ? "border-accent/60 bg-accent/10 ring-1 ring-accent/30"
                        : "border-card-border bg-background hover:border-accent/30"
                    }`}
                  >
                    <span className="text-xs font-medium text-foreground">{size.name}</span>
                    <span className="mt-0.5 block text-[10px] text-text-muted">{size.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Preview + download */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-card-border bg-white">
              <canvas
                ref={canvasRef}
                className="h-auto w-full"
                style={{ aspectRatio: `${currentSize.width}/${currentSize.height}` }}
              />
            </div>
            <div className="text-center text-xs text-text-muted">
              {currentSize.width} × {currentSize.height} px
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <LoadingSpinner size="sm" /> Downloading...
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
