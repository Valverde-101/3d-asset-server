import type { Provider } from "../core/types.js";
import { ambientcg } from "./ambientcg.js";
import { blenderkit } from "./blenderkit.js";
import { cgtrader } from "./cgtrader.js";
import { itchio } from "./itchio.js";
import { kenney } from "./kenney.js";
import { fab, poliigon, turbosquid } from "./linked.js";
import { polyhaven } from "./polyhaven.js";
import { quaternius } from "./quaternius.js";
import { texturescom } from "./texturescom.js";

/** Every built-in provider, in the order results are reported. */
export const allProviders: Provider[] = [
  polyhaven,
  ambientcg,
  kenney,
  quaternius,
  blenderkit,
  itchio,
  cgtrader,
  texturescom,
  fab,
  poliigon,
  turbosquid,
];
