import { useState } from "react";
import { Link2 } from "lucide-react";
import { safeUrl } from "@/components/search/api";

function siteIcons(url: string): string[] {
  const page = safeUrl(url);
  if (!page) return [];
  const origin = new URL(page).origin;
  return ["/favicon.ico", "/apple-touch-icon.png", "/favicon.svg"].map((path) => `${origin}${path}`);
}

export function FavoritePreview({ imageUrl, url, title, domain }: { imageUrl?: string; url: string; title: string; domain: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [iconIndex, setIconIndex] = useState(0);
  const image = safeUrl(imageUrl);
  const icon = siteIcons(url)[iconIndex];

  if (image && !imageFailed) {
    return <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="size-full object-cover" />;
  }

  return <div className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-primary/10 via-muted to-accent/50 p-5">
    <div className="flex size-20 items-center justify-center rounded-2xl border bg-background/90 shadow-sm">
      {icon ? <img src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconIndex((index) => index + 1)} className="size-12 object-contain" /> : <Link2 className="size-9 text-primary" aria-hidden="true" />}
    </div>
    <span className="max-w-full truncate text-xs font-medium text-muted-foreground" title={title}>{domain}</span>
  </div>;
}
