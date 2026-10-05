import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a ready-to-quote sentence (with its source link). */
export default function CopyQuote({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        })
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {done ? "Copied" : "Copy quote"}
    </button>
  );
}
