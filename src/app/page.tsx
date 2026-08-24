"use client";

import { useState, useCallback, useEffect } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import CoverGenerator from "@/components/CoverGenerator";
import DownloadProgressModal from "@/components/DownloadProgressModal";
import GenerateProgressModal from "@/components/GenerateProgressModal";
import BookEditor from "@/components/BookEditor";
import BrandingPanel, { EMPTY_BRANDING } from "@/components/BrandingPanel";
import AuthModal from "@/components/AuthModal";
import SharePanel from "@/components/SharePanel";
import LoggedinNav from "@/components/LoggedinNav";
import ScrollToTop from "@/components/ScrollToTop";
import { useAuth } from "@/lib/auth";
import {
  getTemplates,
  generateBook,
  downloadBookPdf,
  getLibrary,
  getLibraryBook,
  downloadStoredPdf,
  deleteLibraryItem,
  claimLibraryBook,
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

const GATED_PAGES = new Set([15, 20]);
const GATED_LANGUAGES = new Set<EbookLanguage>(["bn"]);

const SAMPLE_CONTENT = `# React Hooks Deep Dive

I want a full chapter on React hooks: useState, useEffect, useMemo, useCallback, useRef.
Show how state drives rendering, how effects handle side effects, and common mistakes.
Include a diagram of the component lifecycle and progressive code examples.

Tell it like a story a teacher would tell in class — one simple everyday world,
a couple of characters, and a cliffhanger at the end of every section.`;

type ModeStatus = "active" | "idle";

function ModeButton({
  icon,
  label,
  subtitle,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  status: ModeStatus;
  onClick: () => void;
}) {
  const active = status === "active";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex min-w-[220px] flex-1 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-2.5 text-left transition-all duration-200 sm:flex-none ${
        active
          ? "border-emerald-400/50 bg-gradient-to-r from-emerald-500/10 via-teal-500/[0.07] to-transparent shadow-[0_10px_28px_-14px_rgba(16,185,129,0.6)]"
          : "border-card-border bg-background hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/[0.04] hover:shadow-[0_12px_32px_-16px_rgba(99,102,241,0.5)]"
      }`}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors ${
          active
            ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-inner"
            : "bg-accent/10 text-accent group-hover:from-accent group-hover:to-violet-500 group-hover:text-white"
        }`}
      >
        {icon}
      </span>

      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold tracking-tight ${
              active ? "text-emerald-500 dark:text-emerald-400" : "text-foreground"
            }`}
          >
            {label}
          </span>
          {active && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-500 dark:text-emerald-400">
              <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
              Active
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-muted">
          {subtitle}
        </span>
      </span>

      {!active && (
        <svg
          className="ml-1 hidden h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent sm:block"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}

function Navbar({ onAuthClick }: { onAuthClick: () => void }) {
  const { user, loading: authLoading, logout } = useAuth();

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-card-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
              <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477 4.5 1.253" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">
              Ebook<span className="text-indigo-500">Gen</span>
            </span>
          </div>

          <div className="hidden items-center gap-6 md:flex">
            <a href="#generator" className="text-sm font-medium text-text-muted transition-colors hover:text-foreground">
              Quick Start
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-text-muted transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#features" className="text-sm font-medium text-text-muted transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#templates" className="text-sm font-medium text-text-muted transition-colors hover:text-foreground">
              Templates
            </a>
          </div>

          <div className="flex items-center gap-3">
            {!authLoading && (
              <>
                {user ? (
                  <div className="flex items-center gap-3">
                    <div className="hidden items-center gap-2 rounded-full border border-card-border bg-card px-3 py-1.5 text-xs sm:flex">
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
                    <button
                      onClick={logout}
                      className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent sm:hidden"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={onAuthClick}
                    className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/40"
                  >
                    Get Started
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] rounded-full bg-gradient-to-br from-indigo-500/20 via-violet-500/10 to-blue-500/5 blur-3xl" />
        <div className="absolute left-1/4 top-1/3 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-blue-500/10 to-cyan-500/5 blur-3xl" />
        <div className="absolute right-1/4 bottom-0 w-[300px] h-[300px] rounded-full bg-gradient-to-tl from-violet-500/10 to-indigo-500/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
            </span>
            Powered by Google Gemini
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Transform rough notes into{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
              stories people remember
            </span>
          </h1>

          <p className="mt-6 text-lg leading-8 text-text-muted sm:text-xl sm:leading-8 max-w-2xl mx-auto">
            Turn your notes, concepts, and code snippets into beautifully structured, 
            publication-ready ebooks with AI — complete with live preview, professional covers, 
            and print-ready PDFs.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#generator"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/40 hover:-translate-y-0.5"
            >
              Start Generating
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-xl border border-card-border bg-card px-8 py-3.5 text-base font-semibold text-foreground transition-all hover:border-accent/40 hover:bg-accent/5 hover:-translate-y-0.5"
            >
              See how it works
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-text-muted">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Story-first AI
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Print-ready PDFs
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              8 Cover styles
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Bengali translation
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsBar() {
  const stats = [
    { value: "5+", label: "Story structures" },
    { value: "8", label: "Cover templates" },
    { value: "4", label: "Design themes" },
    { value: "100%", label: "Print-ready" },
  ];

  return (
    <section className="border-y border-card-border bg-card/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-foreground sm:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-text-muted">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Write your notes",
      desc: "Paste rough notes, topics, or code snippets. Our AI understands context and structure automatically.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
    },
    {
      num: "02",
      title: "AI crafts your story",
      desc: "Google Gemini turns your notes into a story-driven ebook with named characters, cliffhangers, and a moral.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.002 4.002 0 00-3.09-3.09L2.25 12l2.846-.813a4.002 4.002 0 003.09-3.09L9 5.25l.813 2.846a4.002 4.002 0 003.09 3.09L15.75 12l-2.846.813a4.002 4.002 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.671-2.671L14.25 6.75l1.035-.259a3.375 3.375 0 002.671-2.671L18 3.75l.259 1.035a3.375 3.375 0 002.671 2.671L21.75 6.75l-1.035.259a3.375 3.375 0 00-2.671 2.671zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      ),
    },
    {
      num: "03",
      title: "Design & download",
      desc: "Pick a template, customize the cover and branding, then download a print-ready PDF instantly.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      ),
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            From notes to ebook in three steps
          </h2>
          <p className="mt-4 text-lg text-text-muted">
            No design skills needed. Just write, generate, and ship.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.num}
              className="group relative rounded-2xl border border-card-border bg-card p-8 transition-all hover:border-indigo-500/30 hover:shadow-[0_20px_50px_-20px_rgba(79,70,229,0.3)]"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
                {step.icon}
              </div>
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-500 mb-2">
                Step {step.num}
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm leading-relaxed text-text-muted">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesBento() {
  const features = [
    {
      title: "Story-first AI",
      desc: "One mental model, named characters, cliffhangers — ebooks that read like bedtime stories, not manuals.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A9 9 0 106 3.75c1.052 0 2.062.18 3 .512m14.25 0a8.966 8.966 0 00-3-.512 9 9 0 00-9 9c0 1.553.388 3.05 1.112 4.384" />
        </svg>
      ),
      span: "",
      color: "from-indigo-500/10 to-blue-500/5",
      iconColor: "text-indigo-500",
    },
    {
      title: "Live preview",
      desc: "See your ebook rendered with full styling before downloading. WYSIWYG confidence.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      span: "",
      color: "from-violet-500/10 to-purple-500/5",
      iconColor: "text-violet-500",
    },
    {
      title: "Business branding",
      desc: "White-label ebooks with your logo, colors, and company info on every page.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75" />
        </svg>
      ),
      span: "",
      color: "from-emerald-500/10 to-teal-500/5",
      iconColor: "text-emerald-500",
    },
    {
      title: "Bengali translation",
      desc: "One-click full-book translation preserving all structure. AI editing works in Bengali too.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 9.583 12.75 9 15m2.042-2.042a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M15 21l-1.5-6m-6 6l1.5-6" />
        </svg>
      ),
      span: "",
      color: "from-amber-500/10 to-orange-500/5",
      iconColor: "text-amber-500",
    },
    {
      title: "Shareable links",
      desc: "Publish read-only public links with optional password protection and expiry.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100-2.186m0 2.186m0-2.186l9.566-5.314m-9.566 9.566l5.314 9.566m0-9.566l-5.314 9.566" />
        </svg>
      ),
      span: "",
      color: "from-pink-500/10 to-rose-500/5",
      iconColor: "text-pink-500",
    },
  ];

  return (
    <section id="features" className="border-t border-card-border bg-card/30 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything you need to publish
          </h2>
          <p className="mt-4 text-lg text-text-muted">
            Professional ebook production, powered by AI, accessible to everyone.
          </p>
        </div>

        <div className="mx-auto max-w-5xl grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`group relative overflow-hidden rounded-2xl border border-card-border bg-background p-6 transition-all duration-200 hover:border-indigo-500/20 hover:shadow-[0_20px_50px_-20px_rgba(79,70,229,0.2)] hover:scale-[1.02] ${feature.span}`}
            >
              <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${feature.color} opacity-0 transition-opacity group-hover:opacity-100`} />
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${feature.color} ${feature.iconColor}`}>
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1.5">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-text-muted">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TemplatesSection({ templates }: { templates: TemplateInfo[] }) {
  return (
    <section id="templates" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Beautiful templates, zero design work
          </h2>
          <p className="mt-4 text-lg text-text-muted">
            Four professionally crafted themes, each with WCAG-verified contrast and print-ready layouts.
          </p>
        </div>

        <div className="mx-auto max-w-4xl grid grid-cols-2 gap-4 sm:gap-6">
          {templates.map((t) => (
            <div
              key={t.id}
              className="group rounded-2xl border border-card-border bg-card p-4 sm:p-5 transition-all duration-200 hover:border-indigo-500/20 hover:shadow-[0_20px_50px_-20px_rgba(79,70,229,0.2)] hover:scale-[1.02]"
            >
              <div
                className="mb-3 h-20 sm:h-28 overflow-hidden rounded-xl border border-card-border"
                style={{
                  background: t.palette.page_bg,
                  borderTop: `4px solid ${t.palette.accent}`,
                }}
              >
                <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                  <div
                    className="h-2 w-12 rounded sm:h-2.5 sm:w-20"
                    style={{ background: t.palette.accent }}
                  />
                  <div
                    className="mt-1.5 h-1.5 w-20 rounded sm:mt-2 sm:h-2 sm:w-32"
                    style={{ background: t.palette.heading, opacity: 0.85 }}
                  />
                  <div
                    className="mt-1 h-1 w-16 rounded sm:mt-1.5 sm:h-1.5 sm:w-28"
                    style={{ background: t.palette.text, opacity: 0.5 }}
                  />
                </div>
              </div>
              <h3 className="text-sm font-semibold text-foreground sm:text-base">{t.label}</h3>
              <p className="mt-1 text-xs text-text-muted sm:text-sm">{t.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection({ onAuthClick }: { onAuthClick: () => void }) {
  return (
    <section className="relative overflow-hidden border-t border-card-border">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-blue-500/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Ready to write your first ebook?
          </h2>
          <p className="mt-6 text-lg text-text-muted">
            Join writers, educators, and developers who are turning their knowledge into 
            beautifully crafted ebooks in minutes, not months.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#generator"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/40 hover:-translate-y-0.5"
            >
              Start Generating Free
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <button
              onClick={onAuthClick}
              className="inline-flex items-center gap-2 rounded-xl border border-card-border bg-card px-8 py-3.5 text-base font-semibold text-foreground transition-all hover:border-accent/40 hover:bg-accent/5 hover:-translate-y-0.5"
            >
              Sign in to save library
            </button>
          </div>
          <p className="mt-4 text-xs text-text-muted">
            No credit card required. Generate up to 5 ebooks free.
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-card-border bg-card/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477 4.5 1.253" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">
              Ebook<span className="text-indigo-500">Gen</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-text-muted">
            <a href="mailto:shahmarufsiraj@gmail.com" className="transition-colors hover:text-accent">
              Contact
            </a>
            <a href="https://www.linkedin.com/in/shahmarufsiraj360/" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
              LinkedIn
            </a>
            <a href="https://www.facebook.com/shahmarufsirajdeveloper" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent">
              Facebook
            </a>
          </div>

          <p className="text-xs text-text-muted">
            Built with Next.js + Google Gemini
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState("");

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [content, setContent] = useState("");
  const [templateId, setTemplateId] = useState("minimal-light");
  const [targetPages, setTargetPages] = useState(10);

  const [book, setBook] = useState<Book | null>(null);
  const [ebookId, setEbookId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

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
  const [selectedCover, setSelectedCover] = useState<string | null>(null);
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string } | null>(null);

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

  const STUDIO_KEY = "ebook-studio-v1";

  useEffect(() => {
    try {
      localStorage.removeItem(STUDIO_KEY);
    } catch {
      /* storage unavailable; nothing to clean */
    }
  }, []);

  useEffect(() => {
    if (!user || !ebookId) return;
    claimLibraryBook(ebookId).catch(() => {});
  }, [user, ebookId]);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const brandingActive = !!book?.branding?.enabled;
  const coverActive = !!selectedCover;
  const canDownload = brandingActive || coverActive;

  const friendlyError = (e: unknown, fallback: string): string => {
    const msg = e instanceof Error ? e.message : fallback;
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
    if (!canDownload) {
      setError(
        "Pick a custom cover or turn on business branding before downloading — one of them is required."
      );
      return;
    }
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
  }, [book, language, ebookId, selectedCover, refreshLibrary, canDownload]);

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
        setSelectedCover(null);
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

  const handleAuthClick = useCallback(() => {
    setAuthModalMessage("");
    setAuthModalOpen(true);
  }, []);

  const step = book ? 3 : 2;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {user ? <LoggedinNav /> : <Navbar onAuthClick={handleAuthClick} />}

      {!user && (
        <>
          <HeroSection />
          <StatsBar />
        </>
      )}

      {/* Generator Section */}
      <section id="generator" className="border-t border-card-border bg-card/30 py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {!book ? (
            <>
              <div className="mx-auto max-w-2xl text-center mb-10">
                <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Create your ebook
                </h2>
                <p className="mt-4 text-lg text-text-muted">
                  Write your topic, pick a design, and let AI do the rest.
                </p>
              </div>

              {/* Stepper */}
              <div className="mb-8 flex items-center justify-center gap-2 text-sm">
                {["Design", "Length", "Download"].map((label, i) => (
                  <div key={label} className="flex items-center gap-2">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                        step > i
                          ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
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

              <div className="grid gap-8 lg:grid-cols-2">
                <div className="space-y-6">
                  <div className="rounded-2xl border border-card-border bg-background p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-foreground">Your Topic</h2>
                      <button
                        onClick={handleLoadSample}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-indigo-500/10 hover:text-indigo-400"
                      >
                        Load Sample
                      </button>
                    </div>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Describe your topic, paste notes, or share code snippets — we'll turn them into a polished ebook."
                      className="h-72 w-full resize-none rounded-xl border border-card-border bg-background p-4 font-mono text-sm text-foreground placeholder-text-muted transition-colors focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div className="rounded-2xl border border-card-border bg-background p-6 shadow-sm">
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
                                ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-400"
                                : isLocked
                                  ? "cursor-not-allowed border-card-border/50 bg-background/50 text-text-muted/50"
                                  : "border-card-border bg-background text-text-muted hover:border-indigo-500/30 hover:text-foreground"
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

                  <div className="rounded-2xl border border-card-border bg-background p-6 shadow-sm">
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
                                ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-400"
                                : isLocked
                                  ? "cursor-not-allowed border-card-border/50 bg-background/50 text-text-muted/50"
                                  : "border-card-border bg-background text-text-muted hover:border-indigo-500/30 hover:text-foreground"
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

                <div className="rounded-2xl border border-card-border bg-background p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold text-foreground">
                    Choose a Design
                  </h2>
                  {templates.length === 0 ? (
                    <div className="flex items-center gap-3 text-sm text-text-muted">
                      <LoadingSpinner size="sm" /> Loading templates...
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTemplateId(t.id)}
                          className={`group rounded-xl border p-3 text-left transition-all duration-200 sm:p-4 ${
                            templateId === t.id
                              ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                              : "border-card-border bg-background hover:border-indigo-500/30 hover:bg-indigo-500/5 hover:scale-[1.02] hover:shadow-lg"
                          }`}
                        >
                          <div className="mb-2 h-10 overflow-hidden rounded-lg border border-card-border sm:mb-3 sm:h-14"
                            style={{
                              background: t.palette.page_bg,
                              borderTop: `6px solid ${t.palette.accent}`,
                            }}
                          >
                            <div className="px-2 py-1.5">
                              <div
                                className="h-1.5 w-10 rounded sm:h-2 sm:w-16"
                                style={{ background: t.palette.accent }}
                              />
                              <div
                                className="mt-1 h-1 w-14 rounded sm:mt-1.5 sm:h-1.5 sm:w-24"
                                style={{ background: t.palette.heading, opacity: 0.85 }}
                              />
                              <div
                                className="mt-0.5 h-1 w-12 rounded sm:mt-1 sm:h-1.5 sm:w-20"
                                style={{ background: t.palette.text, opacity: 0.5 }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] font-medium leading-tight text-foreground sm:text-sm">
                              {t.label}
                            </span>
                          </div>
                          <p className="mt-1 hidden text-xs leading-relaxed text-text-muted sm:block">
                            {t.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || !content.trim() || templates.length === 0}
                    className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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
            </>
          ) : (
            <>
              {/* Step 3: Preview + download */}
              <div className="space-y-6">
                {canDownload ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs leading-relaxed text-text-muted sm:text-sm">
                      Your PDF is ready to download{coverActive && brandingActive
                        ? " with your custom cover and branding baked in"
                        : coverActive
                          ? " with your custom cover on the front"
                          : " with your business branding applied"}
                      . Tap <span className="font-semibold text-foreground">Download PDF</span> in the panel below.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 002 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        One step left before you can download
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted sm:text-sm">
                        Every ebook needs a finishing touch. Choose{" "}
                        <span className="font-semibold text-foreground">Custom Cover</span> to design
                        your own front page, or{" "}
                        <span className="font-semibold text-foreground">Business Branding</span> to add
                        your logo &amp; colors — or both. The{" "}
                        <span className="font-semibold text-foreground">Download PDF</span> button
                        unlocks as soon as one is active.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-card-border bg-background p-5 shadow-sm">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-foreground">{book.title}</h2>
                    <p className="mt-0.5 text-sm text-text-muted">
                      {book.sections.length} sections · {selectedTemplate?.label ?? book.template_id}
                      {pageCount !== null && (
                        <span className="ml-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-400">
                          {pageCount} pages (target {book.target_pages})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
                    <button
                      onClick={() => {
                        setBook(null);
                        setEbookId(null);
                        setPageCount(null);
                        setSelectedCover(null);
                        setError(null);
                        refreshLibrary();
                      }}
                      className="rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-indigo-500/40 hover:text-indigo-400"
                    >
                      Start Over
                    </button>

                    <div className="flex items-center gap-1">
                      <ModeButton
                        icon={
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z" />
                          </svg>
                        }
                        label={coverActive ? "Change Cover" : "Custom Cover"}
                        subtitle={
                          coverActive
                            ? brandingActive
                              ? "Active · combined with branding"
                              : "Active · tap to swap the artwork"
                            : "Design your own PDF cover"
                        }
                        status={coverActive ? "active" : "idle"}
                        onClick={() => setShowCoverModal(true)}
                      />
                      {coverActive && (
                        <button
                          type="button"
                          onClick={() => setSelectedCover(null)}
                          aria-label="Remove custom cover"
                          title="Remove your custom cover"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-card-border text-text-muted transition-colors hover:border-red-400/60 hover:text-red-500"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <ModeButton
                      icon={
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      }
                      label="Business Branding"
                      subtitle={
                        brandingActive
                          ? coverActive
                            ? "Active · combined with custom cover"
                            : "Active · white-label edition"
                          : "White-label it with your logo & colors"
                      }
                      status={brandingActive ? "active" : "idle"}
                      onClick={() => setShowBrandingModal(true)}
                    />

                    <button
                      onClick={handleDownload}
                      disabled={isDownloading || !canDownload}
                      title={
                        canDownload
                          ? undefined
                          : "Pick a cover or add branding to unlock your download"
                      }
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:from-indigo-600 disabled:hover:to-violet-600 disabled:shadow-none"
                    >
                      {isDownloading ? (
                        <>
                          <LoadingSpinner size="sm" /> Compiling PDF…
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l3-3m-3 3l-3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Download PDF
                        </>
                      )}
                    </button>

                     {ebookId && user && (
                      <button
                        onClick={() => setShareTarget({ id: ebookId, title: book.title })}
                        title="Create a public read-only link"
                        className="flex items-center gap-2 rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-indigo-500/40 hover:text-indigo-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share
                      </button>
                    )}
                  </div>
                </div>

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
            </>
          )}
        </div>
      </section>

      {!book && !user && (
        <>
          <HowItWorks />

          <FeaturesBento />

          {templates.length > 0 && (
            <TemplatesSection templates={templates} />
          )}

          <CtaSection onAuthClick={handleAuthClick} />
        </>
      )}

      {/* Library — recent ebooks kept in Neon Postgres */}
      {!book && !user && !authLoading && (
        <section className="border-t border-card-border bg-card/30 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-md rounded-2xl border border-card-border bg-background p-8 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10">
                <svg className="h-7 w-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477 4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground">Your Library</h3>
              <p className="mt-2 text-sm text-text-muted">
                Sign in to save your generated ebooks and access them anytime from any device.
              </p>
              <button
                onClick={() => {
                  setAuthModalMessage("Sign in to save and access your ebook library.");
                  setAuthModalOpen(true);
                }}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500"
              >
                Sign in to get started
              </button>
            </div>
          </div>
        </section>
      )}

      {!book && user && (
        <section id="library" className="border-t border-card-border bg-card/30 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl rounded-2xl border border-card-border bg-background p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Your Library
                  </h2>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {library.length > 0
                      ? "Your saved ebooks — open the preview or download the PDF anytime"
                      : "No ebooks yet. Create your first ebook above!"}
                  </p>
                </div>
                <button
                  onClick={refreshLibrary}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-indigo-500/10 hover:text-indigo-400"
                >
                  Refresh
                </button>
              </div>

              {library.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-card-border bg-background">
                    <svg className="h-6 w-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <p className="text-sm text-text-muted">Your library is empty</p>
                  <a
                    href="#generator"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:from-indigo-500 hover:to-violet-500"
                  >
                    Create your first ebook
                  </a>
                </div>
              ) : (
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
                            <span className="ml-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-400">
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
                          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-indigo-500/40 hover:text-indigo-400 disabled:opacity-50 sm:py-1.5"
                        >
                          Open
                        </button>
                        {item.has_pdf && (
                          <button
                            onClick={() => handleStoredPdf(item)}
                            disabled={busyItemId === item.id}
                            className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-indigo-500/40 hover:text-indigo-400 disabled:opacity-50 sm:py-1.5"
                          >
                            PDF
                          </button>
                        )}
                        <button
                          onClick={() => setShareTarget({ id: item.id, title: item.title })}
                          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-indigo-500/40 hover:text-indigo-400 sm:py-1.5"
                        >
                          Share
                        </button>
                        <button
                          onClick={() => handleDeleteLibraryItem(item)}
                          disabled={busyItemId === item.id}
                          className="rounded-lg px-2 py-2 text-xs font-medium text-text-muted transition-colors hover:text-red-400 disabled:opacity-50 sm:py-1.5"
                          aria-label={`Delete ${item.title}`}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Guidelines — quick reference for logged-in users */}
      {!book && user && (
        <section id="guidelines" className="border-t border-card-border bg-card/30 py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Quick Guide
              </h2>
              <p className="mt-2 text-sm text-text-muted">
                Everything you need to create your first ebook in minutes.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {[
                  {
                    step: "1",
                    title: "Write your topic",
                    desc: "Describe what your ebook should be about. Paste notes, code snippets, or just a topic idea.",
                    color: "from-indigo-500 to-blue-500",
                  },
                  {
                    step: "2",
                    title: "Pick a design",
                    desc: "Choose from 4 professional templates — Minimal, Compact, Magazine, or Technical.",
                    color: "from-violet-500 to-purple-500",
                  },
                  {
                    step: "3",
                    title: "Generate & preview",
                    desc: "Click Generate and watch AI craft your ebook. Preview it live before downloading.",
                    color: "from-emerald-500 to-teal-500",
                  },
                  {
                    step: "4",
                    title: "Download or share",
                    desc: "Add a custom cover or branding, then download as PDF or create a shareable link.",
                    color: "from-amber-500 to-orange-500",
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="rounded-2xl border border-card-border bg-background p-5 transition-all hover:border-indigo-500/20 hover:shadow-[0_8px_30px_-12px_rgba(79,70,229,0.2)]"
                  >
                    <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${item.color} text-xs font-bold text-white`}>
                      {item.step}
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 rounded-2xl border border-card-border bg-background p-5">
                <h3 className="text-sm font-semibold text-foreground">Pro Tips</h3>
                <ul className="mt-3 space-y-2 text-xs text-text-muted">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    Use the Book Studio to edit individual sections — expand, simplify, add diagrams, or regenerate.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                    Add Business Branding to white-label your ebook with your logo and colors.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    Share links are read-only — recipients see the full book but can never edit it.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    Bengali translation preserves all structure — code blocks stay in English.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      <Footer />

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
      {shareTarget && (
        <SharePanel
          ebookId={shareTarget.id}
          title={shareTarget.title}
          coverImage={selectedCover}
          onClose={() => setShareTarget(null)}
        />
      )}
      <ScrollToTop />
    </div>
  );
}
