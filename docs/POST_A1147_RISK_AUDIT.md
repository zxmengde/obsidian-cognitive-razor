# a1147 后续风险审计与连接摘要修复

基线 a1147acd3911848a8d6b40b1add804caf7a4abb2；延续同一分支，不发真实API，
不读用户凭据/笔记，不改服务器、域名、安全、代理，不增加依赖或常规设置。

## 按优先级报告

1. **已修复：连接摘要暴露密钥片段。** ProviderCard 原先显示前4/后4字符；
   对短值这甚至覆盖全部字符。改为纯「已配置／未配置」，不保留片段、长度、
   title或data-key。原隐藏输入、设置值及正常编辑逻辑不变；不记录密钥。
   空值、单字符、长合成值3项实际组件测试通过，打开详情不触发网络探测。
2. **最高数据风险：组合恢复路径补测通过，未确证新业务缺陷。**
   - 并发双击Verify只接受一个；延迟runner活动期间用户编辑，取消后释放迟到结果；
     从序列化字节新建服务，不重发；明确发起新的Verify后只写一次报告，原实例
     与新实例均保留用户编辑，迟到结果不污染任何实例。
   - E206模拟断网后连续两次序列化重启，保持interrupted，不调用模型。
   - 生成期间编辑造成E320，付费结果持久保留；重启后本地重试只尝试应用缓存，
     继续报编辑冲突，不重新调用模型、不覆盖笔记。
   活动请求取消后为interrupted/E206，而非“确定未发送”的普通cancelled；
   新测试初次预期cancelled不符现有保守语义，校正为明确断言interrupted/E206。
   这不是生产缺陷，没有改状态机或放宽不丢编辑/不重发断言。
3. **域名/Cloudflare路径仍未实测，不能据IP成功宣告解决。**
   新增代理形态合成用例：BOM/CRLF/跨块中文及retry元数据不触发自动重连；
   上游心跳被缓冲、reader没有字节时仍idle超时；结束事件已到达但EOF前断流
   仍拒绝交付结果。均只一次分派。它们验证客户端语义，不模拟真正Cloudflare。

## 域名问题的证据与下一步边界

Cloudflare官方当前说明：524代表已连接源站但未在默认125秒读超时内及时收到响应；
还存在独立写超时原因。不能把524等同DNS失败，也不能把任何TypeError诊断成CORS。
来源：https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/

Cloudflare的官方压缩说明指出，响应的no-transform须由源站设置，不能靠客户端
请求头代替。本轮不添加所谓“解决缓冲”的请求头，不修改服务或Cloudflare规则。
来源：https://developers.cloudflare.com/speed/optimization/content/compression/

IP与域名可能经过不同的DNS/TLS/SNI、主机路由、代理和权限/CORS规则；现有证据
不足以定位其中哪一环。原域名由用户仅改URL后，协调方在同一正常UI、相同模型
参数下安排一次已授权任务。本代理不另开真实请求，不为抢取消时机重复调用。

复测优先看已有STREAM_RESPONSE_EVIDENCE与任务账本：

- SSE且多chunk、chunkSpanMs>0：支持本次分块SSE交付；不自动证明持续心跳。
- JSON：同请求完整JSON兼容成功；不能称远端SSE保活通过。
- firstResponseMs大：等待可访问响应头较久；firstChunkMs晚：首字节迟到。
  这些现象本身不能确定延迟发生在模型、源站还是中间层。
- phase=after-response的idle/read失败：收到过头不等于收到足够正文；未拿到完整
  响应时不会有完成事件，不能因此推断“没发送”。保持E206，禁止自动换通道重发。
- dispatchCount=1是每次应用层尝试，自动OPTIONS不算模型调用；任务总次数看账本。

没有回传真实URL、Authorization、正文或原始header；域名仍由协调方验收。

## 验证与交付

本轮新增9测试：3组合恢复、3代理形态、3密钥摘要。完整回归75文件/928测试通过；
另外7项QA构建集成与22项诊断脚本通过；lint、check、check:test、build通过。
生产代码仅改连接摘要及本地化文本；无新增测试命令进入正式bundle。
模拟崩溃是序列化重建/故障注入，不是断电、真实文件系统或真实Obsidian缓存验收。

同一Library交付包更新版本；包含当前production-plugin.zip、准确Git源码、日志、
本报告、上一版rollback-a1147-plugin.zip及此前保留的旧版rollback-production-plugin.zip。需要撤销本轮摘要修复时优先用a1147回退包。安装时无活跃任务，仅替换插件三文件，
保留data.json/prompts/笔记。普通配置和默认Node不变。原正式整合说明存于
PRODUCTION_GUIDE.md（其中919是此前a1147的历史测试数，以本报告928为最新）。
未推送GitHub、合并或部署。
