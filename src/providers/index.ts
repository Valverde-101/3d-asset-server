import type { Provider } from "../core/types.js";
import { fab, poliigon, turbosquid } from "./linked.js";
import { polyhaven } from "./polyhaven.js";
import { texturescom } from "./texturescom.js";

/** Every built-in provider, in the order results are reported. */
export const allProviders: Provider[] = [polyhaven, texturescom, fab, poliigon, turbosquid];
