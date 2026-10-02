/** Build-time QA entry only: one next chat, no persistence or automatic fallback. */
import { createRendererStreamRequester } from "./renderer-fetch-stream";
let armed = false;
let busy = false;
export function armQaRendererStream(): boolean { if (busy) return false; armed = true; return true; }
export function claimQaRendererStream(): boolean { if (!armed || busy) return false; armed = false; busy = true; return true; }
export function finishQaRendererStream(): void { busy = false; }
export const qaRendererStreamRequester = createRendererStreamRequester((...args) => window.fetch(...args));
