"use client";

import { useState, useCallback, useEffect } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import CoverGenerator from "@/components/CoverGenerator";
import DownloadProgressModal from "@/components/DownloadProgressModal";
import GenerateProgressModal from "@/components/GenerateProgressModal";
import BookEditor from "@/components/BookEditor";
import BrandingPanel, { EMPTY_BRANDING } from "@/components/BrandingPanel";
import AuthModal from "@/components/AuthModal";
import { useAuth } from "@/lib/auth";
import {
  getTemplates,
  generateBook,
  downloadBookPdf,
  getLibrary,
  getLibraryBook,
  downloadStoredPdf,
  deleteLibraryItem,
  saveEbookBranding,
  type TemplateInfo,
  type Book,
  type EbookBranding,
  type EbookLanguage,
  type LibraryItem,
} from "@/lib/api";

const PAGE_COUNTS = [5, 10, 15, 20];

const LANGUAGES: { id: EbookLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "bn", label: "বাংলা (Bengali)" },
];

/** Features that require a logged-in account. */
const GATED_PAGES = new Set([15, 20]);
const GATED_LANGUAGES = new Set<EbookLanguage>(["bn"]);

const SAMPLE_CONTENT = `# React Hooks Deep Dive

I want a full chapter on React hooks: useState, useEffect, useMemo, useCallback, useRef.
Show how state drives rendering, how effects handle side effects, and common mistakes.
Include a diagram of the component lifecycle and progressive code examples.

Tell it like a story a teacher would tell in class — one simple everyday world,
a couple of characters, and a cliffhanger at the end of every section.`;

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState("");

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [content, setContent] = useState("");
  const [templateId, setTemplateId] = useState("minimal-light");
  const [targetPages, setTargetPages] = useState(10);

  const [book, setBook] = useState<Book | null>(null);
  const [ebookId, setEbookId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  // Language: which version to produce.
  const [language, setLanguage] = useState<EbookLanguage>("en");

  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryEnabled, setLibraryEnabled] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showCoverModal, setShowCoverModal] = useState(false);
  // Selected client-side cover (PNG data URL) embedded as PDF page 1.
  const [selectedCover, setSelectedCover] = useState<string | null>(null);
  const [showBrandingModal, setShowBrandingModal] = useState(false);

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await getLibrary(12);
      setLibrary(res.items);
      setLibraryEnabled(res.database);
    } catch {
      setLibraryEnabled(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Kick both fetches from an async body: state lands after the awaits, so no
    // synchronous setState inside the effect (and no updates after unmount).
    (async () => {
      try {
        const ts = await getTemplates();
        if (cancelled) return;
        setTemplates(ts);
        if (ts.length > 0) setTemplateId(ts[0].id);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unable to load design templates. Please try again.");
        }
      }
      if (!cancelled) await refreshLibrary();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);

  // ---- Book Studio persistence (so an edited ebook stays editable on refresh) ----
  const STUDIO_KEY = "ebook-studio-v1";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STUDIO_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && s.book) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBook(s.book);
        setEbookId(s.ebook_id ?? null);
        setTemplateId(s.template_id || "minimal-light");
        setLanguage(s.language === "bn" ? "bn" : "en");
        setSelectedCover(s.cover_image ?? null);
      }
    } catch {
      /* ignore corrupt storage */
    }
    // run once on mount
  }, []);

  useEffect(() => {
    if (!book) return;
    try {
      localStorage.setItem(
        STUDIO_KEY,
        JSON.stringify({
          book,
          ebook_id: ebookId,
          template_id: templateId,
          language,
          cover_image: selectedCover,
        })
      );
    } catch {
      /* storage may be full/unavailable; non-fatal */
    }
  }, [book, ebookId, templateId, language, selectedCover]);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  // Turn raw backend errors into something a reader can act on.
  const friendlyError = (e: unknown, fallback: string): string => {
    const msg = e instanceof Error ? e.message : fallback;
    // Our daily generation limit
    if (/daily limit/i.test(msg) || /contact the admin/i.test(msg)) {
      return msg;
    }
    if (
      /429/.test(msg) ||
      /quota/i.test(msg) ||
      /resource_exhausted/i.test(msg) ||
      /rate.?limit/i.test(msg)
    ) {
      return (
        "We're experiencing high demand right now. Please try again in a few minutes."
      );
    }
    return msg;
  };

  const handleBookChange = useCallback((b: Book) => {
    setBook(b);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!content.trim()) return;
    setIsGenerating(true);
    setError(null);
    setBook(null);
    setEbookId(null);
    setPageCount(null);
    setShowCoverModal(false);
    setSelectedCover(null);
    try {
      const res = await generateBook(content, templateId, targetPages, language);
      setBook(res.book);
      setEbookId(res.ebook_id ?? null);
      setPageCount(res.page_count);
      refreshLibrary();
    } catch (e) {
      setError(friendlyError(e, "Unable to generate ebook. Please try again."));
    } finally {
      setIsGenerating(false);
    }
  }, [content, templateId, targetPages, language, refreshLibrary]);

  const handleSelectCover = useCallback(async (dataUrl: string) => {
    setSelectedCover(dataUrl);
    setShowCoverModal(false);
    setError(null);
  }, []);

  // Branding lives INSIDE the book object, so previews, downloads and studio
  // persistence pick it up automatically with no API changes. When the ebook
  // is stored in the library we also persist server-side (best-effort) so
  // branding survives closing the browser.
  const handleSaveBranding = useCallback(
    (branding: EbookBranding) => {
      setBook((prev) => (prev ? { ...prev, branding } : prev));
      if (ebookId) {
        const empty =
          !branding.enabled || (!branding.company_name.trim() && !branding.logo_data);
        saveEbookBranding(ebookId, empty ? null : branding).catch(() => {
          /* non-fatal: studio keeps working from localStorage */
        });
      }
    },
    [ebookId]
  );

  const handleDownload = useCallback(async () => {
    if (!book) return;
    setIsDownloading(true);
    setError(null);
    setDownloadProgress(0);
    setDownloadStatus("Starting download…");
    let progressTimer: NodeJS.Timeout | null = null;
    try {
      progressTimer = setInterval(() => {
        setDownloadProgress((p) => {
          if (p >= 90) {
            if (progressTimer) clearInterval(progressTimer);
            return 90;
          }
          return p + Math.random() * 15;
        });
      }, 400);
      setDownloadStatus("Compiling PDF…");
      await downloadBookPdf(book, book.template_id, ebookId, language, selectedCover);
      setDownloadProgress(100);
      setDownloadStatus("Download complete!");
      refreshLibrary();
    } catch (e) {
      setError(friendlyError(e, "Unable to download PDF. Please try again."));
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setTimeout(() => {
        setIsDownloading(false);
        setDownloadProgress(0);
        setDownloadStatus("");
      }, 800);
    }
  }, [book, language, ebookId, selectedCover, refreshLibrary]);

  const handleOpenLibraryItem = useCallback(
    async (item: LibraryItem) => {
      setBusyItemId(item.id);
      setError(null);
      try {
        const entry = await getLibraryBook(item.id);
        setBook(entry.book);
        setEbookId(entry.id);
        setPageCount(entry.page_count ?? null);
        setTemplateId(entry.book.template_id);
      } catch (e) {
        setError(friendlyError(e, "Unable to open ebook. Please try again."));
      } finally {
        setBusyItemId(null);
      }
    },
    []
  );

  const handleStoredPdf = useCallback(async (item: LibraryItem) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      await downloadStoredPdf(item.id, item.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download stored PDF. Please try again.");
    } finally {
      setBusyItemId(null);
    }
  }, []);

  const handleDeleteLibraryItem = useCallback(
    async (item: LibraryItem) => {
      setBusyItemId(item.id);
      try {
        await deleteLibraryItem(item.id);
        await refreshLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to delete ebook. Please try again.");
      } finally {
        setBusyItemId(null);
      }
    },
    [refreshLibrary]
  );

  const handleLoadSample = useCallback(() => setContent(SAMPLE_CONTENT), []);

  const step = book ? 3 : 2;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-4 py-1.5 text-sm text-accent">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent"></span>
            </span>
            AI-Powered
          </div>
          <div className="flex items-center justify-center gap-4">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Ebook Generator
            </h1>
            {!authLoading && (
              <div className="hidden sm:block">
                {user ? (
                  <div className="flex items-center gap-2 rounded-full border border-card-border bg-card px-3 py-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-text-muted">{user.email}</span>
                    <button
                      onClick={logout}
                      className="ml-1 text-text-muted transition-colors hover:text-red-400"
                      title="Sign out"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAuthModalMessage("");
                      setAuthModalOpen(true);
                    }}
                    className="rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                  >
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="mt-3 text-lg text-text-muted">
            Transform your notes into beautifully crafted ebooks with AI
          </p>
        </header>

        {/* Stepper */}
        <div className="mb-8 flex items-center justify-center gap-2 text-sm">
          {["Design", "Length", "Download"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  step > i
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-card-border bg-card text-text-muted"
                }`}
              >
                {i + 1}
              </div>
              <span className={step > i ? "text-foreground" : "text-text-muted"}>
                {label}
              </span>
              {i < 2 && <span className="mx-1 h-px w-8 bg-card-border" />}
            </div>
          ))}
        </div>

        {/* Step 1 + 2: Design + Length */}
        {!book && (
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Input */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">Your Topic</h2>
                  <button
                    onClick={handleLoadSample}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    Load Sample
                  </button>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe your topic, paste notes, or share code snippets — we'll turn them into a polished ebook."
                  className="h-72 w-full resize-none rounded-xl border border-card-border bg-background p-4 font-mono text-sm text-foreground placeholder-text-muted transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              <div className="rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
                <h2 className="mb-3 text-lg font-semibold text-foreground">
                  Target Length
                </h2>
                <div className="flex flex-wrap gap-2">
                  {PAGE_COUNTS.map((n) => {
                    const isLocked = !user && GATED_PAGES.has(n);
                    return (
                      <button
                        key={n}
                        onClick={() => {
                          if (isLocked) {
                            setAuthModalMessage("Sign in to generate longer ebooks (15 or 20 pages).");
                            setAuthModalOpen(true);
                            return;
                          }
                          setTargetPages(n);
                        }}
                        className={`relative rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                          targetPages === n && !isLocked
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : isLocked
                              ? "cursor-not-allowed border-card-border/50 bg-background/50 text-text-muted/50"
                              : "border-card-border bg-background text-text-muted hover:border-accent/30 hover:text-foreground"
                        }`}
                      >
                        {isLocked && (
                          <svg className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                          </svg>
                        )}
                        {n} pages
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
                <h2 className="mb-3 text-lg font-semibold text-foreground">
                  Language
                </h2>
                <p className="mb-3 text-xs text-text-muted">
                  Write the story in English or Bengali (বাংলা). Code and
                  identifiers stay English; only the story is translated.
                </p>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((l) => {
                    const isLocked = !user && GATED_LANGUAGES.has(l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          if (isLocked) {
                            setAuthModalMessage("Sign in to generate ebooks in Bengali.");
                            setAuthModalOpen(true);
                            return;
                          }
                          setLanguage(l.id);
                        }}
                        className={`relative rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                          language === l.id && !isLocked
                            ? "border-accent/60 bg-accent/10 text-accent"
                            : isLocked
                              ? "cursor-not-allowed border-card-border/50 bg-background/50 text-text-muted/50"
                              : "border-card-border bg-background text-text-muted hover:border-accent/30 hover:text-foreground"
                        }`}
                      >
                        {isLocked && (
                          <svg className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                          </svg>
                        )}
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Template picker */}
            <div className="rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                Choose a Design
              </h2>
              {templates.length === 0 ? (
                <div className="flex items-center gap-3 text-sm text-text-muted">
                  <LoadingSpinner size="sm" /> Loading templates...
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={`group rounded-xl border p-4 text-left transition-all ${
                        templateId === t.id
                          ? "border-accent/60 bg-accent/10 ring-1 ring-accent/30"
                          : "border-card-border bg-background hover:border-accent/30 hover:bg-accent/5"
                      }`}
                    >
                      <div className="mb-3 h-14 overflow-hidden rounded-lg border border-card-border"
                        style={{
                          background: t.palette.page_bg,
                          borderTop: `6px solid ${t.palette.accent}`,
                        }}
                      >
                        <div className="px-2 py-1.5">
                          <div
                            className="h-2 w-16 rounded"
                            style={{ background: t.palette.accent }}
                          />
                          <div
                            className="mt-1.5 h-1.5 w-24 rounded"
                            style={{ background: t.palette.heading, opacity: 0.85 }}
                          />
                          <div
                            className="mt-1 h-1.5 w-20 rounded"
                            style={{ background: t.palette.text, opacity: 0.5 }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">
                          {t.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {t.description}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={isGenerating || !content.trim() || templates.length === 0}
                className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {isGenerating ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Generating outline...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Ebook
                  </>
                )}
              </button>

              {error && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Library — recent ebooks kept in Neon Postgres */}
        {!book && !user && !authLoading && (
          <div className="mt-8 rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
                <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-foreground">Your Library</h3>
              <p className="mt-1 max-w-sm text-sm text-text-muted">
                Sign in to save your generated ebooks and access them anytime from any device.
              </p>
              <button
                onClick={() => {
                  setAuthModalMessage("Sign in to save and access your ebook library.");
                  setAuthModalOpen(true);
                }}
                className="mt-4 rounded-xl border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
              >
                Sign in to get started
              </button>
            </div>
          </div>
        )}

        {!book && user && libraryEnabled && library.length > 0 && (
          <div className="mt-8 rounded-2xl border border-card-border bg-card p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Your Library
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  Your saved ebooks — open the preview or download the PDF anytime
                </p>
              </div>
              <button
                onClick={refreshLibrary}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
              >
                Refresh
              </button>
            </div>

            <ul className="divide-y divide-card-border">
              {library.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {item.section_count} sections
                      {item.page_count ? ` · ${item.page_count} pages` : ""} ·{" "}
                      {item.template_id}
                      {item.created_at
                        ? ` · ${new Date(item.created_at).toLocaleDateString()}`
                        : ""}
                      {item.has_pdf && (
                        <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                          PDF saved
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busyItemId === item.id && <LoadingSpinner size="sm" />}
                    <button
                      onClick={() => handleOpenLibraryItem(item)}
                      disabled={busyItemId === item.id}
                      className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                    >
                      Open
                    </button>
                    {item.has_pdf && (
                      <button
                        onClick={() => handleStoredPdf(item)}
                        disabled={busyItemId === item.id}
                        className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
                      >
                        PDF
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteLibraryItem(item)}
                      disabled={busyItemId === item.id}
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-red-400 disabled:opacity-50"
                      aria-label={`Delete ${item.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Step 3: Preview + download */}
        {book && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-card-border bg-card p-5 backdrop-blur-sm">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{book.title}</h2>
                <p className="mt-0.5 text-sm text-text-muted">
                  {book.sections.length} sections · {selectedTemplate?.label ?? book.template_id}
                  {pageCount !== null && (
                    <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                      {pageCount} pages (target {book.target_pages})
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setBook(null);
                    setEbookId(null);
                    setPageCount(null);
                    setSelectedCover(null);
                    setError(null);
                    refreshLibrary();
                  }}
                  className="rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/10 hover:text-accent"
                >
                  Start Over
                </button>
                <button
                  onClick={() => setShowCoverModal(true)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                    selectedCover
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-card-border bg-background text-foreground hover:bg-accent/10 hover:text-accent"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 4h16v12H4z" />
                  </svg>
                  {selectedCover ? "Change Cover" : "Choose Cover"}
                </button>
                <button
                  onClick={() => setShowBrandingModal(true)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                    book.branding?.enabled
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-card-border bg-background text-foreground hover:bg-accent/10 hover:text-accent"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  {book.branding?.enabled ? "Branding On" : "Brand Your Ebook"}
                </button>
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <LoadingSpinner size="sm" /> Compiling PDF…
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Download PDF
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Book Studio: section list · preview · AI controls */}
            <BookEditor
              book={book}
              ebookId={ebookId}
              templateId={book.template_id}
              language={language}
              coverImage={selectedCover}
              onBookChange={handleBookChange}
            />

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        <footer className="mt-12 border-t border-card-border pt-6 pb-8 text-center text-xs text-text-muted">
          <p className="font-medium text-foreground">Ebook Generator</p>
          <p className="mt-1">Transform notes into publication-ready ebooks</p>
          <div className="mt-4 flex items-center justify-center gap-4 text-text-muted">
            <a href="mailto:shahmarufsiraj@gmail.com" className="transition-colors hover:text-accent">
              shahmarufsiraj@gmail.com
            </a>
            <span className="text-card-border">·</span>
            <a href="https://www.linkedin.com/in/shahmarufsiraj360/" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
              LinkedIn
            </a>
            <span className="text-card-border">·</span>
            <a href="https://www.facebook.com/shahmarufsirajdeveloper" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
              Facebook
            </a>
          </div>
        </footer>
      </div>

      {showCoverModal && book && (
        <CoverGenerator
          title={book.title}
          subtitle={book.subtitle || ""}
          template={templates.find((t) => t.id === book.template_id) ?? null}
          onClose={() => setShowCoverModal(false)}
          onSelect={handleSelectCover}
        />
      )}
      {showBrandingModal && book && (
        <BrandingPanel
          branding={book.branding ?? EMPTY_BRANDING}
          template={templates.find((t) => t.id === book.template_id) ?? null}
          bookTitle={book.title}
          bookSubtitle={book.subtitle || ""}
          onSave={handleSaveBranding}
          onClose={() => setShowBrandingModal(false)}
        />
      )}
      <DownloadProgressModal
        isOpen={isDownloading}
        progress={Math.min(downloadProgress, 100)}
        status={downloadStatus}
      />
      <GenerateProgressModal isOpen={isGenerating} />
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        message={authModalMessage || undefined}
      />
    </div>
  );
}
