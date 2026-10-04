import type { Provider } from "../core/types.js";
import { itchio } from "./itchio.js";
import { kenney } from "./kenney.js";
import { fab, poliigon, turbosquid } from "./linked.js";
import { polyhaven } from "./polyhaven.js";
import { quaternius } from "./quaternius.js";
import { texturescom } from "./texturescom.js";

/** Every built-in provider, in the order results are reported. */
export const allProviders: Provider[] = [polyhaven, kenney, quaternius, itchio, texturescom, fab, poliigon, turbosquid];
