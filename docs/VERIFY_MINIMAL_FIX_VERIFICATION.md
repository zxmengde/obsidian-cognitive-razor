# Verify 三项最小修复与临时宿主诊断构建

基于 34db5ca 视觉候选，承接只读诊断提交 9c89ea9。未修改任何 UI、现有
提示词文件、笔记 schema、服务参数、流式传输实现或系统网络设置。

## 元信息兼容策略

Verify 改用 buildVerifyMetaContext，其他任务继续使用原有通用函数。
从 currentContent 快照中只读提取真实 frontmatter 字段，不从文件名、H1
或 name 推造 standard_name_cn/en。当前真实字段有 name/cruid/type/status/
created/updated/aliases/tags/parents/sourceUids；没有新增必填 schema。

显式旧 standard_name、standard_name_cn、standard_name_en 原值保留，
包括空字符串、null 与旧对象值。快照中显式键优先于 concept 上下文；只在
快照没有该键且 concept 明确提供对应值时保留旧上下文值。每个字段标记
frontmatter/task_context 来源；不存在的键不填空，无法解析不冒充缺失。
解析失败或循环 YAML 不能把任务元信息变成部分更新；原始快照仍完整提供。
这不是迁移或写回，既有笔记和用户自定义提示词文件不作修改。

回归覆盖：真实英文 name、缺失/空/null、旧中英文/对象值、旧 concept
空值与实际来源、非法 YAML，以及真实 Verify executor 使用自定义模板
仍保留自定义系统规则、完整正文、单次请求和自定义报告标题。

## 报告标题

外壳拥有“事实核查报告”标题。渲染时仅移除开头精确匹配的已知报告 heading
（事实核查报告/认识论审计报告，支持冒号/全角冒号/闭合 #）；正文内部、
代码块、未知自定义标题及带副标题的标题保留。兼容旧默认及自定义模板，
不要求覆盖用户 prompts，不改已经写入的历史报告。expanded/collapsed
均保留原边界与时间显示，恢复仍使用已完成阶段捕获的格式。

## 引用

按原始文本 UTF-16 注释位置，在注释范围或同一行紧邻锚点已有相同安全
HTTP(S) Markdown 链接时，保留原标签且不再次附加。只处理能可靠识别的
inline Markdown 链接；代码、图片、裸 URL 不冒充已有引用。不改模型正文，
不做全文 URL 去重。相同范围的不同来源仍保留；同来源不同结论仍保留。
重复 annotation 以位置和 URL 一起去重。无效位置与非 HTTP(S) 地址跳过。
回归覆盖前导空白、Unicode、重叠注释、转义标签、带标题链接、括号 URL、
代码块与多处就地证据。未知 Markdown 语法宁可保留重复也不删除内容。

## 独立临时诊断构建

生产 main.ts 没有诊断命令或导入。scripts/build-host-diagnostic.mjs 只在
独立输出目录通过构建时注入一条命令，生成 QA 专用 main.js。manifest
保持同一插件 ID（避免两个插件同时运行），名称标注 [QA diagnostic only]。
不要同时启用两份插件，也不要复制真实库到云端。

专用测试库确认无活跃任务后换入 QA 包的三个插件文件并重载，从正常命令
面板运行“QA：只读宿主传输诊断（临时）”。弹窗展示只读 JSON，可全选后
由 QA 回传。无需 DevTools/CLI，不打开历史日志，不触发模型调用。命令
仅查看白名单版本、process 类型、函数存在性和 NODE_USE_ENV_PROXY 标志。
不读 provider、代理地址或密钥，不发请求，不修改配置；有效代理路由仍
明确未知。Modal 使用 Obsidian 公共 API，不假定 Electron main API 可用。

结束后换回 production 包。交付脚本校验 production main.js 不含诊断命令
ID/schema 标记，QA main.js 含这两个标记。主构建与诊断构建分别有 SHA256。
诊断构建包含相同 Verify 修复，仅额外增加临时命令。该命令的 mock 覆盖
惰性采集、只读文本框和零请求；诊断脚本总计 6 项 Node 安全测试。

## 验证和边界

按要求执行 lint/check/check:test/full tests/build；详细结果与完整日志见
交付 PROVENANCE.json 和 validation。首次测试类型发现 fixture 漏填模型
capabilities，已补齐真实类型；独立 node:test 脚本改名为 .node-test.mjs，
避免被 Vitest 当作自己的测试载入，仍用 Node 独立执行。没有删减有效测试。

全程没有调用模型、读取用户凭据或更改系统代理/TLS。测试使用 mock 与
已有本地测试服务，不代表真实模型报告正确。待宿主 QA 复核三项实际报告
显示及诊断 JSON；流式网络路径根因仍待该结果，未被三项修复掩盖。
