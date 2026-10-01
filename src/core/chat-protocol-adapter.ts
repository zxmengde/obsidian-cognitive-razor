import type {
  ChatRequest,
  ChatResponse,
  ProviderApiFormat,
  Result,
  WebSearchPurpose,
} from "../types";
import type { ProviderStreamProtocol } from "./provider-streaming";

export type ProviderAuthScheme = "bearer" | "gemini";

/** Resolved native-search policy passed to protocols that support it. */
export interface ProtocolWebSearchOptions {
  purpose: WebSearchPurpose;
}

/** Protocol-only contract used by ProviderManager's transport boundary. */
export interface ProtocolAdapterMetadata {
  readonly apiFormat: Exclude<ProviderApiFormat, "disabled">;
  readonly requestPath: string;
  readonly streamProtocol: ProviderStreamProtocol;
  readonly authScheme: ProviderAuthScheme;
  readonly displayName: string;
  readonly extraHeaders?: Record<string, string>;
  parseResponse(raw: unknown): Result<ChatResponse>;
}

export interface ChatProtocolAdapter extends ProtocolAdapterMetadata {
  buildRequestBody(request: ChatRequest, webSearch?: ProtocolWebSearchOptions): Record<string, unknown>;
}
