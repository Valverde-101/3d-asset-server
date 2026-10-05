// Export the provider registry from the compiled server (dist/) so the
// website lists exactly the sources the server searches. Run after `tsc`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { allProviders } = await import("../dist/providers/index.js");
const { openApiSpec } = await import("../dist/api/openapi.js");

const providers = allProviders.map((p) => ({
  id: p.id,
  name: p.name,
  homepage: p.homepage,
  description: p.description,
  assetTypes: p.assetTypes,
  access: p.access,
  pricing: p.pricing,
  license: p.license?.name ?? null,
  supportsDownload: p.supportsDownload,
}));

mkdirSync("web/src/data", { recursive: true });
writeFileSync("web/src/data/providers.json", JSON.stringify(providers, null, 2) + "\n");
console.log(`exported ${providers.length} providers to web/src/data/providers.json`);

// Integration history (integrations/registry.json, kept up to date by the
// daily discovery workflow) for the "Recently added" list on /stats.
const registry = JSON.parse(readFileSync("integrations/registry.json", "utf8"));
const live = new Set(providers.map((p) => p.id));
const integrations = registry.integrated
  .filter((i) => live.has(i.id))
  .map(({ id, name, homepage, addedAt, addedBy }) => ({ id, name, homepage, addedAt, addedBy }))
  .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
writeFileSync("web/src/data/integrations.json", JSON.stringify({ integrations, rejected: registry.rejected.length }, null, 2) + "\n");
console.log(`exported ${integrations.length} integrations to web/src/data/integrations.json`);

// The OpenAPI document the server serves at /openapi.json, for the
// server-rendered API reference page.
writeFileSync("web/src/data/openapi.json", JSON.stringify(openApiSpec(process.env.SITE_URL ?? "https://3d.shep.bot"), null, 2) + "\n");
console.log("exported OpenAPI spec to web/src/data/openapi.json");
