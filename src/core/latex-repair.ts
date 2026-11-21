/**
 * 静默修复模型输出中的常见 LaTeX 格式损坏与非 Obsidian 定界符，
 * 避免 JSON 转义遗漏或 \(...\)/\[...\] 导致笔记公式无法渲染。
 */

// 匹配 fenced code block（``` 或 ~~~）或 inline code span（`...`）
const CODE_SEGMENT_RE = /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3[ \t]*(?=\n|$)|(`+)([^\n`]|(?<!`)\n(?!`))*?\4/g;

// JSON 解析将单反斜杠 LaTeX 命令误转义为控制字符时（已吃掉首字母 t/r/n），限定后缀白名单安全还原。
const TAB_LATEX_SUFFIX = "ext(?:bf|it|rm|tt|sf|sc|style|normal)?|heta|imes|au|ilde|o|op|riangle(?:down|left|right)?|an|anh|frac|binom|herefore|iny|ag";
const CR_LATEX_SUFFIX = "ight(?:arrow|harpoonup|harpoondown|leftharpoons|squigarrow)?|ho|angle|ceil|floor|ef|m|brace|brack|estriction|vert|Vert";
const NL_LATEX_SUFFIX = "eq|e|abla|u|otin|ot|i|exists|sim|less|gtr|mid|parallel|vdash|Models|atural|earrow|warrow";

const TAB_LATEX_CMD_RE = new RegExp(`\\t(${TAB_LATEX_SUFFIX})(?![a-zA-Z])`, "g");
const CR_LATEX_CMD_RE = new RegExp(`\\r(?!\\n)(${CR_LATEX_SUFFIX})(?![a-zA-Z])`, "g");
const INLINE_NL_LATEX_CMD_RE = new RegExp(`\\n(${NL_LATEX_SUFFIX})(?![a-zA-Z])`, "g");

// 匹配块级公式 $$...$$ 或行内公式 $...$（允许行内被 JSON \n 误断的已知 LaTeX 命令，但不跨越普通段落换行）
const MATH_SEGMENT_RE = new RegExp(
  `\\$\\$[\\s\\S]+?\\$\\$|(?<!\\\\)\\$(?!\\$)(?:\\\\.|[^$\\\\\\n]|\\n(?=(?:${NL_LATEX_SUFFIX})(?![a-zA-Z])))+(?<!\\\\)\\$`,
  "g",
);

// 块级 \[...\]：必须位于行首或空白/中文标点后（排除 E\[X\] 这类 Markdown 转义方括号），且内部包含公式特征或换行。
const BLOCK_BRACKET_MATH_RE = /(^|[\s\n，。；：！？(（])\\\[([\s\S]+?)\\\](?=$|[\s\n，。；：！？)）.,;:])/g;
// 行内 \(...\)：单行非空公式，排除反斜杠转义冲突。
const INLINE_PAREN_MATH_RE = /\\\(([^\n]+?)\\\)/g;

const MATH_SIGNAL_RE = /\\[a-zA-Z]+|[=^_+<>∑∏∫∞±×÷≠≤≥≈∈∉⊂⊃∪∩]|[\n]/;

function repairMathBody(segment: string): string {
  const isBlock = segment.startsWith("$$");
  let next = segment
    .replace(TAB_LATEX_CMD_RE, "\\t$1")
    .replace(CR_LATEX_CMD_RE, "\\r$1");
  if (!isBlock) {
    next = next.replace(INLINE_NL_LATEX_CMD_RE, "\\n$1");
  }
  return next;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** 还原被 JSON 解析吃掉反斜杠的 \f (0x0C) 与 \b (0x08) 控制字符，避免正则触发 no-control-regex。 */
function repairControlCharEscapes(segment: string): string {
  if (!segment.includes("\f") && !segment.includes("\b")) {
    let hasBackspace = false;
    for (let i = 0; i < segment.length; i += 1) {
      const code = segment.charCodeAt(i);
      if (code === 0x0c || code === 0x08) {
        hasBackspace = true;
        break;
      }
    }
    if (!hasBackspace) return segment;
  }
  let out = "";
  let last = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if ((code === 0x0c || code === 0x08) && i + 1 < segment.length && isAsciiLetter(segment.charCodeAt(i + 1))) {
      out += segment.slice(last, i) + (code === 0x0c ? "\\f" : "\\b");
      last = i + 1;
    }
  }
  return last === 0 ? segment : out + segment.slice(last);
}

function repairPlainSegment(segment: string): string {
  // 1. \f (0x0C) 与 \b (0x08) 在正常 Markdown 正文中不会出现；紧跟英文字母时几乎必定是 \frac/\beta/\begin 等漏写双反斜杠。
  let next = repairControlCharEscapes(segment);

  // 2. 将非 Obsidian 块级定界符 \[...\] 转为独立行 $$...$$
  next = next.replace(BLOCK_BRACKET_MATH_RE, (full, prefix: string, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed || trimmed.includes("\\[") || !MATH_SIGNAL_RE.test(trimmed)) {
      return full;
    }
    const leadingBreak = prefix === "" || prefix.endsWith("\n") ? prefix : `${prefix}\n`;
    return `${leadingBreak}$$\n${trimmed}\n$$`;
  });

  // 3. 将非 Obsidian 行内定界符 \(...\) 转为 $...$
  next = next.replace(INLINE_PAREN_MATH_RE, (full, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed || trimmed.includes("\\(") || trimmed.includes("\\)")) {
      return full;
    }
    return `$${trimmed}$`;
  });

  // 4. 在所有公式区块内还原被 JSON 吃掉反斜杠的 \t、\r 与行内 \n LaTeX 命令。
  next = next.replace(MATH_SEGMENT_RE, (mathSegment) => repairMathBody(mathSegment));

  return next;
}

/**
 * 静默修复文本中的 LaTeX 控制字符损坏和非美元定界符，严格跳过代码块与行内代码。
 */
export function repairLatexText(input: string): { text: string; repaired: boolean } {
  if (!input) return { text: input, repaired: false };

  // 快速短路：没有任何控制字符、反斜杠定界符或公式符号时直接返回，零额外分配。
  if (
    !input.includes("\f")
    && !input.includes("\x08")
    && !input.includes("\\(")
    && !input.includes("\\[")
    && !input.includes("$")
  ) {
    return { text: input, repaired: false };
  }

  let output = "";
  let lastIndex = 0;
  CODE_SEGMENT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_SEGMENT_RE.exec(input)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      output += repairPlainSegment(input.slice(lastIndex, matchStart));
    }
    output += match[0];
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < input.length) {
    output += repairPlainSegment(input.slice(lastIndex));
  }

  return { text: output, repaired: output !== input };
}

const SKIP_JSON_KEYS = new Set(["stage", "url", "cruid", "type", "status", "source"]);

/**
 * 递归修复已通过 Schema 校验的 JSON 结果中的字符串字段。
 */
export function repairLatexInJsonValue<T>(value: T): { value: T; repairedCount: number } {
  let repairedCount = 0;

  const visit = (node: unknown, key?: string): unknown => {
    if (typeof node === "string") {
      if (key && SKIP_JSON_KEYS.has(key)) return node;
      const result = repairLatexText(node);
      if (result.repaired) repairedCount += 1;
      return result.text;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const mapped = node.map((item) => {
        const next = visit(item);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? mapped : node;
    }
    if (node !== null && typeof node === "object") {
      let changed = false;
      const entries = Object.entries(node as Record<string, unknown>);
      const nextObj: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of entries) {
        const nextValue = visit(entryValue, entryKey);
        if (nextValue !== entryValue) changed = true;
        nextObj[entryKey] = nextValue;
      }
      return changed ? nextObj : node;
    }
    return node;
  };

  const repaired = visit(value) as T;
  return { value: repaired, repairedCount };
}

/**
 * 静默剥离模型在纯 Markdown 卡片外层误套的单层 ```markdown / ```md / ``` 围栏。
 * 若内部仍包含未闭合围栏或外层指定了非 Markdown 语言（如 ```json），保持原样交由校验拦截。
 */
export function unwrapMarkdownCodeFence(input: string): { markdown: string; unwrapped: boolean } {
  const trimmed = input.trim();
  const openMatch = /^(`{3,})[ \t]*(markdown|md)?[ \t]*\r?\n/i.exec(trimmed);
  if (!openMatch) return { markdown: trimmed, unwrapped: false };

  const fence = openMatch[1];
  const closeRe = new RegExp(`\\r?\\n${fence}[ \\t]*$`);
  if (!closeRe.test(trimmed)) return { markdown: trimmed, unwrapped: false };

  const inner = trimmed.slice(openMatch[0].length).replace(closeRe, "").trim();
  if (!inner) return { markdown: trimmed, unwrapped: false };

  // 确保外层是包裹整段输出的单一围栏，而不是开头一个小代码块后接正文。
  const innerLines = inner.split(/\r?\n/);
  let inNestedFence = false;
  for (const line of innerLines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith(fence)) {
      const rest = trimmedLine.slice(fence.length).trim();
      if (!inNestedFence) {
        if (!rest) {
          // 遇到与外层同长度的裸闭合围栏，说明首尾不是同一对围栏。
          return { markdown: trimmed, unwrapped: false };
        }
        inNestedFence = true;
      } else if (!rest) {
        inNestedFence = false;
      }
    }
  }
  if (inNestedFence) return { markdown: trimmed, unwrapped: false };

  return { markdown: inner, unwrapped: true };
}
