"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Boxed nav tabs styled like tretechpro.ai; the current section is shown in black. */
export default function NavLinks() {
  const path = usePathname();
  const items = [
    { href: "/", label: "Dashboard", active: path === "/" || /\/results$|\/retry\//.test(path) },
    { href: "/interview/new", label: "New Interview", active: path.startsWith("/interview/") && !/\/results$|\/retry\//.test(path) },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={i.active ? "active" : undefined} aria-current={i.active ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
      <a href="https://www.tretechpro.ai">TreTechPro.ai</a>
    </nav>
  );
}
