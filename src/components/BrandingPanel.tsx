"use client";

import { useRef, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import { uploadBrandLogo, type EbookBranding, type TemplateInfo } from "@/lib/api";

interface BrandingPanelProps {
  branding: EbookBranding;
  /** Selected ebook template — the preview uses its palette (same visual language). */
  template?: TemplateInfo | null;
  bookTitle: string;
  bookSubtitle?: string;
  onSave: (branding: EbookBranding) => void;
  onClose: () => void;
}

export const EMPTY_BRANDING: EbookBranding = {
  enabled: false,
  company_name: "",
  logo_data: "",
  tagline: "",
  website: "",
  contact_text: "",
  copyright_text: "",
  footer_text: "",
  primary_color: null,
  secondary_color: null,
  about_enabled: false,
  about_description: "",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX_RE.test(withHash) ? withHash.toLowerCase() : null;
}

function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Relative luminance approximation (perceived brightness).
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** Client-side resize so uploads stay small; the server re-validates anyway. */
async function fileToResizedPng(file: File, max = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unsupported image format"));
      img.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Resize failed"))), "image/png")
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-accent focus:outline-none";

export default function BrandingPanel({
  branding,
  template,
  bookTitle,
  bookSubtitle,
  onSave,
  onClose,
}: BrandingPanelProps) {
  const [draft, setDraft] = useState<EbookBranding>({ ...EMPTY_BRANDING, ...branding });
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof EbookBranding>(key: K, value: EbookBranding[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Identity rule mirrors the backend: at least a company name or a logo.
  const hasIdentity = Boolean(draft.company_name.trim() || draft.logo_data);
  const canEnable = draft.enabled && hasIdentity;

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    setLogoError(null);
    setUploading(true);
    try {
      const blob = await fileToResizedPng(file);
      const dataUrl = await uploadBrandLogo(blob);
      set("logo_data", dataUrl);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSave = () => {
    onSave({
      ...draft,
      company_name: draft.company_name.trim().slice(0, 80),
      enabled: canEnable,
      primary_color: draft.primary_color && HEX_RE.test(draft.primary_color) ? draft.primary_color : null,
      secondary_color:
        draft.secondary_color && HEX_RE.test(draft.secondary_color) ? draft.secondary_color : null,
    });
    onClose();
  };

  const accent = normalizeHex(draft.primary_color || "") || template?.palette.accent || "#2563eb";
  const secondary =
    normalizeHex(draft.secondary_color || "") ||
    normalizeHex(draft.primary_color || "") ||
    "#64748b";
  // Preview uses the selected template's palette so it matches the final PDF.
  const pal = template?.palette;
  const coverBg = pal?.title_page_bg || pal?.page_bg || "#ffffff";
  const headingColor = pal?.heading || "#111827";
  const mutedColor = pal?.muted || "#6b7280";
  const isDarkCover = isDark(coverBg);
  const footerRule = isDarkCover ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 my-auto max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-card-border bg-card p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Brand Your Ebook</h2>
            <p className="mt-1 text-sm text-text-muted">
              Add your company identity. Branding is applied on top of the ebook —
              the AI never rewrites it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted hover:bg-accent/10 hover:text-accent"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Form */}
          <div className="space-y-4">
            {/* Enable */}
            <div className={`rounded-xl border p-4 transition-colors ${draft.enabled ? "border-accent/40 bg-accent/5" : "border-card-border bg-background"}`}>
              <label className="flex cursor-pointer items-center justify-between">
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    Apply branding to this ebook
                  </span>
                  <span className="block text-xs text-text-muted">
                    Cover, footer, colors{draft.about_enabled ? ", and an About page" : ""}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => set("enabled", e.target.checked)}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
              </label>
              {draft.enabled && !hasIdentity && (
                <p className="mt-2 text-xs text-red-400">
                  Add a company name or logo below to enable branding.
                </p>
              )}
            </div>

            {/* Logo */}
            <Field label="Company logo (PNG, JPEG, or WebP)">
              <div className="flex items-center gap-3">
                {draft.logo_data ? (
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-card-border bg-white p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.logo_data} alt="Company logo" className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-card-border text-text-muted">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <div className="space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => handleLogoFile(e.target.files?.[0])}
                    className="hidden"
                    id="brand-logo-input"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                  >
                    {uploading ? (
                      <span className="inline-flex items-center gap-2">
                        <LoadingSpinner size="sm" /> Uploading…
                      </span>
                    ) : draft.logo_data ? "Replace logo" : "Upload logo"}
                  </button>
                  {draft.logo_data && (
                    <button
                      type="button"
                      onClick={() => set("logo_data", "")}
                      className="ml-2 rounded-lg px-2 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {logoError && <p className="mt-2 text-xs text-red-400">{logoError}</p>}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Company name *">
                <input
                  value={draft.company_name}
                  onChange={(e) => set("company_name", e.target.value)}
                  maxLength={80}
                  placeholder="ACME Software Ltd"
                  className={inputCls}
                />
              </Field>
              <Field label="Tagline">
                <input
                  value={draft.tagline}
                  onChange={(e) => set("tagline", e.target.value)}
                  maxLength={100}
                  placeholder="Building tomorrow, today"
                  className={inputCls}
                />
              </Field>
              <Field label="Website">
                <input
                  value={draft.website}
                  onChange={(e) => set("website", e.target.value)}
                  maxLength={120}
                  placeholder="www.acme.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Contact line">
                <input
                  value={draft.contact_text}
                  onChange={(e) => set("contact_text", e.target.value)}
                  maxLength={200}
                  placeholder="hello@acme.com · +1 (555) 000-0000"
                  className={inputCls}
                />
              </Field>
              <Field label="Copyright line">
                <input
                  value={draft.copyright_text}
                  onChange={(e) => set("copyright_text", e.target.value)}
                  maxLength={120}
                  placeholder="© 2026 ACME Software Ltd"
                  className={inputCls}
                />
              </Field>
              <Field label="Footer text override">
                <input
                  value={draft.footer_text}
                  onChange={(e) => set("footer_text", e.target.value)}
                  maxLength={120}
                  placeholder="Leave empty to use company + website"
                  className={inputCls}
                />
              </Field>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Brand color (accents, diagrams)">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => set("primary_color", e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-card-border bg-background"
                    aria-label="Primary brand color picker"
                  />
                  <input
                    value={draft.primary_color ?? ""}
                    onChange={(e) => set("primary_color", e.target.value)}
                    maxLength={7}
                    placeholder="#2563eb"
                    className={inputCls}
                  />
                </div>
              </Field>
              <Field label="Secondary color (cover details)">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondary}
                    onChange={(e) => set("secondary_color", e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-card-border bg-background"
                    aria-label="Secondary brand color picker"
                  />
                  <input
                    value={draft.secondary_color ?? ""}
                    onChange={(e) => set("secondary_color", e.target.value)}
                    maxLength={7}
                    placeholder="#64748b"
                    className={inputCls}
                  />
                </div>
              </Field>
            </div>
            <p className="-mt-2 text-xs text-text-muted">
              Colors must be hex values (#rrggbb). Text stays readable automatically —
              contrast is adjusted against the template.
            </p>

            {/* About section */}
            <div className={`rounded-xl border p-4 ${draft.about_enabled ? "border-accent/40 bg-accent/5" : "border-card-border bg-background"}`}>
              <label className="flex cursor-pointer items-center justify-between">
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    Add an “About the Company” page
                  </span>
                  <span className="block text-xs text-text-muted">
                    A final page built only from the fields above — never AI-written
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.about_enabled}
                  onChange={(e) => set("about_enabled", e.target.checked)}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
              </label>
              {draft.about_enabled && (
                <textarea
                  value={draft.about_description}
                  onChange={(e) => set("about_description", e.target.value)}
                  maxLength={800}
                  placeholder="A short description of your company…"
                  className="mt-3 h-24 w-full resize-none rounded-lg border border-card-border bg-background p-3 text-sm text-foreground placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* Live preview card — same visual language as the ebook template */}
          <div className="space-y-4">
            <div
              className="overflow-hidden rounded-xl border border-card-border shadow-sm"
              style={{ background: coverBg }}
            >
              <div className="flex min-h-[300px] flex-col items-center px-6 pb-4 pt-10 text-center">
                {draft.logo_data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logo_data} alt="" className="mb-5 max-h-16 object-contain" />
                ) : null}
                {draft.company_name && (
                  <div
                    className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em]"
                    style={{ color: secondary }}
                  >
                    {draft.company_name}
                  </div>
                )}
                <hr className="mx-auto mb-5 w-14 border-0" style={{ height: 2, background: accent }} />
                <div
                  className="text-xl font-bold leading-snug"
                  style={{ color: headingColor }}
                >
                  {bookTitle || "Your ebook title"}
                </div>
                {(bookSubtitle || draft.tagline) && (
                  <div className="mt-2 text-[13px]" style={{ color: mutedColor }}>
                    {bookSubtitle}
                  </div>
                )}
                {draft.tagline && (
                  <div className="mt-3 text-[13px] italic" style={{ color: secondary }}>
                    “{draft.tagline}”
                  </div>
                )}
                <div className="flex-1" />
                {(draft.website || draft.copyright_text) && (
                  <div className="mt-8 text-[11px]" style={{ color: mutedColor }}>
                    {[draft.website, draft.copyright_text].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              {/* Footer strip preview */}
              <div
                className="flex items-center justify-between gap-3 px-4 py-2 text-[10px]"
                style={{
                  borderTop: `1px solid ${footerRule}`,
                  color: mutedColor,
                  fontFamily: draft.company_name.match(/[\u0980-\u09FF]/) ? "'Noto Sans Bengali', sans-serif" : undefined,
                }}
              >
                <span className="truncate">
                  {draft.footer_text ||
                    [draft.company_name, draft.website].filter(Boolean).join(" | ") ||
                    "Footer preview"}
                </span>
                <span>12</span>
              </div>
            </div>
            <p className="text-center text-xs text-text-muted">
              Preview on the “{template?.label ?? "selected"}” template · cover + per-page footer
            </p>
            <button
              onClick={handleSave}
              disabled={!canEnable && !hasIdentity}
              title={!hasIdentity ? "Add a company name or logo first" : undefined}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save branding
            </button>
            {!draft.enabled && hasIdentity && (
              <button
                onClick={() => set("enabled", true)}
                className="w-full rounded-xl border border-card-border px-4 py-2 text-xs font-medium text-text-muted transition-colors hover:text-accent"
              >
                Enable branding too
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
