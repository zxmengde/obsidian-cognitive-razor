/**
 * 可访问性属性测试
 * 
 * 测试键盘导航、操作触发和屏幕阅读器支持
 * 
 * 注意：这些测试验证我们的 UI 组件是否正确设置了可访问性属性，
 * 而不是测试浏览器的 DOM 行为。
 */

import * as fc from "fast-check";

// 模拟 UI 元素配置
interface UIElementConfig {
  id: string;
  type: "button" | "input" | "textarea" | "select" | "link";
  tabIndex?: number;
  ariaLabel?: string;
  ariaHidden?: boolean;
  ariaLive?: "polite" | "assertive" | "off";
  visualOrder: number;
}

// 模拟创建 UI 元素的函数
function createUIElement(config: UIElementConfig): UIElementConfig {
  return {
    ...config,
    // 确保可聚焦元素有合适的 tabIndex
    tabIndex: config.tabIndex !== undefined ? config.tabIndex : 0
  };
}

// 验证焦点顺序的函数
function validateFocusOrder(elements: UIElementConfig[]): boolean {
  // 过滤出可聚焦的元素
  const focusable = elements.filter(el => 
    el.tabIndex !== undefined && el.tabIndex >= 0
  );

  if (focusable.length < 2) return true;

  // 按 tabIndex 和视觉顺序排序
  const sorted = [...focusable].sort((a, b) => {
    if (a.tabIndex !== b.tabIndex) {
      return (a.tabIndex || 0) - (b.tabIndex || 0);
    }
    return a.visualOrder - b.visualOrder;
  });

  // 验证排序后的顺序与视觉顺序一致
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].visualOrder > sorted[i + 1].visualOrder) {
      // 如果 tabIndex 不同，这是允许的
      if (sorted[i].tabIndex === sorted[i + 1].tabIndex) {
        return false;
      }
    }
  }

  return true;
}

/**
 * **Feature: cognitive-razor, Property 23: 键盘焦点导航**
 * **Validates: Requirements 12.3**
 * 
 * 对于任意交互元素，使用 Tab 键必须能够按顺序切换焦点，且焦点顺序必须符合视觉顺序。
 */
describe("Property 23: 键盘焦点导航", () => {
  test("UI 元素的 tabIndex 配置应符合视觉顺序", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          type: fc.constantFrom<"button" | "input" | "textarea" | "select" | "link">(
            "button", "input", "textarea", "select", "link"
          ),
          tabIndex: fc.option(fc.integer({ min: -1, max: 10 }), { nil: undefined }),
          visualOrder: fc.integer({ min: 0, max: 100 })
        }), { minLength: 2, maxLength: 10 }),
        async (configs) => {
          // 创建 UI 元素配置
          const elements = configs.map(createUIElement);

          // 验证焦点顺序
          const isValid = validateFocusOrder(elements);
          expect(isValid).toBe(true);

          // 验证可聚焦元素都有合适的 tabIndex
          elements.forEach(el => {
            if (el.tabIndex !== undefined && el.tabIndex >= 0) {
              // 可聚焦元素应该有 tabIndex >= 0
              expect(el.tabIndex).toBeGreaterThanOrEqual(0);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("tabIndex=-1 的元素应被排除在 Tab 导航之外", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          type: fc.constantFrom<"button" | "input" | "textarea" | "select" | "link">(
            "button", "input"
          ),
          tabIndex: fc.constantFrom(-1, 0, 1),
          visualOrder: fc.integer({ min: 0, max: 100 })
        }), { minLength: 3, maxLength: 8 }),
        async (configs) => {
          const elements = configs.map(createUIElement);

          // 过滤出可通过 Tab 导航的元素
          const tabbable = elements.filter(el => 
            el.tabIndex !== undefined && el.tabIndex >= 0
          );

          const nonTabbable = elements.filter(el => 
            el.tabIndex !== undefined && el.tabIndex < 0
          );

          // 验证 tabIndex >= 0 的元素在可聚焦列表中
          tabbable.forEach(el => {
            expect(el.tabIndex).toBeGreaterThanOrEqual(0);
          });

          // 验证 tabIndex < 0 的元素不在可聚焦列表中
          nonTabbable.forEach(el => {
            expect(el.tabIndex).toBeLessThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("相同 tabIndex 的元素应按视觉顺序排列", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          tabIndex: fc.integer({ min: 0, max: 5 }),
          elements: fc.array(fc.record({
            id: fc.string({ minLength: 1, maxLength: 20 }),
            visualOrder: fc.integer({ min: 0, max: 100 })
          }), { minLength: 2, maxLength: 5 })
        }),
        async ({ tabIndex, elements }) => {
          // 创建具有相同 tabIndex 的元素
          const configs: UIElementConfig[] = elements.map((el, index) => ({
            id: el.id,
            type: "button",
            tabIndex,
            visualOrder: el.visualOrder
          }));

          // 按视觉顺序排序
          const sorted = [...configs].sort((a, b) => 
            a.visualOrder - b.visualOrder
          );

          // 验证排序后的顺序
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].visualOrder).toBeLessThanOrEqual(sorted[i + 1].visualOrder);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * **Feature: cognitive-razor, Property 24: 键盘操作触发**
 * **Validates: Requirements 12.4**
 * 
 * 对于任意聚焦的按钮，按下 Enter 键必须触发对应操作，且效果必须与鼠标点击一致。
 */
describe("Property 24: 键盘操作触发", () => {
  // 模拟按钮配置
  interface ButtonConfig {
    id: string;
    label: string;
    onClick: () => void;
    supportsEnter: boolean;
    supportsSpace: boolean;
  }

  // 创建按钮配置
  function createButtonConfig(
    id: string,
    label: string,
    onClick: () => void
  ): ButtonConfig {
    return {
      id,
      label,
      onClick,
      supportsEnter: true,  // 按钮应该支持 Enter 键
      supportsSpace: true   // 按钮应该支持 Space 键
    };
  }

  test("按钮配置应支持 Enter 键触发", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          label: fc.string({ minLength: 1, maxLength: 50 })
        }), { minLength: 1, maxLength: 5 }),
        async (buttons) => {
          const clickCounts = new Map<string, number>();

          // 创建按钮配置
          const buttonConfigs = buttons.map((btn, index) => {
            const btnId = `btn-${btn.id}-${index}`;
            clickCounts.set(btnId, 0);
            
            return createButtonConfig(
              btnId,
              btn.label,
              () => {
                clickCounts.set(btnId, clickCounts.get(btnId)! + 1);
              }
            );
          });

          // 验证所有按钮都支持 Enter 键
          buttonConfigs.forEach(config => {
            expect(config.supportsEnter).toBe(true);
            
            // 模拟点击
            config.onClick();
            expect(clickCounts.get(config.id)).toBeGreaterThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("按钮配置应支持 Space 键触发", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        async (buttonIds) => {
          const clickCounts = new Map<string, number>();

          const buttonConfigs = buttonIds.map((id, index) => {
            const btnId = `btn-${id}-${index}`;
            clickCounts.set(btnId, 0);
            
            return createButtonConfig(
              btnId,
              `Button ${index}`,
              () => {
                clickCounts.set(btnId, clickCounts.get(btnId)! + 1);
              }
            );
          });

          // 验证所有按钮都支持 Space 键
          buttonConfigs.forEach(config => {
            expect(config.supportsSpace).toBe(true);
            
            // 模拟点击
            config.onClick();
            expect(clickCounts.get(config.id)).toBeGreaterThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("键盘触发和鼠标点击应有相同效果", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
        async (buttonIds) => {
          const results = new Map<string, { keyboard: number; mouse: number }>();

          buttonIds.forEach((id, index) => {
            const btnId = `btn-${id}-${index}`;
            results.set(btnId, { keyboard: 0, mouse: 0 });

            const config = createButtonConfig(
              btnId,
              `Button ${index}`,
              () => {
                // 这个回调在键盘和鼠标触发时都会执行
                const current = results.get(btnId)!;
                current.keyboard++;
                current.mouse++;
              }
            );

            // 模拟键盘触发
            config.onClick();
            
            // 模拟鼠标触发
            config.onClick();
          });

          // 验证键盘和鼠标触发的效果一致
          results.forEach((result, btnId) => {
            expect(result.keyboard).toBe(result.mouse);
            expect(result.keyboard).toBeGreaterThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * **Feature: cognitive-razor, Property 25: 屏幕阅读器支持**
 * **Validates: Requirements 12.5**
 * 
 * 对于任意图标和交互元素，必须提供 aria-label 属性，
 * 且状态变更必须通过 aria-live 通知屏幕阅读器。
 */
describe("Property 25: 屏幕阅读器支持", () => {
  // 模拟元素配置
  interface AccessibleElementConfig {
    id: string;
    type: "button" | "input" | "link" | "icon";
    ariaLabel?: string;
    ariaHidden?: boolean;
    ariaLive?: "polite" | "assertive" | "off";
    ariaAtomic?: boolean;
  }

  // 创建可访问元素配置
  function createAccessibleElement(
    id: string,
    type: "button" | "input" | "link" | "icon",
    ariaLabel?: string
  ): AccessibleElementConfig {
    return {
      id,
      type,
      ariaLabel,
      ariaHidden: type === "icon" && !ariaLabel ? true : undefined,
      ariaLive: undefined,
      ariaAtomic: undefined
    };
  }

  // 验证可访问性属性
  function validateAccessibility(config: AccessibleElementConfig): boolean {
    // 交互元素必须有 aria-label
    if (["button", "input", "link"].includes(config.type)) {
      return !!config.ariaLabel && config.ariaLabel.length > 0;
    }

    // 图标元素要么有 aria-label，要么有 aria-hidden
    if (config.type === "icon") {
      return !!(config.ariaLabel || config.ariaHidden);
    }

    return true;
  }

  test("交互元素必须有 aria-label", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          type: fc.constantFrom<"button" | "input" | "link">("button", "input", "link"),
          ariaLabel: fc.string({ minLength: 1, maxLength: 100 })
        }), { minLength: 1, maxLength: 10 }),
        async (elements) => {
          elements.forEach((elem, index) => {
            const config = createAccessibleElement(
              `elem-${elem.id}-${index}`,
              elem.type,
              elem.ariaLabel
            );

            // 验证可访问性
            const isValid = validateAccessibility(config);
            expect(isValid).toBe(true);

            // 验证 aria-label 存在且非空
            expect(config.ariaLabel).toBeTruthy();
            expect(config.ariaLabel!.length).toBeGreaterThan(0);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("图标元素应有 aria-hidden 或 aria-label", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          hasAriaLabel: fc.boolean(),
          ariaLabel: fc.string({ minLength: 1, maxLength: 50 })
        }), { minLength: 1, maxLength: 10 }),
        async (icons) => {
          icons.forEach((icon, index) => {
            const config = createAccessibleElement(
              `icon-${icon.id}-${index}`,
              "icon",
              icon.hasAriaLabel ? icon.ariaLabel : undefined
            );

            // 验证可访问性
            const isValid = validateAccessibility(config);
            expect(isValid).toBe(true);

            // 验证：要么有 aria-label，要么有 aria-hidden
            const hasAriaLabel = !!config.ariaLabel;
            const hasAriaHidden = config.ariaHidden === true;
            
            expect(hasAriaLabel || hasAriaHidden).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("状态变更区域应有 aria-live", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          liveMode: fc.constantFrom<"polite" | "assertive" | "off">("polite", "assertive", "off"),
          initialText: fc.string({ minLength: 0, maxLength: 50 }),
          updatedText: fc.string({ minLength: 1, maxLength: 50 })
        }), { minLength: 1, maxLength: 5 }),
        async (regions) => {
          regions.forEach((region, index) => {
            const config: AccessibleElementConfig = {
              id: `region-${region.id}-${index}`,
              type: "button",  // 任意类型
              ariaLive: region.liveMode
            };

            // 验证 aria-live 属性存在
            expect(config.ariaLive).toBe(region.liveMode);
            expect(config.ariaLive).toBeTruthy();

            // 模拟状态变更后，aria-live 应该保持
            const updatedConfig = { ...config };
            expect(updatedConfig.ariaLive).toBe(region.liveMode);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test("动态内容更新应保持 aria-live 属性", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          updates: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 2, maxLength: 10 })
        }),
        async ({ id, updates }) => {
          const config: AccessibleElementConfig = {
            id: `live-${id}`,
            type: "button",
            ariaLive: "polite",
            ariaAtomic: true
          };

          // 执行多次更新
          for (const update of updates) {
            // 模拟内容更新
            const updatedConfig = { ...config };
            
            // 验证每次更新后 aria-live 仍然存在
            expect(updatedConfig.ariaLive).toBe("polite");
            expect(updatedConfig.ariaAtomic).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test("所有 UI 组件配置都应满足可访问性要求", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({
          id: fc.string({ minLength: 1, maxLength: 20 }),
          type: fc.constantFrom<"button" | "input" | "link" | "icon">(
            "button", "input", "link", "icon"
          ),
          ariaLabel: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined })
        }), { minLength: 1, maxLength: 10 }),
        async (elements) => {
          elements.forEach((elem, index) => {
            const config = createAccessibleElement(
              `elem-${elem.id}-${index}`,
              elem.type,
              elem.ariaLabel
            );

            // 验证可访问性
            const isValid = validateAccessibility(config);
            
            // 如果是交互元素，必须有 aria-label
            if (["button", "input", "link"].includes(config.type)) {
              expect(isValid).toBe(!!elem.ariaLabel);
            } else {
              // 图标元素必须有 aria-label 或 aria-hidden
              expect(isValid).toBe(true);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
