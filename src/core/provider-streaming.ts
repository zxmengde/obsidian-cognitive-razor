import * as http from "http";
import * as https from "https";
import type { ClientRequest, IncomingMessage } from "http";
import { createResponsesStreamCompletionTracker } from "./provider-stream-codec";

export {
  aggregateProviderStream,
  createResponsesStreamCompletionTracker,
  decodeProviderStream,
  hasProviderStreamFraming,
  readProviderStreamUsage,
  safeStreamResponseEvidence,
} from "./provider-stream-codec";

export type ProviderStreamProtocol =
  | "openai-chat-completions"
  | "openai-responses"
  | "gemini-generative-language"
  | "anthropic-messages";

export type ProviderStreamTransport = "node-http" | "renderer-fetch";
export const MAX_PROVIDER_STREAM_BYTES = 8 * 1024 * 1024;

export interface ProviderStreamRequest {
  /** Lets the transport honor authoritative Responses terminal events. */
  protocol?: ProviderStreamProtocol;
  transport?: ProviderStreamTransport;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderStreamDiagnostics {
  chunkCount: number;
  byteCount: number;
  firstResponseMs: number;
  firstChunkMs: number | null;
  chunkSpanMs: number;
  maxChunkGapMs: number;
}

export interface ProviderStreamResponse {
  diagnostics?: ProviderStreamDiagnostics;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type ProviderStreamRequester = (
  request: ProviderStreamRequest,
) => Promise<ProviderStreamResponse>;

export type ProviderStreamPhase = "before-response" | "after-response";

export class ProviderStreamTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly phase: ProviderStreamPhase) {
    super(`Provider stream was idle for ${timeoutMs}ms`);
    this.name = "ProviderStreamTimeoutError";
  }
}

export class ProviderStreamAbortError extends Error {
  constructor(readonly reason: unknown) {
    super("Provider stream aborted");
    this.name = "ProviderStreamAbortError";
  }
}

const SAFE_NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
  "ENETUNREACH", "EHOSTUNREACH", "EACCES", "EPERM", "EPROTO",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Never infer a diagnostic from a URL, certificate text or raw error message. */
export function safeStreamNetworkCode(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "UNKNOWN";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" && SAFE_NETWORK_CODES.has(code) ? code : "UNKNOWN";
}

export class ProviderStreamNetworkError extends Error {
  readonly networkCode: string;
  constructor(
    readonly phase: ProviderStreamPhase,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderStreamNetworkError";
    this.networkCode = safeStreamNetworkCode(cause);
  }
}

/**
 * Stream requests deliberately use Node's HTTP client. Obsidian's requestUrl
 * bypasses CORS but exposes only a completed response, while renderer fetch is
 * subject to the app:// origin and proxy CORS policy.
 */
export const requestProviderStream: ProviderStreamRequester = (input) =>
  new Promise<ProviderStreamResponse>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new ProviderStreamAbortError(input.signal.reason));
      return;
    }

    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let responseStarted = false;
    let responseEnded = false;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    // 增量 UTF-8 解码为片段数组，避免保留原始字节并在结束时二次拷贝和二次解码。
    const decodedParts: string[] = [];
    let totalBytes = 0;
    const terminal = createResponsesStreamCompletionTracker(input.protocol);
    const streamDecoder = new TextDecoder();

    const cleanup = (): void => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
        abortHandler = undefined;
      }
    };

    const settleResolve = (value: ProviderStreamResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request?.destroy();
      response?.destroy();
      reject(error);
    };

    const armTimeout = (): void => {
      if (settled) return;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        settleReject(new ProviderStreamTimeoutError(
          input.timeoutMs,
          responseStarted ? "after-response" : "before-response",
        ));
      }, input.timeoutMs);
    };

    const failNetwork = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      settleReject(new ProviderStreamNetworkError(
        responseStarted ? "after-response" : "before-response",
        message,
        error,
      ));
    };

    const toHeaders = (incoming: IncomingMessage): Record<string, string> => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          headers[key] = value.join(", ");
        } else if (value !== undefined) {
          headers[key] = value;
        }
      }
      return headers;
    };

    const joinDecodedBody = (flush: boolean): string => {
      if (flush) {
        const tail = streamDecoder.decode();
        if (tail) decodedParts.push(tail);
      }
      return decodedParts.length === 1 ? decodedParts[0] : decodedParts.join("");
    };

    const handleResponse = (incoming: IncomingMessage): void => {
      responseStarted = true;
      response = incoming;
      armTimeout();

      incoming.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        armTimeout();
        const byteLength = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
        totalBytes += byteLength;
        if (totalBytes > MAX_PROVIDER_STREAM_BYTES) {
          settleReject(new ProviderStreamNetworkError("after-response", "STREAM_SIZE_LIMIT"));
          return;
        }
        const text = typeof chunk === "string" ? chunk : streamDecoder.decode(chunk, { stream: true });
        if (text) decodedParts.push(text);
        const end = terminal?.(text);
        if (end !== undefined && (incoming.statusCode ?? 0) >= 200 && (incoming.statusCode ?? 0) < 300) {
          responseEnded = true;
          settleResolve({ status: incoming.statusCode ?? 0, headers: toHeaders(incoming), body: joinDecodedBody(false).slice(0, end) });
          incoming.destroy();
          request?.destroy();
        }
      });
      incoming.once("end", () => {
        responseEnded = true;
        settleResolve({
          status: incoming.statusCode ?? 0,
          headers: toHeaders(incoming),
          body: joinDecodedBody(true),
        });
      });
      incoming.once("aborted", () => failNetwork(new Error("Provider response was aborted")));
      incoming.once("error", failNetwork);
      incoming.once("close", () => {
        if (!responseEnded) {
          failNetwork(new Error("Provider response closed before completion"));
        }
      });
    };

    try {
      const url = new URL(input.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported provider URL protocol: ${url.protocol}`);
      }

      const requestOptions: http.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...input.headers,
          Accept: input.headers.Accept ?? "text/event-stream",
          "Accept-Encoding": input.headers["Accept-Encoding"] ?? "identity",
          Connection: input.headers.Connection ?? "keep-alive",
        },
      };

      const transport = url.protocol === "https:" ? https : http;
      request = transport.request(requestOptions, handleResponse);
      request.once("error", failNetwork);
      request.once("close", () => {
        if (!responseStarted && !settled) {
          failNetwork(new Error("Provider request closed before response"));
        }
      });

      abortHandler = () => {
        settleReject(new ProviderStreamAbortError(input.signal?.reason));
      };
      input.signal?.addEventListener("abort", abortHandler, { once: true });
      if (input.signal?.aborted) {
        settleReject(new ProviderStreamAbortError(input.signal.reason));
        return;
      }

      armTimeout();
      request.write(input.body);
      request.end();
    } catch (error) {
      failNetwork(error);
    }
  });
