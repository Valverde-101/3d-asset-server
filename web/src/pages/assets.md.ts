// Markdown twin of /assets.
import type { APIRoute } from "astro";
import { allCollections } from "@/lib/collections";
import { indexMarkdown } from "@/lib/collections-md";

export const GET: APIRoute = async () => new Response(indexMarkdown(await allCollections()), { headers: { "content-type": "text/markdown; charset=utf-8" } });
