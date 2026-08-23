import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeToggle from "@/components/ThemeToggle";
import { AuthProvider } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ebook Generator — Transform Notes into Publication-Ready Ebooks",
  description:
    "Transform your notes, concepts, and code snippets into beautifully structured, publication-ready ebooks using AI.",
};

// Applied before first paint so a saved dark preference never flashes light.
// Light is the default: only an explicit saved "dark" choice enables it.
const THEME_BOOTSTRAP = `
try {
  var saved = localStorage.getItem('theme');
  var dark = saved === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased light`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <div className="fixed top-4 right-4 z-50">
            <ThemeToggle />
          </div>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
