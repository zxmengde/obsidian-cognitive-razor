# Renderer fetch 最小诊断候选

本轮交付可安装的临时 QA 构建，生产 transport 不变。宿主尚未执行本候选，
因此不能宣称目标 IP 的 fetch/CORS 或真实逐块读取已通过。

## 宿主正常 UI 操作

1. 专用测试库确认无活跃任务，保存原插件 main.js/styles.css/manifest.json。
   用 qa-plugin 中的三文件替换并重载。保留 data.json、prompts 与所有笔记；
   不同时启用两个相同 ID 插件副本。
2. 命令面板执行「QA：Fetch 无凭据连接与合成流检查（临时）」。
3. 手动输入用户已授权 IP 服务 origin，例如 http://IPv4:端口。
   不读取 provider 设置、不接受用户名密码、查询参数或任意路径。
4. 点击「单次无鉴权 GET /v1/models」，回传弹窗 JSON。
   只发一次 GET、无 Authorization/Cookie/API-key，credentials=omit、
   mode=cors、redirect=error；读取状态后取消 body，不解析或展示正文。
5. 点击「单次合成流（本机 fixture）」，回传第二份 JSON。
   Node HTTP 只创建绑定 127.0.0.1:18743 的临时合成服务，不做网络客户端或转发。
   Window.fetch GET 固定 /qa-stream；每 500ms 写合成 SSE 注释，共四次。
   fixture 的 Access-Control-Allow-Origin:* 只用于不含敏感数据的本地测试契约；
   不修改 Obsidian 或用户服务策略，不授予本地网络权限。
6. 任何检查最多 10 秒；取消按钮/关闭弹窗中止请求并关闭 fixture。
   端口冲突或策略拒绝就停止，不变换端口/协议、不开 no-cors、不改 TLS、
   webSecurity、CSP、代理，不自动重发或切换 transport。
7. 结束后恢复 production-plugin 的三文件并重载。

## 结果判断

- HEADERS_READABLE 与 401/403：无鉴权响应被 renderer 读取，认证拒绝符合预期。
  不证明带 Authorization 的 POST/CORS preflight 或模型请求可用。
- HEADERS_READABLE 与 2xx：同样只证明响应状态可读；未读取模型列表正文。
- STREAM_EOF 且 chunks > 1、chunkSpanMs > 0：支持该宿主实际逐块交付合成数据。
  块数不必恰好为 4，网络层可能合并；只有一块不算逐块交付通过。
- FETCH_REJECTED：可能是网络、CORS、CSP 或重定向拒绝，不能仅凭此分类原因。
  cspViolationObserved=true 是捕获到相关 connect-src 违规；false 不能排除 CSP。
- FIXTURE_UNAVAILABLE / FIXTURE_START_FAILED：当前宿主无法运行该合成 fixture。
  不降级为 Node fetch，也不借本机 fixture 成功外推用户 API 可流式运行。
- TIMEOUT / CANCELLED / READ_FAILED / SIZE_LIMIT：记录后停止；结果不含 URL、
  请求头、响应正文或原始异常。合成响应最多 64KiB，输出仅计数。

## 本容器完成的验证

15 项 Node 离线测试通过（含此前 6 项、此次新增 9 项）；覆盖无凭据且不读正文、
非法输入零分派、取消、错误脱敏无 fallback、合成流计数、fixture 启动失败和
正常命令 UI 显式触发。临时 QA bundle 构建成功。
源码生产路径和生产构建不变，main.js SHA256 仍为
f977d1e9e1c3fbce7301d7c4ce9c13ea014490fcbecba42a4bb927b0e41f4fb8。
此前完整回归 73 文件/890 测试保持独立证据，本轮仅改构建脚本与 QA 仪器，
未重新声称其为 fetch 真实宿主验收。未向用户 IP 发请求，未运行宿主网络实验。
首次新增 UI 测试存在语法笔误，修正后上述 15 项全部通过。

## 官方约束

- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
- https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
- https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

精确 IP 未写入交付物，操作员在已授权宿主手动输入。独立宿主回传两份白名单
JSON 后，才能判断是否继续设计生产显式选项。此包不是生产修复或自动回退方案。
