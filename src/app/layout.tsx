import type { Metadata } from "next";
import Link from "next/link";
import { isTestMode } from "@/lib/ai";
import { voiceSettingsEnabled } from "@/lib/avatar";
import "./globals.css";

export const metadata: Metadata = {
  title: "STAR Interview Coach 3.0 · TreTechPro.ai",
  description: "Role-specific AI mock interviews with STAR and technical coaching.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {isTestMode() && (
          <div className="test-banner" role="status">
            Test mode: scores come from an offline heuristic, not the AI coach. Do not use for real feedback.
          </div>
        )}
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              TreTechPro.ai <small>STAR Interview Coach 3.0</small>
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Dashboard</Link>
              <Link href="/interview/new">New interview</Link>
            </nav>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        {voiceSettingsEnabled() && (
          <footer className="site-footer">
            <div className="container">
              <Link href="/settings/interviewer">Interviewer settings</Link>
            </div>
          </footer>
        )}
      </body>
    </html>
  );
}
