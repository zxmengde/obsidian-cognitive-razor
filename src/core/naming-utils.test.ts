import { describe, expect, it } from "vitest";
import type { DirectoryScheme } from "../types";
import { formatStandardName, generateFilePath } from "./naming-utils";

describe("concept naming", () => {
  it("uses one stable bilingual display format without empty parentheses", () => {
    expect(formatStandardName({ chinese: "量子纠缠", english: "Quantum entanglement" }))
      .toBe("量子纠缠 (Quantum entanglement)");
    expect(formatStandardName({ chinese: "量子纠缠", english: "" })).toBe("量子纠缠");
    expect(formatStandardName({ chinese: "", english: "Quantum entanglement" })).toBe("Quantum entanglement");
    expect(formatStandardName({ chinese: "Same", english: "Same" })).toBe("Same");
  });

  it("keeps semantic punctuation in display names and cleans only the file path", () => {
    const standardName = formatStandardName({ chinese: "A/B", english: "A:B" });
    const scheme: DirectoryScheme = {
      domain: "1-领域",
      issue: "2-议题",
      theory: "3-理论",
      entity: "4-实体",
      mechanism: "5-机制",
    };

    expect(standardName).toBe("A/B (A:B)");
    expect(generateFilePath(standardName, scheme, "entity"))
      .toBe("4-实体/AB (AB).md");
  });
});
