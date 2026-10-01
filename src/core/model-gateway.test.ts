import { describe, expectTypeOf, it } from "vitest";
import type { ModelGateway } from "./model-gateway";
import { ProviderManager } from "./provider-manager";

describe("ModelGateway", () => {
  it("is implemented by the current ProviderManager adapter", () => {
    expectTypeOf<ProviderManager>().toMatchTypeOf<ModelGateway>();
  });
});
