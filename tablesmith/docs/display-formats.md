# 单元格原始值与显示格式

## 红线：导入不改变任何原始值

原始值（`SheetData.rows`）是所有计算、筛选、透视、导出的依据，必须与文件中存储的值完全相同：

| 单元格类型 | 原始值 |
|---|---|
| 数字 | 文件里的双精度数的最短精确十进制（`45351.57326388889`、`0.30000000000000004`），读回来是同一个数 |
| 文本 | 与 Excel 打开后一致：前导零 `00892`、长编号 `2026110488921001`、中间空格、换行都保留；首尾空格只在文件标记 `xml:space="preserve"` 时保留（Excel 自己的规则，实测见 `text_whitespace.xlsx.json`） |
| 布尔 | `TRUE` / `FALSE` |
| 日期 / 时间 | 序列号对应的标准日期文本：整天 `2024-01-31`，小于 1 天 `13:45:41`，其余 `2024-01-31 13:45:41` |
| 公式错误 | 错误码文本（`#DIV/0!`） |

「是不是日期」只看单元格真实的数字格式（日期 / 时间格式），两条读取路径用同一判断（`classifyDates`，normalize.ts）。

`rawValues.test.ts` 逐格对比桌面 Excel 以手动计算模式打开同一文件时的 `Value2`（`sample-data/excel-reference/<文件名>.json`，即文件里存的值，不是重算结果），并用 `scripts/check-raw-value-guard.py` 变异检查确认：四舍五入、去前导零、用显示值替代原始值、日期偏移一天，都会让测试失败。

## 显示值

`SheetData.display` 与 `rows` 同形，存 Excel 实际显示的文字（`$28,975,558`、`61.4%`、`2024年1月31日`）；与原始值相同时为 `null`，整张表没有格式时省略。显示值只用于展示，不参与任何计算。

- 有数字格式的单元格：按格式代码渲染（numberFormat.ts），对照桌面 Excel（zh-CN）的 `Range.Text` 逐格验证，见 `display.test.ts`、`numberFormat.test.ts`。
- 「常规」格式的数字：按 Excel 默认列宽规则显示（最多 11 个字符，放不下改科学计数：`3.14159265358979` → `3.141592654`）。
- Excel 显示 `####` 的情况（负数日期、超长分数）显示为 `############`。

### 内置格式编号

文件里多数格式以编号存储（14 = 日期）。zh-CN Excel 对部分编号的解释与英文版不同（14 = `yyyy/m/d`，27–36、50–58 = 中文日期），编号表 `BUILTIN_FORMATS_ZH_CN` 实测自本机 Excel（`scripts/generate-builtin-formats.py` + `scripts/excel-reference.ps1`）。

## 读取路径

| 文件 | 读取 | 格式代码来源 |
|---|---|---|
| xlsx / xlsm | Rust calamine | `xlsx_formats.rs` 解析 styles.xml 与每个 `<c s="…">` |
| xlsb（Excel 保存） | Rust calamine | `binary_formats.rs` 解析 styles.bin 与单元格记录；也补读合并单元格与 calamine 丢弃的公式错误 |
| xls（BIFF8） | Rust calamine | `binary_formats.rs` 解析 FORMAT / XF / 单元格记录 |
| ods、calamine 读不全的 xlsb（SheetJS 写出）| SheetJS（兜底） | SheetJS 的 `z`；zh-CN 中文日期内置编号拿不到，这些单元格保留存储的数字并在导入说明里提示 |
| CSV / TSV / JSON / XML / YAML | 文本解析 | 无格式，原样显示 |

两条路径的一致性（`parity.test.ts`）：表名、表头、行数、每个原始值必须一致；唯一允许的差异是兜底路径拿不到中文日期内置格式时，原始值是序列号本身而桌面路径是该序列号的日期文本。

## 表格中的切换

表格底部状态栏的「Excel 格式 / 原始值」分段按钮（全局偏好，持久化在 `tablesmith_value_mode`，默认 Excel 格式），只在工作表带有 Excel 数字格式时显示。

- Excel 格式：单元格显示 `display`，悬停显示「原始值：28975557.700000003」。
- 原始值：单元格显示 `rows`，悬停显示「Excel 显示：$28,975,558」。
- 某个单元格的显示值与原始值相同时没有悬停提示。

## 筛选、排序、计算与导出

状态栏同一行写明口径：「排序、数值筛选和计算按原始值；文本筛选按单元格显示的文字」。

- 数值列（多数单元格是数字）：筛选用数字比较原始值。`61.4%` 的原始值是 0.614…，「大于 0.61」保留它，「大于 61」不保留。
- 文本列：按单元格当前显示的文字匹配（与 Excel 自动筛选一致）。
- 排序、数据处理（去重、筛选、计算列、透视、脱敏）：按原始值。
- 数据处理改变了某个单元格的原始值（脱敏、去空格）时，该单元格的显示值清空，原值不会通过 Excel 文字露出；只删除或重排行列的操作，显示值跟随原始值移动（`selectRows` / `withRows` / `selectColumns`，dataProcessService.ts）。
- 导出：导出对话框在带格式的工作表上提供「导出内容」：
  - 原始值（默认）：数字保留完整精度；xlsx 中能精确还原为同一数字的文本写成数字单元格，`00892`、16 位以上的整数编号、`61.4%` 这类文本仍是文本（`exactNumber`，fileService.ts）。
  - Excel 显示的文字：写出 `$28,975,558`、`61.4%` 等文本，不能再参与计算。
- 导出 xlsx 时工作表名按 Excel 规则处理（最多 31 个 UTF-16 字符，去掉 `: \ / ? * [ ]`），只影响标签名，不改单元格。

## 验证

| 测试 | 内容 |
|---|---|
| `rawValues.test.ts` | 原始值逐格等于 Excel 存储值（含真实财务模型 84,000+ 单元格），变异检查见 `scripts/check-raw-value-guard.py` |
| `display.test.ts`、`numberFormat.test.ts` | 显示值逐格等于 Excel `Range.Text` |
| `displayOps.test.ts` | 在财务模型上做筛选、去重、删空行、删列、脱敏、去空格后，显示值仍对应自己的原始值；脱敏后原值不可见 |
| `exportRoundTrip.test.ts` | 财务模型全部工作表导出 json / csv / yaml / xlsx / sql 再读回，每个原始值不变 |
| `tools/verify-display-e2e.cjs` | 真实 exe：两种模式的显示与 Excel 一致、悬停、偏好持久化、数值筛选按原始值、导出选项 |
