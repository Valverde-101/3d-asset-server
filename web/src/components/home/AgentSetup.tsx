import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BorderBeam } from "@/components/ui/border-beam";
import { AGENT_CLIENTS } from "@/lib/agents";

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      className={`inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10 ${className}`}
      aria-label="Copy to clipboard"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Tabbed per-client MCP setup with copyable snippets. Every tab is rendered for crawlers (forceMount + hidden). */
export default function AgentSetup() {
  const [tab, setTab] = useState(AGENT_CLIENTS[0]!.id);
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card/60 p-2 shadow-2xl shadow-primary/5 backdrop-blur">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-1">
          {AGENT_CLIENTS.map((c) => (
            <TabsTrigger key={c.id} value={c.id} className="flex-none rounded-lg px-3 py-1.5 data-[state=active]:bg-accent">
              {c.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {AGENT_CLIENTS.map((c) => (
          <TabsContent key={c.id} value={c.id} forceMount className="mt-1 data-[state=inactive]:hidden">
            <div className="rounded-xl bg-[#0d0d12] p-4 text-zinc-100">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-400">{c.where}</p>
                <div className="flex items-center gap-2">
                  {c.install && (
                    <a
                      href={c.install.href}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      <ExternalLink className="size-3.5" />
                      {c.install.label}
                    </a>
                  )}
                  <CopyButton text={c.code} />
                </div>
              </div>
              <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed">
                <code>{c.code}</code>
              </pre>
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <BorderBeam size={120} duration={10} colorFrom="var(--color-primary)" colorTo="var(--color-brand-2)" />
    </div>
  );
}
