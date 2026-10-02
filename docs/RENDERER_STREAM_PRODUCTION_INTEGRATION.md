# 可回退的显式流式传输整合

## 选择与行为

方案一：只保留临时 QA 入口，生产零设置变化，但日常无法选择已验证通道。
方案二（本轮实施）：在原流式进阶区增加单个通道选择，默认 Node，普通配置不增加步骤。
选择仅在现有流式开关启用时显示；不新增密钥入口，不检测服务商猜通道。

新字段 streamingTransport=node-http|renderer-fetch。旧配置缺失或无效值安全回到
node-http，加载时不写盘；显式无效编辑拒绝，正常编辑沿用原持久化与备份路径。
关闭流式时，该字段不影响 requestUrl 非流式路径；重新打开时保留已选通道。
流式请求开始前捕获选择，运行中改设置不会换通道；Node 原有行为/重试不变。
renderer-fetch 每次聊天只分派一次，无自动重试、无失败换通道或非流式重发。
原 SSE 聚合、完整 JSON 兼容、结束校验、E206/人工重试与任务落盘保护继续复用。
取消、idle timeout、10分钟总时限、8MiB上限与迟到结果保护沿用已测 adapter。
原有任务级超时也可能先终止。未知结果不推定“未发送”，不自动再调用。

## 真实证据的准确边界

已收到宿主 a0e2 QA 反馈：2026-10-02 04:48:28.629–04:50:15.929 UTC，
107300ms，单次 Verify completed、attempt1，无自动回退或重试。
这仅证明该宿主的 renderer-fetch 认证 POST 带 stream=true 完成。
当时没有 framing 或远端块时序记录；共享实现允许同请求完整 JSON，因此
不能声称远端实际 SSE、保活心跳或逐块交付已通过。报告内容质量另由宿主核验。
此前本地合成流多块和无效认证 GET 通过，也不能补足远端 SSE 证据。

## 新增安全完成事件

将原有日志级别临时设为 debug 后，可观察 STREAM_RESPONSE_EVIDENCE。
仅在响应完整读完后记录；业务成功/失败仍由原协议校验决定。

- transport：明确选中的通道。
- responseContentType：只允许 text/event-stream、application/json、
  application/x-ndjson，其他值一律 unknown；不保留原参数或任意头值。
- framing：按实际正文形状判定 SSE / JSON / unknown。即使服务误标
  text/event-stream，完整 JSON 仍标 JSON，兼容处理不改变。
- chunkCount、byteCount：renderer reader 的非空块数、解压后字节数。
- firstResponseMs、firstChunkMs：从单次尝试开始至响应头/首非空块的相对毫秒。
- chunkSpanMs、maxChunkGapMs：首尾非空块跨度、相邻非空块最大间隔。
- dispatchCount=1：本事件对应的一次应用层分派，不把 OPTIONS 当模型调用。
  任务总调用数仍以原请求账本为准；Node 若明确失败后按旧策略重试，会有多次尝试。

Node 不伪造 reader 时序：当前这些计数/时间为 null。renderer 超时或中断没有
完整响应事件，仍用原安全失败事件和 phase/timeoutKind；不能由缺事件推断未发出。
事件不含正文、URL/query、Authorization、原始headers或原始异常。
Renderer HTTP 错误只保留状态映射，不复制上游错误正文进入诊断。
SSE 且 chunkCount>1、chunkSpanMs>0 才支持本次逐块 SSE 交付；JSON 只证明
完整响应兼容。多块不自动等于持续心跳，具体空闲间隔需另核对。

## 安装、最小复测与回退

1. 专用测试库确认无活跃任务，备份插件三文件；安装 production-plugin.zip
   中 main.js/styles.css/manifest.json。保留 data.json、prompts、笔记。
2. 正式包没有任何临时 QA 命令。普通用户保持默认即可。目标服务测试时，在
   「维护与备份」原执行进阶区开启流式，显式选择 Renderer fetch；不改模型或
   推理/输出参数、不增加密钥配置。临时启用 debug 以收集上述单个安全事件。
3. 从正常 UI 对合成测试笔记执行一次 Verify，核对任务完成/请求次数、报告完整性
   与 framing/块时序。只交接白名单事件，不导出原始网络日志或正文。结束后恢复
   原日志级别；E206 不直接重跑，遵守原人工确认语义。
4. 回退通道：选择 Node，仅影响之后请求。回退版本：无活跃任务时用
   rollback-production-plugin.zip 替换三文件并重载；其 main.js 为原生产
   f977d1e9e1c3fbce7301d7c4ce9c13ea014490fcbecba42a4bb927b0e41f4fb8。

此为全局流式选择，不是自动按服务路由。不同服务/平台须自行验证兼容性，
不因单个桌面宿主成功替换所有用户默认。CORS/CSP/HTTP混合内容、权限、TLS、
代理/压缩缓冲及后台计时器可能不同；拒绝即报错，不降低安全或修改代理。

## 验证

最终完整回归：75文件、919测试通过，包含此前887测试、恢复补充、adapter测试
及此次新增迁移/持久化/控件/单次分派/取消/未知分类/安全证据测试。
原 QA 构建集成7项、诊断脚本22项通过；保留在源码供复现，不进入正式包。
lint、check、check:test、QA测试类型检查、build通过。生产 bundle 静态确认
不包含临时QA命令标识，并包含新设置与安全证据事件。

实现中曾出现测试辅助方法名笔误及UI硬编码文案被既有约束测试拦截，均已修复；
未降低检查规则或删除既有测试。新增完整JSON兼容测试另确证：当上游把完整协议JSON误标为SSE类型时，旧路径可能生成空回答；已最小修复为识别完整协议响应并交回原JSON解析器，真正SSE事件仍走原聚合器。本容器没有读用户凭据/笔记或发真实模型请求。
本正式整合与新增远端framing事件尚待宿主复测，不把此前QA成功当作新正式包验收。
未推送、合并或部署。
