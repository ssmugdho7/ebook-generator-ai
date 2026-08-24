"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import LoadingSpinner from "@/components/LoadingSpinner";
import ThemeToggle from "@/components/ThemeToggle";
import ScrollToTop from "@/components/ScrollToTop";
import {
  downloadSharedPdf,
  fetchSharedBook,
  getBookPreview,
  isInAppBrowser,
  sharedPdfNavUrl,
  type EbookBranding,
  type SharedBookPayload,
} from "@/lib/api";

type ReaderState =
  | { phase: "loading" }
  | { phase: "password"; error: string | null }
  | { phase: "gone"; message: string }
  | { phase: "ready"; data: SharedBookPayload; html: string };

/**
 * Public read-only reader for /r/<token> links. Reuses the backend's
 * /api/preview renderer so visitors see exactly what the owner (and the PDF)
 * looks like — template styling, mermaid diagrams, branding and all.
 */
export default function SharedReader({ token }: { token: string }) {
  const [state, setState] = useState<ReaderState>({ phase: "loading" });
  const [pwInput, setPwInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchSharedBook(token);
      const html = await getBookPreview(
        data.book,
        data.template_id,
        data.cover_image ?? null
      );
      setState({ phase: "ready", data, html });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        // A stored password that no longer matches after a failed attempt
        // should not keep poisoning retries — clear it.
        sessionStorage.removeItem(`share-pw-${token}`);
        setState({ phase: "password", error: err.message });
      } else {
        setState({ phase: "gone", message: err.message || "This link is invalid or has expired." });
      }
    }
  }, [token]);

  useEffect(() => {
    // Async body: state updates land after await points, so nothing is set
    // synchronously inside the effect.
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleUnlock = useCallback(async () => {
    if (!pwInput.trim() || unlocking) return;
    setUnlocking(true);
    sessionStorage.setItem(`share-pw-${token}`, pwInput.trim());
    await load();
    setUnlocking(false);
  }, [pwInput, unlocking, token, load]);

  const handleDownload = useCallback(async () => {
    if (state.phase !== "ready" || downloading) return;
    // In-app browsers (Messenger, Instagram, ...) block blob: downloads and
    // ignore <a download>. Navigating straight to the PDF works everywhere:
    // the server's Content-Disposition: attachment hands the file to the
    // platform's download/viewer flow without leaving this page in regular
    // browsers either.
    if (isInAppBrowser()) {
      setDownloading(true);
      window.location.assign(sharedPdfNavUrl(token));
      // If navigation was blocked (rare), restore the button.
      setTimeout(() => setDownloading(false), 4000);
      return;
    }
    setDownloading(true);
    try {
      await downloadSharedPdf(token, state.data.title);
    } catch {
      /* the button simply does nothing if no PDF exists */
    } finally {
      setDownloading(false);
    }
  }, [state, downloading, token]);

  /* Keep the browser tab title in sync with the shared book. */
  useEffect(() => {
    if (state.phase === "ready") document.title = `${state.data.title} · Shared ebook`;
  }, [state]);

  if (state.phase === "loading") {
    return (
      <Centered>
        <LoadingSpinner />
        <p className="mt-4 text-sm text-text-muted">Opening ebook…</p>
      </Centered>
    );
  }

  if (state.phase === "password") {
    return (
      <Centered>
        <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 text-left shadow-xl">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
            <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Password protected</h1>
          <p className="mt-1 text-sm text-text-muted">
            Enter the password the author shared with you to read this ebook.
          </p>
          <input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Password"
            autoFocus
            className="mt-4 w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {state.error && (
            <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
              Incorrect password. Please try again.
            </p>
          )}
          <button
            onClick={handleUnlock}
            disabled={unlocking || !pwInput.trim()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {unlocking ? (
              <>
                <LoadingSpinner size="sm" /> Unlocking…
              </>
            ) : (
              "Unlock"
            )}
          </button>
        </div>
      </Centered>
    );
  }

  if (state.phase === "gone") {
    return (
      <Centered>
        <div className="max-w-sm rounded-2xl border border-card-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
            <svg className="h-6 w-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Link unavailable</h1>
          <p className="mt-1 text-sm text-text-muted">{state.message}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
          >
            Create your own ebook
          </Link>
        </div>
      </Centered>
    );
  }

  const { data, html } = state;
  const branding = (data.book.branding ?? null) as EbookBranding | null;
  const brandName = branding?.enabled ? branding.company_name : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-card-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {branding?.enabled && branding.logo_data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_data} alt="" className="h-8 w-8 rounded object-contain" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">
              {(brandName || data.title).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{data.title}</p>
            <p className="truncate text-xs text-text-muted">
              {brandName || `${data.section_count} sections`}
              {data.page_count ? ` · ${data.page_count} pages` : ""}
              {data.expires_at
                ? ` · expires ${new Date(data.expires_at).toLocaleDateString()}`
                : ""}
            </p>
          </div>
          <ThemeToggle />
          {data.has_pdf && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="hidden shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:opacity-50 sm:flex"
            >
              {downloading ? <LoadingSpinner size="sm" /> : "Download PDF"}
            </button>
          )}
        </div>
      </header>

      {/* The rendered book — identical HTML to the owner's live preview */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Full-width page that wraps and scrolls vertically on phones —
            no sideways panning. */}
        <div className="h-[calc(100vh-11rem)] overflow-hidden rounded-2xl border border-card-border bg-card p-2 sm:p-3">
          <iframe
            title={data.title}
            srcDoc={html}
            className="h-full w-full rounded-lg bg-white shadow-sm"
            style={{ overflow: "auto" }}
          />
        </div>

        {data.has_pdf && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:opacity-50 sm:w-auto sm:px-8"
            >
              {downloading ? <LoadingSpinner size="sm" /> : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l3-3m-3 3l-3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PDF
                </>
              )}
            </button>
            <p className="text-xs text-text-muted">Free download — no account needed</p>
          </div>
        )}
      </main>

      <footer className="border-t border-card-border py-4 text-center text-xs text-text-muted">
        Shared with{" "}
        <Link href="/" className="font-medium text-accent hover:underline">
          AI Ebook Generator
        </Link>{" "}
        — create your own AI-written, beautifully typeset ebooks free.
      </footer>
      <ScrollToTop />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="flex flex-col items-center text-center">{children}</div>
    </div>
  );
}
