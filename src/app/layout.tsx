import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/wix-madefor-text/latin-400.css";
import "@fontsource/wix-madefor-text/latin-600.css";
import "@fontsource/wix-madefor-display/latin-600.css";
import "@fontsource/wix-madefor-display/latin-700.css";
import { isTestMode } from "@/lib/ai";
import { voiceSettingsEnabled } from "@/lib/avatar";
import NavLinks from "@/components/NavLinks";
import AccountMenu from "@/components/AccountMenu";
import { authEnabled } from "@/lib/auth";
import { getCurrentUser } from "@/lib/candidate";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Interview Coach · TreTechPro.ai",
  description: "Role-specific AI mock interviews with STAR and technical coaching.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = authEnabled() ? await getCurrentUser() : null;
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
            <Link href="/" className="brand" aria-label="TreTechPro AI Interview Coach home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/tretechpro-logo.png" alt="TreTechPro AI Solutions" width={226} height={66} />
              <small>AI Interview Coach</small>
            </Link>
            <div className="header-right">
              <NavLinks />
              {authEnabled() && <AccountMenu email={user?.email ?? null} />}
            </div>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container">
            © {new Date().getFullYear()} <a href="https://www.tretechpro.ai">TreTechPro</a> · AI Interview Coach
            {voiceSettingsEnabled() && (
              <>
                {" · "}
                <Link href="/settings/interviewer">Interviewer settings</Link>
              </>
            )}
          </div>
        </footer>
      </body>
    </html>
  );
}
