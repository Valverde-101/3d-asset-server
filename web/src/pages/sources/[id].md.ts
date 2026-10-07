// Markdown twins: /sources/<id>.md
import type { APIRoute } from "astro";
import { sourcePages, type SourcePage } from "@/lib/collections";
import { sourceMarkdown } from "@/lib/collections-md";

export async function getStaticPaths() {
  return (await sourcePages()).map((page) => ({ params: { id: page.provider.id }, props: { page } }));
}

export const GET: APIRoute = ({ props }) => new Response(sourceMarkdown((props as { page: SourcePage }).page), { headers: { "content-type": "text/markdown; charset=utf-8" } });
