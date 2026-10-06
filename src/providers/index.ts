import type { Provider } from "../core/types.js";
import { ambientcg } from "./ambientcg.js";
import { blenderkit } from "./blenderkit.js";
import { cgbookcase } from "./cgbookcase.js";
import { cgtrader } from "./cgtrader.js";
import { hdrihub } from "./hdrihub.js";
import { hdrmaps } from "./hdrmaps.js";
import { itchio } from "./itchio.js";
import { kenney } from "./kenney.js";
import { fab, poliigon, turbosquid } from "./linked.js";
import { polyhaven } from "./polyhaven.js";
import { quaternius } from "./quaternius.js";
import { sharetextures } from "./sharetextures.js";
import { texturecan } from "./texturecan.js";
import { texturescom } from "./texturescom.js";
import { threedtexel } from "./threedtexel.js";
import { threedtextures } from "./threedtextures.js";

/** Every built-in provider, in the order results are reported. */
export const allProviders: Provider[] = [
  polyhaven,
  ambientcg,
  cgbookcase,
  sharetextures,
  blenderkit,
  fab,
  kenney,
  poliigon,
  quaternius,
  threedtextures,
  threedtexel,
  texturecan,
  texturescom,
  hdrmaps,
  hdrihub,
  cgtrader,
  turbosquid,
  itchio,
];
