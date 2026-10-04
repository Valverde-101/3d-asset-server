import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "../src/core/http.js";
import type { HttpClient, ProviderContext } from "../src/core/types.js";

export const FIXTURES = join(import.meta.dirname, "fixtures");

export function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), "utf8");
}

type Route = [match: string | RegExp, fixturePath: string];

/**
 * Offline HttpClient: each request URL is matched (substring or regex) against
 * `routes` in order and answered with the fixture file's content. Unmatched
 * URLs throw a 404 HttpError so tests notice unexpected requests.
 */
export function fixtureHttp(routes: Route[]): HttpClient & { requests: string[] } {
  const requests: string[] = [];
  const lookup = (url: string): string => {
    requests.push(url);
    for (const [m, file] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) return fixture(file);
    }
    throw new HttpError(404, url, `No fixture route for ${url}`);
  };
  return {
    requests,
    async text(url) {
      return lookup(url);
    },
    async json<T>(url: string) {
      return JSON.parse(lookup(url)) as T;
    },
    async raw(url) {
      return new Response(lookup(url));
    },
  };
}

export function fixtureCtx(routes: Route[]): ProviderContext & { fetch: ReturnType<typeof fixtureHttp> } {
  return { fetch: fixtureHttp(routes) };
}
