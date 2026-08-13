"use client";

import { useState, useCallback } from "react";
import MarkdownPreview from "@/components/MarkdownPreview";
import LoadingSpinner from "@/components/LoadingSpinner";
import ThemePreview from "@/components/ThemePreview";
import { generateEbook, downloadPdf } from "@/lib/api";

const THEMES = [
  { value: "Academic Textbook", label: "Academic Textbook", icon: "📖" },
  { value: "Modern Tech Blog", label: "Modern Tech Blog", icon: "💻" },
  { value: "Dark Mode Minimalist", label: "Dark Mode Minimalist", icon: "🌑" },
];

const SAMPLE_CONTENT = `# React Hooks Deep Dive

## useState
The useState hook lets you add state to functional components.

\`\`\`jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
\`\`\`

## useEffect
The useEffect hook handles side effects in functional components.

\`\`\`jsx
useEffect(() => {
  document.title = \`Count: \${count}\`;
}, [count]);
\`\`\`

Flow of hooks in React:

\`\`\`mermaid
graph TD
    A[Component Mount] --> B{Has State?}
    B -->|Yes| C[Initialize useState]
    B -->|No| D[Skip]
    C --> E[Run useEffect]
    E --> F[Render UI]
    D --> F
\`\`\`

Please expand this into a full chapter with more hooks like useRef, useMemo, and useCallback.
`;

export default function Home() {
  const [content, setContent] = useState("");
  const [theme, setTheme] = useState("Modern Tech Blog");
  const [generatedMarkdown, setGeneratedMarkdown] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");

  const handleGenerate = useCallback(async () => {
    if (!content.trim()) return;

    setIsGenerating(true);
    setIsComplete(false);
    setError(null);
    setGeneratedMarkdown("");
    setStreamingText("");

    let fullText = "";

    await generateEbook(
      content,
      theme,
      (chunk) => {
        fullText += chunk;
        setStreamingText(fullText);
        setGeneratedMarkdown(fullText);
      },
      () => {
        setGeneratedMarkdown(fullText);
        setIsComplete(true);
        setIsGenerating(false);
      },
      (err) => {
        setError(err);
        setIsGenerating(false);
      }
    );
  }, [content, theme]);

  const handleDownload = useCallback(async () => {
    if (!generatedMarkdown) return;
    try {
      await downloadPdf(generatedMarkdown, theme);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF download failed");
    }
  }, [generatedMarkdown, theme]);

  const handleLoadSample = useCallback(() => {
    setContent(SAMPLE_CONTENT);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
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
            Transform rough coding notes into publication-ready ebooks
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Input Panel */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Input</h2>
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
                placeholder="Paste your coding concepts, code snippets, rough notes..."
                className="h-72 w-full resize-none rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 font-mono text-sm text-slate-200 placeholder-slate-500 transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />

              {/* Theme Selector */}
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-slate-400">
                  Theme Layout
                </label>
                <div className="relative">
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-3 text-sm text-white transition-colors focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {THEMES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                    <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <ThemePreview theme={theme} />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !content.trim()}
                className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-violet-500 hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {isGenerating ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Generating Ebook...
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

              {/* Download Button */}
              <button
                onClick={handleDownload}
                disabled={!isComplete}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/50 px-6 py-3 text-sm font-medium text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </button>

              {/* Error */}
              {error && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Output Panel */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Preview</h2>
                {isGenerating && (
                  <div className="flex items-center gap-2 text-sm text-blue-400">
                    <LoadingSpinner size="sm" />
                    Streaming...
                  </div>
                )}
                {isComplete && (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Complete
                  </span>
                )}
              </div>

              <div className="min-h-[400px] rounded-xl border border-slate-700/30 bg-slate-950/50 p-6">
                {isGenerating && streamingText ? (
                  <MarkdownPreview content={streamingText} />
                ) : generatedMarkdown ? (
                  <MarkdownPreview content={generatedMarkdown} />
                ) : (
                  <div className="flex h-[380px] flex-col items-center justify-center text-center">
                    <div className="mb-4 rounded-2xl bg-slate-800/50 p-4">
                      <svg className="h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500">Your ebook will appear here</p>
                    <p className="mt-1 text-xs text-slate-600">Paste your content and click Generate</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-slate-600">
          AI Ebook Generator — Built with Next.js, Python &amp; OpenAI
        </footer>
      </div>
    </div>
  );
}
