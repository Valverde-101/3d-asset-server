/** Helpers for rendering the OpenAPI document (src/data/openapi.json) as static HTML. */
import spec from "@/data/openapi.json";

type Json = Record<string, unknown>;
export interface Param { name: string; in: string; required?: boolean; description?: string; schema?: Json; example?: unknown }
export interface Operation {
  method: string;
  path: string;
  id: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters: Param[];
  requestExample?: unknown;
  responses: { status: string; description: string; schema?: string; headers: string[] }[];
}

export const SPEC = spec as unknown as {
  info: { title: string; version: string; summary?: string; description: string };
  servers: { url: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Json>>;
  components: { schemas: Record<string, Json>; headers: Record<string, Json>; responses: Record<string, Json> };
};

const refName = (ref: string) => ref.split("/").pop() ?? ref;

export function resolve<T = Json>(node: unknown): T {
  let n = node as Json;
  for (let i = 0; i < 5 && n && typeof n.$ref === "string"; i++) {
    const [, , kind, name] = (n.$ref as string).split("/");
    n = (SPEC.components as unknown as Record<string, Record<string, Json>>)[kind!]![name!]!;
  }
  return n as T;
}

/** Short human type label: `string`, `integer`, `Asset[]`, `AssetType`, … */
export function typeLabel(schema?: Json): string {
  if (!schema) return "";
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  if (schema.type === "array") return `${typeLabel(schema.items as Json)}[]`;
  if (Array.isArray(schema.allOf)) return (schema.allOf as Json[]).map(typeLabel).filter(Boolean).join(" & ");
  if (Array.isArray(schema.enum)) return (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(" | ");
  const type = Array.isArray(schema.type) ? (schema.type as string[]).join(" | ") : String(schema.type ?? "object");
  return type + (schema.format ? ` (${schema.format})` : "");
}

export function operations(): Operation[] {
  const ops: Operation[] = [];
  for (const [path, item] of Object.entries(SPEC.paths)) {
    for (const [method, raw] of Object.entries(item)) {
      const op = raw as Json;
      const responses = Object.entries((op.responses ?? {}) as Record<string, Json>).map(([status, r]) => {
        const res = resolve<Json>(r);
        const content = res.content as Record<string, { schema?: Json }> | undefined;
        const schema = content ? Object.values(content)[0]?.schema : undefined;
        return { status, description: String(res.description ?? ""), schema: schema ? typeLabel(schema) : undefined, headers: Object.keys((res.headers ?? {}) as Json) };
      });
      const body = op.requestBody as { content?: Record<string, { example?: unknown }> } | undefined;
      ops.push({
        method: method.toUpperCase(),
        path,
        id: String(op.operationId ?? `${method}-${path}`),
        summary: String(op.summary ?? ""),
        description: op.description as string | undefined,
        tags: (op.tags as string[]) ?? [],
        parameters: ((op.parameters ?? []) as Param[]).map((p) => resolve<Param>(p)),
        requestExample: body?.content ? Object.values(body.content)[0]?.example : undefined,
        responses,
      });
    }
  }
  return ops;
}

/** A curl command for an operation, using parameter examples where given. */
export function curl(op: Operation, base: string): string {
  let path = op.path;
  const query: string[] = [];
  for (const p of op.parameters) {
    const ex = p.example ?? (Array.isArray((p.schema as Json | undefined)?.examples) ? ((p.schema as Json).examples as unknown[])[0] : undefined);
    if (p.in === "path") path = path.replace(`{${p.name}}`, String(ex ?? `<${p.name}>`));
    else if (p.in === "query" && ex !== undefined) query.push(`${p.name}=${encodeURIComponent(String(ex))}`);
  }
  const url = `${base}${path}${query.length ? `?${query.join("&")}` : ""}`;
  if (op.method === "GET") return `curl ${op.path.endsWith("/download") ? "-L -O " : ""}"${url}"`;
  return `curl -X ${op.method} "${url}" \\\n  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \\\n  -d '${JSON.stringify(op.requestExample ?? {})}'`;
}

/** Inline-markdown subset used in the spec's descriptions: `code`, **bold**, [links](url). */
export function inlineMd(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}
