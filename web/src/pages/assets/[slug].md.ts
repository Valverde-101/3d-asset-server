// Markdown twins: /assets/<hub>.md and /assets/<slug>.md
import type { APIRoute } from "astro";
import { HUBS, allCollections, collectionsInHub, relatedTo, type Collection, type Hub } from "@/lib/collections";
import { collectionMarkdown, hubMarkdown } from "@/lib/collections-md";

export async function getStaticPaths() {
  const all = await allCollections();
  return [...HUBS.map((hub) => ({ params: { slug: hub.id }, props: { hub } })), ...all.map((collection) => ({ params: { slug: collection.slug }, props: { collection } }))];
}

export const GET: APIRoute = async ({ props }) => {
  const { hub, collection } = props as { hub?: Hub; collection?: Collection };
  const body = hub ? hubMarkdown(hub, await collectionsInHub(hub)) : collectionMarkdown(collection!, await relatedTo(collection!));
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
