/** Minimal, escape-first markdown for AI answer outlines: bullets, **bold**, paragraphs. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]/g, '<span class="placeholder">[$1]</span>');
}

export function outlineToHtml(md: string): string {
  const out: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (list) out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      (list ??= []).push(inline(bullet[1]));
    } else if (line) {
      flush();
      out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
    } else {
      flush();
    }
  }
  flush();
  return out.join("");
}
