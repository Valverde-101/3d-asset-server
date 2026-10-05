/**
 * Minimal Accept-header negotiation between HTML and Markdown.
 *
 * Markdown wins only when the client lists `text/markdown` with a quality at
 * least as high as the best HTML match (`text/html`, `text/*` or a wildcard),
 * so browsers (which never list text/markdown) always get HTML and agents
 * sending `Accept: text/markdown` (or `text/markdown, text/html;q=0.9`) get
 * Markdown.
 */

function quality(accept: string, types: string[]): number {
  let best = -1;
  for (const part of accept.split(",")) {
    const [rawType, ...params] = part.trim().split(";");
    const type = rawType?.trim().toLowerCase();
    if (!type || !types.includes(type)) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split("=");
      if (k?.trim() === "q" && v !== undefined) q = Number.parseFloat(v) || 0;
    }
    best = Math.max(best, q);
  }
  return best;
}

export function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  const md = quality(accept, ["text/markdown", "text/x-markdown"]);
  if (md <= 0) return false;
  return md >= quality(accept, ["text/html", "text/*", "*/*"]);
}
