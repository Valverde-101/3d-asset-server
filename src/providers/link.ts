import type { AssetType, License, Pricing, Provider, SearchQuery } from "../core/types.js";

export interface LinkProviderSpec {
  id: string;
  name: string;
  homepage: string;
  description: string;
  assetTypes: AssetType[];
  pricing: Pricing;
  license?: License;
  buildSearchUrl(q: SearchQuery): string;
}

/**
 * Provider for sites that block automated access (Cloudflare/bot walls) or have
 * no public API. Search returns no assets, only a deep link to the site's own
 * search so agents and users can continue there.
 */
export function linkProvider(spec: LinkProviderSpec): Provider {
  return {
    ...spec,
    access: "link",
    supportsDownload: false,
    async search(q) {
      return { assets: [], searchUrl: spec.buildSearchUrl(q) };
    },
  };
}
