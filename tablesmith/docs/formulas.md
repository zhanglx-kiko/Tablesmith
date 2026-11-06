# 公式

从 xlsx / xlsm / xls / xlsb 导入时，每个单元格除了值，还带上它在 Excel 里的公式（`SheetData.formulas`，与 `rows` 同形，没有公式的格子为 `null`）。值仍是 Excel 上次计算的结果，表匠不重算公式，所以原始值不变。

## 在哪里看

- 表格里由公式算出的单元格右上角有绿色小角标。
- 鼠标悬停显示 `公式：=B2*C2`，与 Excel 格式 / 原始值的提示一起显示。
- 单击单元格，表格上方的公式栏显示它的公式（没有公式时显示值），可以选中复制。
- 数据体检的「公式列里手填的值」会列出公式列中被直接填了数的行，见 [health-check.md](health-check.md)。

表头行的公式不显示（表头是列名）；`=""` 只是把格子清空，也不显示。

## 公式文本

与 Excel 编辑栏里看到的一致（英文函数名、`$` 绝对引用、带引号的工作表名 `'Rate''s & FX'!$A$2`）。旧式数组公式（Ctrl+Shift+Enter）在区域的每个格子都显示同一个公式，与 Excel 一样。

读取路径：xlsx 由 Rust（calamine）读取；xls / xlsb 由前端 SheetJS 读取，因为 calamine 对这两种二进制格式的公式解码不完整（共享公式丢失、新函数显示为 `_xlfn.`、工作表名错误）。

## 处理后的公式

公式跟着它的格子走：排序、筛选、去重、删列、关联、追加之后仍显示在原来的值旁边。值被改动的格子（去空格、脱敏）不再显示公式，因为新值已不是公式算出来的。计算列和透视表生成的新值没有公式。

## 验证

`scripts/excel-formula-fixture.ps1` 让本机 Excel 生成 `sample-data/edge-cases/formulas.{xlsx,xls,xlsb}`（下拉填充的共享公式、被手填数覆盖的两行、跨表引用、带引号的字符串、错误结果、数组公式、表头公式），并把 Excel 报告的每个公式写入 `sample-data/excel-reference/formulas.json`。`formulas.test.ts` 在三种格式、两条读取路径上逐格比较，Rust 测试 `reads_xlsx_formulas_like_excel` 比较 calamine 的输出。真实财务模型（3,329 个公式）上 calamine 与 SheetJS 的公式逐格一致。
