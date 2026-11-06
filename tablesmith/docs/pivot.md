# 数据透视表

透视结果按桌面 Excel 数据透视表的口径计算，可以逐格对照。

## 计算口径

- 求和、平均值、最大值、最小值只计数值单元格。带千分位、货币符号或会计括号的文本（`1,200`、`$30`、`(5)`）按数值计算，`12%` 按 0.12 计算，其余文本跳过。只有文本的格子：求和显示 0，其他显示空白。
- 计数和非重复计数统计非空单元格。
- 总计行和总计列直接用全部源值重新聚合，不对小计再做一次聚合。所以平均值的总计是全部明细的平均值，不是各组平均值的平均。
- 结果不四舍五入，保留完整的双精度值。
- 没有源数据的格子留空，不填 0 或 `-`。
- 只有列字段时才显示右侧的“总计”列；没有列字段时只有一个值列，名字是“求和项:字段名”这类形式，和 Excel 一致。
- 百分比方式（占总计、占行、占列）的原始值存小数（0.1234），表格显示为 `12.34%`，和 Excel 中设成百分比格式的单元格一样。导出时可以选原始值或显示文本。
- 透视只生成新表，不修改源数据。

## 查看明细

透视结果显示在右侧表格时，双击任一数值格（包括总计行、总计列和右下角的总计）打开明细窗口，列出算出这个数的全部源数据行，与 Excel 双击透视表数值的“显示详细信息”一致：

- 普通格列出同时属于该行分组和列分组的行；总计列出整行、整列或整张表的行；有页字段筛选时只含筛选后的行。
- 计数只统计非空值，但明细和 Excel 一样列出组内所有行（值为空或文本的行也在内）。
- 行按源数据顺序排列，保留原始值、Excel 显示格式和公式，源数据不变。
- 标签格、空白格双击无反应；按 Esc 或点遮罩关闭。“另存为新工作表”把明细作为新工作表加入当前文件，名称形如 `Sheet1_明细(region=West · sales_channel=Marketplace)`。

实现：`pivotTableService.ts` 的 `generatePivotTableWithMeta` 为每个输出格记下源行号（`sources`），`pivotCellDetail` 取出这些行；界面在 `components/PivotDetailModal.tsx`。

## 与 Excel 对照的测试

`src/services/pivot.test.ts` 用 `scripts/excel-pivot-reference.ps1` 调用本机 Excel 生成 `sample-data/excel-reference/pivot_cases.json` 中的透视表，然后逐格比较，差值超过 1e-9（相对值）就失败，多出的格子也算失败。用例覆盖求和、计数、平均值、最大值、最小值、两级行字段和页字段筛选。参考数据来自用户本机的真实文件，输出在已忽略的 `src-tauri/target/excel-reference/` 下；没有这些文件时这组测试自动跳过。

明细由 `scripts/excel-pivot-detail.ps1` 对照：它在同样的透视表上对每个数值格执行 Excel 的 ShowDetail，记下 Excel 列出的 `sale_id`，测试要求每个格子（含总计）的明细行集合完全相同。`tools/verify-pivot-drill-e2e.cjs` 在真实 exe 中双击普通格、行总计、列总计和总计，与直接统计 CSV 原文得到的行和金额比较，并检查另存为新工作表、标签格无反应和源数据不变。

重新生成参考数据：

```powershell
pwsh -NoProfile -File scripts/excel-pivot-reference.ps1 D:\tmp\excel\sales_detail.csv sample-data\excel-reference\pivot_cases.json src-tauri\target\excel-reference\pivot_sales.json
pwsh -NoProfile -File scripts/excel-pivot-detail.ps1 D:\tmp\excel\sales_detail.csv sample-data\excel-reference\pivot_cases.json src-tauri\target\excel-reference\pivot_detail_sales.json
```
