# Verify 内容质量：只读证据与最小建议

范围：34db5ca 视觉候选的生产源码；未读取真实笔记、密钥、保存请求或模型
完整原始报告。真实症状来自独立 QA 回报；以下复现使用全合成数据。
时间错序已知来自 fixture 混合时区，不列为生产 bug。核心学习科学区分
合理或主要引用真实，均不代表整份报告通过事实核查。

## 已证实：Verify 注入了不属于真实 frontmatter 的空名称字段

调用链：workflow-coordinator.ts:218 启动 Verify 时解析有效 frontmatter，
name 保存为 artifact.noteTitle；:660 构造 payload 时只有 filePath、
currentContent、noteType、conversation，没有 concept。VerifyTaskExecutor
又在 verify-task-executor.ts 中把该 payload 交给 buildTaskMetaContext。

task-execution-support.ts:86–94 在 concept 不存在时仍生成
standard_name_cn=""、standard_name_en=""，type 使用 noteType。
frontmatter-utils.ts 的真实字段是 name、cruid、type 等，没有这两个
standard_name 字段。合成有效 name 笔记也稳定复现这两个空元信息键。
因此存在可证明的“上下文未提供 -> 注入空字段”混淆；它足以诱导“标准名称
为空”的诊断。未取得原始模型输入/输出，不能证明该句唯一由此产生。

最小建议：为 Verify 单独构造元信息，读取内容快照中的真实 frontmatter
name/cruid/type（不要解析双语 name 猜造中文/英文分栏），明确这是笔记
已有字段。未知/未提供的上下文键应省略或显式标识未提供，不能填空字符串
再让模型视为必填字段缺陷。不要直接改变所有任务共用的元信息函数。
明确字段清单与“字段不存在/存在但空/有效有值”的区别。格式有效性优先由
已有确定性 frontmatter 校验处理，模型不自行发明新的必填字段。

建议回归：已有有效 name 且 Verify payload 无 concept；只有英文 name；
空 name 与缺失 name 被现有入口拒绝；自定义额外字段不误当缺失；文件名、
H1 与 name 不一致时不自动判定事实冲突，仅在正文身份确有冲突时报告。

## 已证实：双标题来自提示词与外壳共同所有权

prompts/base/operations/verify.md 的 output_format 要求
“## 认识论审计报告:”。verification-report.ts:15 又无条件添加
“## 事实核查报告”。合成符合提示词的返回会稳定产生两条二级标题；
collapsed 模式也会保留模型标题叠加 callout 标题。不是模型必然多写标题。

最小建议：由报告外壳统一拥有标题，提示词从总体评估开始输出；兼容模型
或自定义旧提示词时，只归一化首个已知审计标题，保留真正的正文小节、
引用、代码块和未知标题，不全局删除 Markdown heading。不要改历史报告。

建议回归：expanded/collapsed 各只有一个报告标题；模型无标题、有已知
标题、未知标题、代码块内标题都不丢正文；原报告标记和 stripVerifyReport
边界继续有效；恢复重放不重新格式化已完成阶段。

## 可复现条件：短链接与完整题名链接重复附加

VerifyTaskExecutor 对模型原文调用 insertPositionedCitationLinks。
task-execution-support.ts:187–201 只校验并按 endIndex 倒序插入注释链接，
按 start/end 范围去重；不检查注释位置附近已经存在的同 URL Markdown 链接。
合成原文含短标签链接、同范围 citation 含完整题名时，得到两个同 URL 链接。
这证明实现能够产生该症状；没有实际原始 response+annotations，不能断言
QA 的每一处重复都是 renderer 造成，也可能模型已经重复。

最小建议：仅在注释锚点对应/紧邻现有同 URL 链接时避免再次附加，保留其
已有标签；不要按全文 URL 全局删除引用，避免后续独立主张失去就地证据。
位置必须始终相对原始文本处理，不先 trim 再使用 Provider 的位置索引。
同一处不同来源与同一来源在不同结论处仍应允许。先确定 adapter 提供的
位置语义，不猜原生引用标记的范围。

建议回归：短链接+同 URL annotation 不重复；不同 URL 同一结论保留；
同 URL 不同结论保留；相邻/重叠范围与前导空白位置准确；链接在代码块或
只是裸文本提到 URL 时不误删除；原文已重复则不宣称该函数能自动纠正。

## 尚未证实为代码缺陷：模型的内容判断尺度

- 文件名/H1 差异被推为概念歧义：没有找到“名称必须与文件名完全一致”的
  Verify 规则。CTX_CURRENT 含原始笔记，模型可能从中自行推断；应限制
  “格式/命名差异”与“概念身份矛盾”的混淆，不能由一个 fixture 重写命名体系。
- 机制完整性被说成 schema 错误：ontology_rules 确实要求检查机制因果链；
  共用 knowledge-policy 还泛称 API Schema 为硬约束。Verify 实际请求是
  Markdown 报告，并未传 structuredSchema。应明确本体检查是内容连贯性
  建议，不能把所有机制要素提升成笔记必填字段；真实 schema 只以提供的
  确定性字段契约为准。该提示词风险不证明模型每条机制建议都错误。
- 合成来源被判存疑：规则要求外部事实有证据，但没有明确区分演示说明与
  现实事实断言。可补范围边界：明确标注的示例不是被声称真实发生的事件；
  不应仅因其是示例而判事实存疑。不过示例中引用的真实研究、普遍规律和
  数值仍应核查，不给带 synthetic 标签的整篇内容事实豁免。

建议形成一小组合成评测：名称差异无身份冲突/有真实冲突、机制正文完整/
只简述但无错误、明确虚构演示/伪称真实事件、合成例子含真实可检验事实。
采用人工检查 rubric；普通单元测试只能确认提示词边界被送达，不能证明
模型内容判断正确。当前未调用模型、未改变默认结论或知识体系。

## 实测与下一步

临时 characterization 测试 3/3 通过，分别复现空名称元信息、双标题、
同 URL 重复附加。它们是现状证据，不是要求未来永久保留缺陷的回归断言。
测试源与日志随诊断补充包保存，未加入常规测试集合。

优先顺序：Verify 专用真实元信息 -> 标题单一所有权 -> 锚点局部引用去重。
本轮按要求只读检查，因此以上生产修复均未实施；流式诊断继续等待宿主
白名单 JSON，不受本次内容审查阻断。
