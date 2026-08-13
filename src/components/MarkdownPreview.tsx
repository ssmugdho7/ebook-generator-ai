"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import MermaidDiagram from "./MermaidDiagram";

interface MarkdownPreviewProps {
  content: string;
}

function extractMermaidBlocks(content: string): Array<{ type: "text" | "mermaid"; value: string }> {
  const parts: Array<{ type: "text" | "mermaid"; value: string }> = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "mermaid", value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return parts;
}

let mermaidCounter = 0;

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const parts = extractMermaidBlocks(content);

  return (
    <div className="prose prose-invert prose-slate max-w-none">
      {parts.map((part, i) => {
        if (part.type === "mermaid") {
          return <MermaidDiagram key={`mermaid-${i}`} chart={part.value} id={`md-${i}-${++mermaidCounter}`} />;
        }
        return (
          <ReactMarkdown
            key={`text-${i}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              pre: ({ children }) => {
                return (
                  <div className="group relative my-4 overflow-hidden rounded-lg border border-slate-700/50 bg-[#0d1117]">
                    {children}
                  </div>
                );
              },
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || "");
                const lang = match ? match[1] : "";
                const isBlock = className?.includes("language-");

                if (isBlock) {
                  return (
                    <>
                      {lang && (
                        <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-800/50 px-4 py-2">
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{lang}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}
                            className="rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                          >
                            Copy
                          </button>
                        </div>
                      )}
                      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    </>
                  );
                }

                return (
                  <code
                    className="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-slate-200"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              h1: ({ children }) => (
                <h1 className="mb-4 mt-8 border-b border-slate-700/50 pb-4 text-3xl font-bold text-white">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-8 text-2xl font-semibold text-white">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-2 mt-6 text-xl font-medium text-slate-200">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="mb-4 leading-relaxed text-slate-300">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="mb-4 ml-6 list-disc space-y-1 text-slate-300">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-4 ml-6 list-decimal space-y-1 text-slate-300">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-4 border-blue-500 bg-blue-500/10 py-2 pl-4 text-slate-300 italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="my-4 overflow-x-auto rounded-lg border border-slate-700/50">
                  <table className="w-full text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-slate-700/50 bg-slate-800/50 px-4 py-2 text-left font-medium text-slate-200">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b border-slate-700/30 px-4 py-2 text-slate-300">{children}</td>
              ),
              a: ({ children, href }) => (
                <a href={href} className="text-blue-400 underline decoration-blue-400/30 transition-colors hover:text-blue-300" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              hr: () => <hr className="my-8 border-slate-700/50" />,
              strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
              em: ({ children }) => <em className="text-slate-200">{children}</em>,
            }}
          >
            {part.value}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
