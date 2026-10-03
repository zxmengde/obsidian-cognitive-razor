# 显式单次 renderer-fetch 流式 QA 候选

本包是临时测试构建，不是生产默认切换。生产恢复包与此前 481ab3c 构建字节一致。

## 已有证据与本轮边界

真实宿主已通过：无鉴权 GET /v1/models 返回可读 401；固定无效 Authorization
头形状 GET 返回可读 401（640ms）；本地合成流 200、4 chunks、约1500ms块跨度。
它们不证明真实认证 POST、用户服务 SSE 全链、代理行为或其他平台可用。
本容器仅执行合成数据/mock，不读取用户密钥，不访问用户 API。
新的真实模型调用只由宿主操作员从正常任务 UI 发起；会使用现有连接与密钥，
可能产生正常模型费用。QA 命令本身不读取连接、不发送请求、不增加密钥入口。

## 最小实测步骤

1. 在专用测试库确认没有活跃任务，备份当前 main.js/styles.css/manifest.json，
   用 qa-plugin.zip 的三文件替换并重载。保留 data.json、prompts、笔记。
2. 使用已配置、已授权的同一个服务和模型，不修改模型/输出/推理参数。
   无需打开持久化的“流式保活”设置：QA 构建仅对被允许的聊天强制 stream=true。
3. 命令面板执行「QA：允许下一次聊天使用 renderer-fetch 流式（单次）」。
   出现允许通知后，仅从正常任务 UI 对一篇合成测试笔记执行一次 Verify。
   不在期间点击连接测试或启动其他聊天任务，它们也会消耗这一次允许。
4. 观察最终任务状态、请求计数、报告完整性。记录完成/失败代码和安全诊断字段；
   不回传请求头、密钥、正文或原始网络日志。失败后不自动或直接重复运行；
   先判断是否 E206/结果未知。请求数必须为1，transport失败诊断应是renderer-fetch。
5. 可另行明确允许一次测试来验证取消；取消/超时/断流不得写入部分结果。
   多阶段创建任务不是本次最小验收目标：只允许一次聊天，下一阶段将被QA gate拒绝，
   不会静默继续调用。每次新聊天都必须再执行允许命令；重载不保留允许。
6. 测试结束、没有活跃任务后换回 production-plugin.zip 并重载；QA命令应消失。
   生产设置、默认 Node transport 均保持原样。

## 实现与保护

- 新适配器仅被 QA 构建入口引用。构建时精确改写 ProviderManager 注入点及
  dispatchChat；生产源文件不改。集成测试使用与打包相同的改写函数。
- gate在构造请求/记账分派前消耗，transport在发送前固定为renderer-fetch。
  未允许时没有网络分派；运行中不能再次允许。finally释放busy，不自动重新允许。
- QA聊天绕过自动重试分支，包括明确 server_error；不会转为 Node/requestUrl。
  原有嵌入路径未修改，因此首次验收限定单项Verify，不触发额外工作流。
- 通过现有配置与协议组装 POST/body/auth，复用现有 SSE聚合、完整JSON兼容、
  finishReason校验、记账及任务落盘保护；不改输出/推理参数，不交付流式部分结果。
- Window.fetch 使用 cors、credentials=omit、redirect=error、no-store、no-referrer。
  保留应用明确提供的 Authorization；拒绝浏览器禁止头，不复制 Node 的
  Connection/Accept-Encoding。CORS/CSP/TLS/权限拒绝原样失败，不绕过。
- idle沿用 providerTimeoutMs，从发出等待响应头起计时；响应头和非空字节续时，
  空chunk不续。原QA包的独立总时限为10分钟；2026-10-03起当前生产默认改为
  该次 providerTimeoutMs，显式 totalTimeoutMs 仅供有界诊断/adapter测试覆盖。
  保活不延长总时限。响应上限8MiB；现有任务级超时可能更早取消。
- 取消、卸载、idle/total超时及时settle并abort；即使mock fetch不合作也不阻塞，
  迟到头/字节不能变成成功，清理listener/timer/reader。
- fetch拒绝/读流失败只保留安全错误和阶段，无原始异常；E206不推断未发送。
  QA流式HTTP错误映射只使用状态，不把上游错误正文复制到诊断details。
  timeout详情包括renderer-fetch和idle/total；网络错误不能被误标成node-http。

## 原 QA 候选验证（历史包）

以下记录属于原 QA 候选包；902 项等数字及旧包 SHA256 不是本轮独立
总时限修正后的新验证或构建证据。当前候选须另行报告合成专项、整体回归
与宿主验收，不把这些历史结果自动继承为通过。

- lint、check、check:test、QA专用类型检查、生产build均通过。
- 全量：74文件/902项测试通过（含新增12项adapter测试）。
- 实际QA改写后的ProviderManager：7项集成测试通过；验证未允许零分派、
  正常配置认证POST、共享SSE解析、单次消耗、明确错误不自动重试、CORS式
  拒绝E206、取消、读流失败，以及HTTP错误正文不进诊断。
- 原独立诊断脚本22项测试通过。QA bundle构建通过。
- 生产 main.js SHA256仍为
  f977d1e9e1c3fbce7301d7c4ce9c13ea014490fcbecba42a4bb927b0e41f4fb8。

未声称新的真实POST/SSE模型任务已通过。renderer fetch 的CORS策略、混合内容、
权限、证书、压缩/代理缓冲及后台计时器行为须逐宿主/逐服务验收；当前桌面观测
不能推广到移动端或其他平台。不全平台替换原可用Node服务，不新增常规设置。
未推送、合并或部署。
