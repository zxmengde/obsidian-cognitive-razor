import { requestUrl, type RequestUrlParam } from "obsidian";
import {
  ProviderStreamAbortError,
  requestProviderStream,
  type ProviderStreamRequest,
  type ProviderStreamResponse,
  type ProviderStreamRequester,
} from "./provider-streaming";

export class ProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Provider request timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderAbortError extends Error {
  constructor(readonly reason: unknown) {
    super("Provider request aborted");
    this.name = "ProviderAbortError";
  }
}

export type ProviderJsonResponse = Awaited<ReturnType<typeof requestUrl>>;

/** Transport boundary for timeout, abort, stream and dispose semantics. */
export interface ProviderTransport {
  requestJson(params: RequestUrlParam, timeoutMs: number, signal?: AbortSignal): Promise<ProviderJsonResponse>;
  requestStream(input: ProviderStreamRequest): Promise<ProviderStreamResponse>;
  dispose(): void;
}

export class ObsidianProviderTransport implements ProviderTransport {
  private readonly activeControllers = new Set<AbortController>();
  private disposed = false;

  constructor(private readonly streamRequester: ProviderStreamRequester = requestProviderStream) {}

  async requestJson(
    params: RequestUrlParam,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProviderJsonResponse> {
    if (this.disposed) throw new ProviderAbortError("ProviderTransport disposed");

    const controller = new AbortController();
    this.activeControllers.add(controller);
    let sourceAbortHandler: (() => void) | undefined;
    let abortHandler: (() => void) | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      if (signal) {
        sourceAbortHandler = () => controller.abort(signal.reason);
        signal.addEventListener("abort", sourceAbortHandler, { once: true });
        if (signal.aborted) {
          throw new ProviderAbortError(signal.reason);
        }
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs);
      });
      const abortPromise = new Promise<never>((_, reject) => {
        abortHandler = () => reject(new ProviderAbortError(controller.signal.reason));
        controller.signal.addEventListener("abort", abortHandler, { once: true });
      });

      return await Promise.race([
        requestUrl(params),
        timeoutPromise,
        abortPromise,
      ]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (signal && sourceAbortHandler) signal.removeEventListener("abort", sourceAbortHandler);
      if (abortHandler) controller.signal.removeEventListener("abort", abortHandler);
      this.activeControllers.delete(controller);
    }
  }

  async requestStream(input: ProviderStreamRequest): Promise<ProviderStreamResponse> {
    if (this.disposed) throw new ProviderStreamAbortError("ProviderTransport disposed");

    const controller = new AbortController();
    this.activeControllers.add(controller);
    let abortHandler: (() => void) | undefined;
    try {
      if (input.signal) {
        abortHandler = () => controller.abort(input.signal?.reason);
        input.signal.addEventListener("abort", abortHandler, { once: true });
        if (input.signal.aborted) {
          throw new ProviderStreamAbortError(input.signal.reason);
        }
      }

      return await this.streamRequester({ ...input, signal: controller.signal });
    } finally {
      if (input.signal && abortHandler) input.signal.removeEventListener("abort", abortHandler);
      this.activeControllers.delete(controller);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.activeControllers) {
      controller.abort("ProviderTransport disposed");
    }
    this.activeControllers.clear();
  }
}
