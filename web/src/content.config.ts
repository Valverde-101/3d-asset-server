/**
 * Content collections. `collections` are the curated asset pages under
 * /assets/<slug>: editorial copy and a saved search, one Markdown file each.
 * Their results come from web/src/data/collections/<slug>.json, refreshed by
 * scripts/snapshot-collections.mjs. scripts/lib/topics.mjs checks the same
 * files against the editorial rules (lengths, related pages, FAQ).
 */
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const ASSET_TYPES = ["model", "material", "texture", "hdri", "sprite", "ui", "audio", "font", "pack", "other"] as const;

const assetCollections = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/collections" }),
  schema: z.object({
    title: z.string().min(10).max(60),
    description: z.string().min(110).max(160),
    hub: z.string(),
    search: z.object({
      q: z.string().min(2).max(60),
      types: z.array(z.enum(ASSET_TYPES)).min(1).optional(),
      free: z.boolean().optional(),
      downloadable: z.boolean().optional(),
      providers: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    }),
    aliases: z.array(z.string()).optional(),
    related: z.array(z.string()).min(2).max(6),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).min(2).max(5),
    addedAt: z.coerce.date(),
    addedBy: z.enum(["human", "agent"]),
  }),
});

export const collections = { collections: assetCollections };
