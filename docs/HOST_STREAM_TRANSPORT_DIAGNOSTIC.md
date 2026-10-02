# 流式连接拒绝：只读诊断与最小修复边界

基线：34db5caad5bcc8475f841959fc0eb4d7023804e0；所有 UI 改进保留。
本次只增加一次性诊断脚本、mock 安全测试和本文，不修改生产传输或设置。

## 已知事实与尚未证明的部分

真实宿主 QA 回报：用户主动改为直连 HTTP endpoint 后，非流式 Verify
在 139.340 秒成功；同一源笔记流式在约 38ms、before-response 阶段出现
ECONNREFUSED，诊断 transport=node-http。没有活跃请求，流式已关闭。
这能区分旧 Tunnel 缓冲超时与当前连接阶段失败，但不足以定位拒绝来自
目标服务、代理、容器网络策略、进程限制或瞬时故障；不能宣称插件已修好，
也不能直接判定“只是云环境”。before-response 不等于证明服务端从未收到请求。

源码可确认：
- provider-transport.ts 的 JSON 请求调用 Obsidian requestUrl。
- provider-streaming.ts 的流式请求直接调用 Node http/https.request，使用
  默认 agent，没有自定义代理 agent，也没有宿主网络桥接。
- 因而它可能遵守 Node 默认 agent 已启用的代理行为，但没有代码保证它
  继承 Chromium 的系统代理、PAC 或 Obsidian 特有请求通道。
- 当前锁定 Obsidian SDK 1.13.1 的 RequestUrlResponse 只公开完整 text/json/
  arrayBuffer，不公开可读流；不能用它伪装网络级流式 keepalive。
- 实现有空闲超时、取消销毁和完整结束后交付语义。这里不调整这些语义，
  不自动 fallback、不再次发送、不改 TLS、安全选项或输出参数。

## 官方接口约束

Electron net 使用 Chromium 网络栈并支持系统代理；文档支持进程是 Main
和 Utility，而且有应用 ready 前提。renderer 中检测到符号也不能证明受支持。
不要使用 remote、私有 IPC 或假定插件可调用 main API。
https://www.electronjs.org/docs/latest/api/net

Node 24.5.0 引入 http/https 默认 agent 的环境代理支持，需启用相应 opt-in。
这与自动继承 Electron/Chromium 代理不同。构建容器的 Node 版本不能代表
Obsidian 内嵌 Node；单个环境标志也不能证明有效路由或启动时配置。
https://nodejs.org/en/blog/release/v24.5.0

Obsidian requestUrl 官方 API 与当前 SDK 的完整响应类型：
https://docs.obsidian.md/Reference/TypeScript+API/requestUrl
https://docs.obsidian.md/Reference/TypeScript+API/RequestUrlResponse

## QA 最少观察：不需要另发网络请求

在已授权专用测试库的 DevTools renderer console 中粘贴完整
`scripts/diagnose-host-transport.js` 表达式。它返回可复制的 JSON 字符串。
不安装插件、不增加命令或设置、不读取当前 provider 配置。

只回传该 JSON，并由宿主维护者回答一个已有事实：该云桌面是否要求通过
宿主/系统代理或专用网络通道出站（是/否/未知，不需要代理地址）。
不要求读取凭据或再次调用模型来收集这些观察。

输出边界：
- 只输出格式校验后的 Node/Electron/Obsidian API 版本、枚举进程类型及能力布尔值。
- 只读取 NODE_USE_ENV_PROXY 这一非秘密 opt-in 标志并转成布尔值；不读取
  HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY、argv、agent 配置或 session 代理信息。
- effectiveNodeProxyKnown=false 与 effectiveChromiumProxyKnown=false 表示
  有效代理状态未知，绝不是“代理关闭”。flagEnabled 也不是实际连通性结论。
- electronNetCandidate 仅为文档进程范围与符号存在性的交集；即使 true，也
  没有验证 ready、宿主授权、实际可调用性、代理路由或网络连通性。
- rendererFetchPresent/responseBodyApiPresent 只是 API 存在性；fetch 仍受
  renderer 的 CORS/CSP/混合内容等限制，不能据此直接替换现有 transport。
- 不调用 request/requestUrl/fetch/net/session/IPC，不枚举环境，不返回原始异常。

## 最小可验证修复方向（依观察决定，不先改生产代码）

1. 若 renderer 没有受支持宿主流式桥接，不能直接换 Electron net。
   现有 requestUrl 也不能提供真正逐块读取。先记录该宿主支持边界。
2. 若宿主维护者确认只允许 Chromium/代理通道，而 Node 路径无对应已启用
   路由，这与当前现象一致；仍需其网络策略证据才能定性为环境限制。
   不由插件修改系统代理或从宿主提取代理地址/认证信息。
3. 只有宿主已有明确支持的流式 bridge，或明确允许 renderer fetch 且服务
   满足其安全限制时，才考虑显式、单次 dispatch 的 transport adapter。
   先用 mock 覆盖逐块心跳重置空闲超时、取消销毁、迟到结果丢弃、完整结束
   才交付、连接失败不重发与不泄露 headers；随后由真实宿主 QA 验证。
4. 若只是当前云测试宿主禁止 Node 连接，保留生产实现与安全边界，并记录
   流式在该宿主未通过，而非为了通过测试增加私有网络绕路或新设置。

## 本次验证与交付

`node --test scripts/diagnose-host-transport.node-test.mjs`：5/5 通过。
mock 覆盖 renderer 不能冒充 Main、Main/Utility 只观察不调用、无 require/
process、异常与恶意版本文本不泄露，以及 env 标志不可读时保持未知。
所有 request/fetch 函数调用数为 0；代理地址、agent、session、remote 与
进程参数访问均设置为失败哨兵。未执行真实宿主脚本，待 QA 回传 JSON。

既有生产源码、main.js 与 styles.css 未改；不重复宣称完成真实网络修复。
原 UI 候选的 858 项测试结果仍属于 34db5ca，不冒充本次真实 API 验证。
