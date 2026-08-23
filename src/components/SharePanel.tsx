"use client";

import { useCallback, useEffect, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  createShareLink,
  getShareStatus,
  revokeShareLink,
  shareUrl,
  type ShareInfo,
} from "@/lib/api";

interface SharePanelProps {
  ebookId: string;
  title: string;
  /** Current custom cover artwork (if any) — snapshotted onto the share so
   * the public reader shows the same look the owner sees. */
  coverImage?: string | null;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "Never expires", value: null as number | null },
];

export default function SharePanel({ ebookId, title, coverImage, onClose }: SharePanelProps) {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [expiresDays, setExpiresDays] = useState<number | null>(7);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Status fetch kicked off directly; every setState lands in a promise
    // callback (after await points), never synchronously inside the effect.
    let cancelled = false;
    getShareStatus(ebookId)
      .then((s) => {
        if (!cancelled) setShare(s);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the share status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ebookId]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const s = await createShareLink(ebookId, {
        expiresDays,
        password: password.trim() || undefined,
        coverImage: coverImage ?? null,
      });
      setShare(s);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the link");
    } finally {
      setCreating(false);
    }
  }, [creating, ebookId, expiresDays, password, coverImage]);

  const handleRevoke = useCallback(async () => {
    if (revoking) return;
    setRevoking(true);
    setError(null);
    try {
      await revokeShareLink(ebookId);
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke the link");
    } finally {
      setRevoking(false);
    }
  }, [revoking, ebookId]);

  const handleCopy = useCallback(async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed — select the link and copy it manually.");
    }
  }, [share]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 my-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-card-border bg-card p-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground">Share this ebook</h2>
            <p className="mt-1 truncate text-sm text-text-muted">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <LoadingSpinner />
          </div>
        ) : share ? (
          /* ------------------------- active link ------------------------- */
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Public link
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={shareUrl(share.token)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm text-text-muted focus:outline-none"
                />
                <button
                  onClick={handleCopy}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                    copied
                      ? "bg-emerald-500 text-white"
                      : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-500 hover:to-violet-500"
                  }`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-text-muted">
                Anyone with this link can read the ebook — no account needed.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-card-border bg-background px-3 py-1 text-text-muted">
                {share.view_count} {share.view_count === 1 ? "view" : "views"}
              </span>
              <span className="rounded-full border border-card-border bg-background px-3 py-1 text-text-muted">
                {share.has_password ? "Password protected" : "No password"}
              </span>
              <span
                className={`rounded-full border px-3 py-1 ${
                  share.expires_at
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-card-border bg-background text-text-muted"
                }`}
              >
                {share.expires_at
                  ? `Expires ${new Date(share.expires_at).toLocaleDateString()}`
                  : "Never expires"}
              </span>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-card-border pt-4">
              <p className="text-xs text-text-muted">
                Revoking makes the link stop working immediately.
              </p>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="shrink-0 rounded-xl border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                {revoking ? <LoadingSpinner size="sm" /> : "Revoke link"}
              </button>
            </div>
          </div>
        ) : (
          /* ------------------------ create form -------------------------- */
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">
                Link expiry
              </label>
              <div className="grid grid-cols-3 gap-2">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setExpiresDays(opt.value)}
                    className={`rounded-xl border px-2 py-2.5 text-xs font-medium transition-all ${
                      expiresDays === opt.value
                        ? "border-accent/60 bg-accent/10 text-accent ring-1 ring-accent/30"
                        : "border-card-border bg-background text-text-muted hover:border-accent/30"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="share-password"
                className="mb-1.5 block text-xs font-semibold text-foreground"
              >
                Password <span className="font-normal text-text-muted">(optional)</span>
              </label>
              <input
                id="share-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty for anyone with the link"
                maxLength={100}
                className="w-full rounded-xl border border-card-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <>
                  <LoadingSpinner size="sm" /> Creating…
                </>
              ) : (
                "Create public link"
              )}
            </button>
            <p className="text-center text-xs text-text-muted">
              Readers see the full book with your branding — they can never edit it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
