# 第二阶段：固定无效 Authorization 头形状 QA

已收到真实宿主结果：无鉴权 GET /v1/models，401、415ms、HEADERS_READABLE、
readable=true、cspViolationObserved=false，未读正文。它证明该次 GET 响应可读；
未观测到 CSP 事件不是“无 CSP 限制”的证明。另收到真实宿主合成流通过：200、4 chunks、52 bytes、STREAM_EOF、chunkSpanMs=1499、durationMs=2031。两项各一次分派，无模型请求。新构建仍要求同一弹窗重跑本地合成流以解锁，避免沿用其他宿主/会话的 gate。

## 可以交给宿主执行的最小候选

临时构建保留原两个按钮，并新增「合成流通过后：无效占位 Authorization 检查」。
新按钮默认禁用；同一弹窗必须先通过 STREAM_EOF、chunks>1、chunkSpanMs>0，
才解锁。关闭弹窗后不保存 gate，不增加常规设置或修改生产 transport。
操作员仅输入同一个已授权 IPv4 服务 origin；不从设置中提取端点或凭据。

新按钮只执行一次 GET /v1/models，无 body，固定头：

    Authorization: Bearer cognitive-razor-invalid-qa-placeholder
    Content-Type: application/json

它不含真实秘密；不接受用户填写 token，不读取 apiKey，不请求任何推理路由。
credentials=omit、mode=cors、redirect=error、cache=no-store、no-referrer。
只记录状态和白名单阶段/计数，立即取消响应体；不解析或回显正文/原始异常。
预期为可读的 401/403；若收到其他状态，仅记录，不继续升级到真实模型调用。
浏览器可能自动发 CORS OPTIONS；不手工伪造受限预检头。GET 头许可成功
不证明 POST 方法、推理路径或真实认证条件下的 CORS 策略相同。

## 生命周期与不确定性

总时限 10 秒，空闲时限 2 秒：从分派开始计时，响应头与非空 chunk 续空闲
时限，空 chunk 不续；总时限不延长。关闭弹窗/取消按钮会 abort。
晚到响应在已取消时不能变成可读成功，reader/计时器/fixture 均清理。
requestOutcome=not-dispatched 表示未分派；unknown-after-dispatch 表示没有
取得可用响应；response-received 只表示收到响应头，不等于业务完成。
before-response/after-response 与 IDLE_TIMEOUT/CANCELLED/FETCH_REJECTED/
READ_FAILED 独立记录。不从 TypeError 或取消推断服务端未处理，不自动重试。
未来生产流式若在分派后无法确认完整业务结果，应保持 E206/uncertain 语义，
包括已收到头或部分正文的情况，不能借此探测分类改变已有任务重试策略。

## 不增加设置复杂度的后续候选

本轮仅 QA 命令内显式选择，生命周期限于该弹窗，不写设置、不碰生产 runner。
只有宿主本地流和头形状两关通过，才考虑下一份受控构建：利用既有
streamRequester 注入点为一个明确测试请求选择 renderer-fetch；请求发送前
固定 transport，不在失败时 fallback，不全局替换 Node，不改原可用服务。
真实认证 POST/模型验证需要独立的明确授权，本轮没有执行或准备自动执行它。

## 跨平台与验收边界

- 本次宿主观测不能推广到其他 Obsidian/Electron/操作系统版本或其他服务。
- 浏览器 fetch/ReadableStream 存在不等于目标 CORS/CSP/网络权限允许；HTTP
  混合内容、localhost 权限、证书策略及中间层缓冲仍可能不同。
- 本地合成服务依赖桌面 Node HTTP createServer；移动端或无该能力的沙箱
  明确报 FIXTURE_UNAVAILABLE，不换成 Node 网络客户端、私有 Electron API。
- QA 输入暂限 IPv4；不代表生产最终支持范围。不因该限制修改用户已有域名、
  HTTPS 或 IPv6 配置。现有 Node transport 服务保持原样。
- 此前 NODE_USE_ENV_PROXY=false 不等于实际 Chromium 或 Node 没有代理。
- 不修改服务 CORS、webSecurity、TLS、代理或宿主权限；失败即回传白名单结果。

22 项离线诊断测试通过，含 gate、固定头无正文、取消/迟到头、两个阶段空闲
超时、空 chunk 不续时、心跳超过空闲阈值仍可读、并发隔离和保守未知分类。
临时 QA 构建成功。生产 main.js 不变，哈希仍为
f977d1e9e1c3fbce7301d7c4ce9c13ea014490fcbecba42a4bb927b0e41f4fb8。
这些 mock 不模拟真实浏览器 CORS/preflight，不是第二阶段宿主通过证据。
本容器未访问用户 IP 或读取任何真实密钥，未推送/合并/部署。
