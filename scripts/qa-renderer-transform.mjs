/** Exact, reviewable QA-only rewrites; production sources stay unchanged. */
export function transformQaProviderManager(source) {
  const replace = (from, to) => { if (source.split(from).length !== 2) throw Error('QA manager marker mismatch'); source = source.replace(from, to); };
  source = 'import { claimQaRendererStream, finishQaRendererStream } from "./qa-renderer-selection";\n' + source;
  replace('    const apiFormat = providerConfig.apiFormat as Exclude<ProviderApiFormat, "disabled">;', '    if (!claimQaRendererStream()) return err("E310_INVALID_STATE", "QA：请先通过命令显式允许下一次 renderer-fetch 聊天请求");\n    try {\n    const apiFormat = providerConfig.apiFormat as Exclude<ProviderApiFormat, "disabled">;');
  replace('this.settingsStore.getSettings().streamingTransport === "renderer-fetch" ? "renderer-fetch" : "node-http"', '"renderer-fetch"');
  replace('      options.streaming,', '      true,');
  replace('    const result = options.withRetry', '    const result = false /* QA: never automatically resend */');
  replace('      : result;\n  }', '      : result;\n    } finally { finishQaRendererStream(); }\n  }');
  return source;
}
export function qaRendererCommand() {
  return `
    this.addCommand({id:'qa-arm-renderer-stream',name:'QA：允许下一次聊天使用 renderer-fetch 流式（单次）',callback:()=>{
      new Notice(armQaRendererStream() ? 'QA：下一次聊天请求已选择 renderer-fetch 流式；无自动重试。仅运行一项测试任务，完成后需再次显式允许。' : 'QA：已有请求运行，不能再次允许。');
    }});`;
}
