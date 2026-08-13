"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#3b82f6",
    primaryTextColor: "#f8fafc",
    primaryBorderColor: "#60a5fa",
    lineColor: "#94a3b8",
    secondaryColor: "#1e293b",
    tertiaryColor: "#0f172a",
    fontFamily: "monospace",
  },
});

interface MermaidDiagramProps {
  chart: string;
  id: string;
}

export default function MermaidDiagram({ chart, id }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const { svg: renderedSvg } = await mermaid.render(
          `mermaid-${id}`,
          chart.trim()
        );
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        <p className="font-medium">Diagram rendering error</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs opacity-75">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-6 flex justify-center overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/50 p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
