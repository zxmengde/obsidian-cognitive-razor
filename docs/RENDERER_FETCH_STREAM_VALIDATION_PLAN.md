# Renderer fetch 流式候选：受限验证方案（未改生产代码）

基线生产提交：481ab3c55f67357f10de892eb723425de21444b8。
本次仅依据宿主白名单观测、现有源码及官方接口制定方案；不发用户 API
请求，不取密钥，不启用新生产 transport。本方案中的测试尚未执行。

## 1. 已有证据与结论

真实 Obsidian 宿主：Node 24.18.1 / Electron 43.3.0 / Obsidian API 1.13.7；
process=renderer。requestUrl、Node HTTP/HTTPS、renderer fetch、ReadableStream
和 Response.body 存在；Electron net.request/net.fetch 不存在且不属于
文档支持进程。NODE_USE_ENV_PROXY opt-in 标志可读且为 false；实际 Node
与 Chromium 代理路由均未知，不能据此断言系统无代理。

结论：renderer fetch 是符合公开 Web API 的候选，可以设计受限实验；
它不是已证明可用的替代，更不是在 Node 拒绝后自动绕路。当前结果没有
证明目标服务 CORS、应用 CSP、网络权限、HTTP 混合内容或实际网络通道允许。
暂时保留已通过的 production 包和关闭流式的状态。

## 2. 官方依据与适用边界

- Electron net 的文档进程范围是 Main/Utility，使用 Chromium 网络栈；
  当前 renderer 不能把符号探测或旧 remote 示例当作受支持入口。
  https://www.electronjs.org/docs/latest/api/net
- Window.fetch 可返回 Response；HTTP 非 2xx 不等于 promise rejection。
  fetch 受 CSP connect-src 控制。拒绝的 TypeError 不是可细分的网络原因。
  https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
- Response.body 是可读流，可以逐块读取；取消能中止 fetch 及响应消费。
  https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
  https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- JSON POST 和 Authorization 等非简单请求头通常需要 CORS preflight；
  服务必须允许真实发起源、方法和头。不能使用 no-cors 获得可读 SSE。
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- Connection、Accept-Encoding 等请求头由浏览器控制，不能照搬 Node 设置。
  https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header

现有 requestUrl 能完成请求不证明 renderer fetch 被允许；普通网页的
Chromium测试、Shell Node 测试也不能代替真实 Obsidian renderer 验收。

## 3. 最小实现方向：显式选择，单一分派

复用 ObsidianProviderTransport 构造函数已有 streamRequester 注入点；
候选工厂接收明确的宿主 window.fetch.bind(window)，不使用 Node fetch、
Electron net、私有 IPC、remote、代理 agent 或自动探测成功后切换。
先在命名清晰的 QA 实验构建中由操作员选择 renderer-fetch，仅对该次
受控实验生效，不写入设置、不增加正式用户配置。是否加入生产可选项
必须等受限实验通过，当前不更改默认 Node transport 或流式开关。

开始前确定且记录 transport。一次应用层尝试只调用所选 fetch 一次；
禁止 catch 后调用 Node/requestUrl/fetch 第二次。浏览器自带 OPTIONS
preflight 是权限协商，不是第二次模型调用；不要将其伪装成纯单个 HTTP 包。

候选 RequestInit：POST、mode=cors、credentials=omit、redirect=error、
cache=no-store、referrerPolicy=no-referrer，以及独立 AbortSignal。
不设置 no-cors、keepalive=true 或浏览器受限头；Fetch keepalive 不是
长请求/SSE保活开关。安全禁止的必需请求头在发送前明确拒绝，不能静默
删掉认证头。未来真实请求的认证沿用既有应用参数，不能从宿主提取新凭据；
当前实验则完全不读取或发送 Authorization/Cookie/API-key。

用户选 transport 的合法性、URL/头支持性在网络分派前验证；现有 ledger
在 transport 调用前 markSent，不能仅凭 adapter 的 before-response
就改记“肯定未发送”。若未调整分派契约，维持保守 unknown 状态。

## 4. 流式生命周期和错误语义

- 发送前已取消：零 fetch。计时从分派开始覆盖 DNS/连接/preflight/等头阶段。
- 收到可访问响应头后进入 after-response，并重置空闲时钟一次；随后仅在
  reader 实际返回非空字节时续时。SSE注释心跳也续时；空 chunk 不无限续命。
  压缩/中间层缓冲可能延后 reader 字节，因此“服务端写过心跳”不等于
  客户端收到心跳。宿主后台 timer 节流也不能由 mock 证明不存在。
- 空闲超时、手工取消、dispose 都 abort 控制器，取消/释放 reader，清除
  timer/listener。使用明确本地结束原因区分 timeout 与用户 cancel；不依赖
  AbortError 文案。迟到 headers/chunks/EOF 不可重新 settle 或写笔记。
- EOF 后才交付完整 body，继续复用现有协议聚合/finishReason 校验；缺少
  完成事件、明确 incomplete、半途断流不写部分结果。不把首字节当成功。
  响应大小需沿用或明确设置上限，超限即中止，不允许无限缓冲。
- 普通 4xx/5xx 通过可见 response.status 交给既有映射；response.body 缺失、
  opaque/status=0 或读流失败不伪装成成功。使用限制长度的缓冲和安全诊断。
- fetch reject / CORS / CSP / 网络失败可能只表现为 TypeError。只输出
  FETCH_REJECTED / READ_FAILED、transport=renderer-fetch、阶段与有限时间；
  不解析原始 message 来猜 ECONNREFUSED 或 CORS，不显示 URL/头/正文。
  dispatch 后不能证明服务端未处理时维持 E206/uncertain，不自动重试。
- ProviderManager 当前将流式诊断 transport 写死为 node-http；接入候选前
  必须改为明确 transport 标识。纯 mock 要验证不能把 fetch失败记成node-http。

## 5. 纯 mock 验证矩阵（零网络、无真实配置）

用注入的 fake fetch、可控 ReadableStream 和 fake timers，不伪装为浏览器
安全策略测试。每例都断言 fetch 调用次数、reader/abort清理和无fallback。

1. 预取消、无能力、非法选择/受限头：零分派；不偷换 transport。
2. 头迟到/永不返回：before-response timeout，一次调用，迟到头忽略。
3. 头成功但无字节：after-response timeout，不能仅因收到头永久等待。
4. 小于idle阈值的多个心跳总时长超过阈值：保持等待，直到完整终止才返回。
5. 无数据/零长度chunk不续命，真实字节续命；独立总时限不被无限续长。
6. UTF-8跨chunk、SSE事件跨chunk、不同协议终止标记、JSON完整响应兼容。
7. 用户取消、卸载、读流抛错、超限：及时停止且不泄露部分正文/晚到写入。
8. 完整4xx/5xx、CORS式TypeError、opaque/null body、重定向拒绝：保守分类；
   不从失败文案推定未发送，不自动fallback或网络路径重试。
9. 并发多个请求互不清timer/signal；每个reader锁释放，dispose关闭全部。
10. ProviderManager集成：诊断transport准确，未知结果不自动重试，任务取消/
    重载/迟到结果保护继续通过；不改变模型、输出参数、正文或系统安全配置。

通过这些用例只证明 adapter/应用语义，不证明真实CORS/CSP或外网连通性。

## 6. 无凭据受限连接检查设计（当前尚未执行）

第一阶段只访问 QA 自有的合成 fixture server；不访问用户模型服务的
/v1、/models、/chat/completions、/responses，不读取当前provider endpoint。
fixture不充当转发代理，不接收/转发任意目标URL，不含笔记/账户/模型数据。

由 QA 在专用宿主启动绑定127.0.0.1的临时server，端口明确显示；诊断构建
固定允许该loopback地址及列出的测试路径，不支持任意URL、域名跳转或扫描。
仅接受很小的固定JSON（例如 {"probe":"stream-v1"}），无Authorization、
Cookie、API-key、用户提示词或referrer。无自动重定向。每次按钮只运行
一个用例，硬截止10秒、最多64KiB、禁用连点，不启动轮询或自动重试。

可选用例：
- allow-stream：fixture允许测试源与JSON POST，先发头、每0.5秒写一次
  SSE注释，约2秒结束。查看是否真的有多个read及间隔，不只看最终文本。
- deny-preflight：fixture有意不允许JSON POST的CORS预检；确认没有业务POST
  到达该fixture。不借此认定未来每次TypeError也一定没发送。
- stall：返回头后停止字节，验证idle截止；操作员另一次用例验证主动取消。
- redirect：fixture重定向到另一个本地sink；redirect=error应阻止跟随，sink
  收到计数为0。它不重定向外部地址，也不携带凭据。

正常允许/拒绝CORS是这个无敏感数据fixture的测试契约；不修改Obsidian
CSP、目标服务CORS、系统代理、证书校验、webSecurity或权限策略。如果
宿主对loopback、HTTP混合内容或本地网络权限拒绝，则原样记录并停止；
不换端口/协议不断试探，不自行授予权限或使用no-cors。外部受控HTTPS
fixture只有在明确指定和授权后才考虑，也不能代替用户API的CORS验收。

安全回传只包含用例ID、transport、有限status/phase、headersReceived布尔、
chunk/byte计数、有限耗时、aborted布尔、完成标记布尔与fixture请求计数。
不回传URL、实际Origin字符串、请求头、body、历史日志或原始异常。
可选记录“本次捕获到connect-src违规”的布尔；没事件不证明没有CSP限制。

本阶段不发送Authorization，因此不能验证目标服务对该头的许可；不能
把loopback成功外推为用户API可用，也不能推断实际系统代理已启用。

## 7. 决策门槛

纯mock通过 + 真实Obsidian受控fixture多chunk/取消/禁止fallback验证通过，
仅能将renderer-fetch标为“可继续评估的显式选项”。要宣称对用户API可用，
仍需另行授权的真实端点CORS/权限与单次业务验证；本轮明确不执行。
若平台策略阻止受控fixture或目标服务不允许浏览器跨域，不强行上线新
transport，不关闭安全，不改系统代理，保留生产版本并报告具体限制。
