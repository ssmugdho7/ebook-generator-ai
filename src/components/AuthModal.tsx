"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export default function AuthModal({ isOpen, onClose, message }: AuthModalProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Reset & focus when opened — defer via rAF to satisfy lint
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      setError(null);
      setEmail("");
      setPassword("");
      setMode("login");
      emailRef.current?.focus();
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        if (mode === "login") {
          await login(email, password);
        } else {
          await register(email, password);
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSubmitting(false);
      }
    },
    [mode, email, password, login, register, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <h3 className="text-lg font-semibold text-foreground">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:bg-accent/10 hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {message && (
            <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {message}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                ref={emailRef}
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-text-muted transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                className="w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-text-muted transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : mode === "login" ? (
                "Sign in"
              ) : (
                "Create account"
              )}
            </button>
          </form>
        </div>

        <div className="border-t border-card-border px-6 py-4 text-center text-sm text-text-muted">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("register"); setError(null); }}
                className="font-medium text-accent transition-colors hover:text-accent/80"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); }}
                className="font-medium text-accent transition-colors hover:text-accent/80"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
