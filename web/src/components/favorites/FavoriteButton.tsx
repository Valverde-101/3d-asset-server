import { useState } from "react";
import { Star } from "lucide-react";
import { findAssetFavorite, toggleAsset, useFavorites } from "./client";

interface AssetSummary {
  id: string; provider: string; title: string; type: string; url: string;
  thumbnailUrl?: string; author?: string; license?: { name: string; url?: string };
  free?: boolean; downloadable: boolean;
}

export default function FavoriteButton({ asset }: { asset: AssetSummary }) {
  const { library, error } = useFavorites();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saved = Boolean(findAssetFavorite(asset, library) && !findAssetFavorite(asset, library)?.deletedAt);
  return (
    <button
      type="button"
      aria-label={saved ? `Quitar ${asset.title} de Favoritos` : `Guardar ${asset.title} en Favoritos`}
      aria-pressed={saved}
      title={message || error || (saved ? "Quitar de Favoritos" : "Guardar en Favoritos")}
      disabled={busy || Boolean(error)}
      onClick={async () => {
        setBusy(true); setMessage("");
        try { await toggleAsset(asset, library); }
        catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}
      className="inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-foreground shadow-sm transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
    >
      <Star className="size-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}
