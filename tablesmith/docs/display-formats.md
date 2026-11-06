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

表格右上角切换「Excel 格式 / 原始值」（全局偏好，持久化）。任一模式下鼠标悬停单元格显示另一种值。

## 筛选、排序与导出

- 筛选：按单元格当前显示的文字匹配（与 Excel 自动筛选一致）；数值比较（大于、介于）按原始值。
- 排序：按原始值。
- 导出：始终导出原始值。
