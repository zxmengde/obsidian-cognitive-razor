import type { SettingsStore } from "../data/settings-store";
import { ProviderManager } from "./provider-manager";
import type { ExternalCallLedger } from "./external-call-ledger";
import { InMemoryExternalCallLedger } from "./external-call-ledger";
import type {
  ProviderProbeGateway,
  ProviderProbeRequest,
} from "./model-gateway";
import type { ILogger, ProviderCapabilities, Result } from "../types";

const CONNECTION_LOGGER: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Short-lived Provider probe used by settings without starting vault runtime. */
export class ProviderConnection implements ProviderProbeGateway {
  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly ledger: ExternalCallLedger = new InMemoryExternalCallLedger(),
  ) {}

  async probe(
    request: ProviderProbeRequest,
    signal?: AbortSignal,
  ): Promise<Result<ProviderCapabilities>> {
    const manager = new ProviderManager(this.settingsStore, CONNECTION_LOGGER, undefined, undefined, this.ledger);
    try {
      return await manager.probe(request, signal);
    } finally {
      manager.dispose();
    }
  }
}
