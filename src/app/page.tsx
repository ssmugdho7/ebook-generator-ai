"use client";

import { useState, useCallback, useEffect } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  getTemplates,
  generateBook,
  getBookPreview,
  applyComment,
  downloadBookPdf,
  type TemplateInfo,
  type Book,
} from "@/lib/api";

const PAGE_COUNTS = [5, 10, 15, 20];

const SAMPLE_CONTENT = `# React Hooks Deep Dive

I want a full chapter on React hooks: useState, useEffect, useMemo, useCallback, useRef.
Show how state drives rendering, how effects handle side effects, and common mistakes.
Include a diagram of the component lifecycle and progressive code examples.`;

export default function Home() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [content, setContent] = useState("");
  const [templateId, setTemplateId] = useState("minimal-light");
  const [targetPages, setTargetPages] = useState(10);

  const [book, setBook] = useState<Book | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);

  const [comment, setComment] = useState("");
  const [notes, setNotes] = useState<string[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTemplates()
      .then((ts) => {
        setTemplates(ts);
        if (ts.length > 0) setTemplateId(ts[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"));
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const refreshPreview = useCallback(async (b: Book) => {
    try {
      const html = await getBookPreview(b, b.template_id);
      setPreviewHtml(html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!content.trim()) return;
    setIsGenerating(true);
    setError(null);
    setNotes([]);
    setBook(null);
    setPreviewHtml("");
    setPageCount(null);
    try {
      const res = await generateBook(content, templateId, targetPages);
      setBook(res.book);
      setPageCount(res.page_count);
      await refreshPreview(res.book);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [content, templateId, targetPages, refreshPreview]);

  const handleApplyComment = useCallback(async () => {
    if (!book || !comment.trim()) return;
    setIsApplying(true);
    setError(null);
    try {
      const res = await applyComment(book, comment);
      setBook(res.book);
      setNotes(res.notes);
      await refreshPreview(res.book);
      setComment("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setIsApplying(false);
    }
  }, [book, comment, refreshPreview]);

  const handleDownload = useCallback(async () => {
    if (!book) return;
    setIsDownloading(true);
    setError(null);
    try {
      await downloadBookPdf(book, book.template_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setIsDownloading(false);
    }
  }, [book]);

  const handleLoadSample = useCallback(() => setContent(SAMPLE_CONTENT), []);

  const step = book ? 3 : 2;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-sm text-blue-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
            </span>
            AI-Powered
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Ebook Generator
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Pick a design, choose a length, then edit it with comments
          </p>
        </header>

        {/* Stepper */}
        <div className="mb-8 flex items-center justify-center gap-2 text-sm">
          {["Design", "Length", "Edit & Download"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  step > i
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-slate-700 bg-slate-800/50 text-slate-400"
                }`}
              >
                {i + 1}
              </div>
              <span className={step > i ? "text-slate-300" : "text-slate-500"}>
                {label}
              </span>
              {i < 2 && <span className="mx-1 h-px w-8 bg-slate-800" />}
            </div>
          ))}
        </div>

        {/* Step 1 + 2: Design + Length */}
        {!book && (
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Input */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Your Topic</h2>
                  <button
                    onClick={handleLoadSample}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  >
                    Load Sample
                  </button>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Paste your coding concepts, rough notes, code snippets..."
                  className="h-72 w-full resize-none rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 font-mono text-sm text-slate-200 placeholder-slate-500 transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
                <h2 className="mb-3 text-lg font-semibold text-white">
                  Target Length
                </h2>
                <div className="flex flex-wrap gap-2">
                  {PAGE_COUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTargetPages(n)}
                      className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                        targetPages === n
                          ? "border-blue-500/60 bg-blue-500/10 text-blue-300"
                          : "border-slate-700/50 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                      }`}
                    >
                      {n} pages
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Template picker */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
              <h2 className="mb-4 text-lg font-semibold text-white">
                Choose a Design
              </h2>
              {templates.length === 0 ? (
                <div className="flex items-center gap-3 text-sm text-slate-500">
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
                          ? "border-blue-500/60 bg-blue-500/10 ring-1 ring-blue-500/30"
                          : "border-slate-700/50 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="mb-3 h-14 overflow-hidden rounded-lg border border-slate-700/40"
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
                        <span className="text-sm font-medium text-white">
                          {t.label}
                        </span>
                        {t.dark && (
                          <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">
                            dark
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
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

        {/* Step 3: Preview + comment editing + download */}
        {book && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-sm">
              <div>
                <h2 className="text-lg font-semibold text-white">{book.title}</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  {book.sections.length} sections · {selectedTemplate?.label ?? book.template_id}
                  {pageCount !== null && (
                    <span className="ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                      {pageCount} pages (target {book.target_pages})
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setBook(null);
                    setPreviewHtml("");
                    setPageCount(null);
                    setNotes([]);
                  }}
                  className="rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
                >
                  Restart
                </button>
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <LoadingSpinner size="sm" /> Compiling PDF...
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

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              {/* Preview */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-300">
                    Live Preview
                  </h3>
                  {isApplying && (
                    <div className="flex items-center gap-2 text-xs text-blue-400">
                      <LoadingSpinner size="sm" /> Editing...
                    </div>
                  )}
                </div>
                <div className="h-[70vh] overflow-hidden rounded-xl border border-slate-700/40 bg-white">
                  {previewHtml ? (
                    <iframe
                      title="Book preview"
                      srcDoc={previewHtml}
                      className="h-full w-full border-0"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Loading preview...
                    </div>
                  )}
                </div>
              </div>

              {/* Comment editing */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-sm">
                  <h3 className="text-sm font-semibold text-white">
                    Edit with a comment
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Try: &quot;shorten section 2&quot;, &quot;add a diagram to the
                    last section&quot;, &quot;make the heading bigger&quot;, &quot;add a code
                    example&quot;
                  </p>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleApplyComment();
                      }
                    }}
                    placeholder='e.g. "shorten section 3"'
                    className="mt-3 h-24 w-full resize-none rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 text-sm text-slate-200 placeholder-slate-500 transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={handleApplyComment}
                    disabled={isApplying || !comment.trim()}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isApplying ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    )}
                    Apply edit
                  </button>

                  {notes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {notes.map((n, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-slate-700/40 bg-slate-800/40 px-3 py-1.5 text-xs text-slate-400"
                        >
                          {n}
                        </div>
                      ))}
                    </div>
                  )}
                  {error && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                      {error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-12 text-center text-xs text-slate-600">
          AI Ebook Generator — Built with Next.js &amp; FastAPI
        </footer>
      </div>
    </div>
  );
}
