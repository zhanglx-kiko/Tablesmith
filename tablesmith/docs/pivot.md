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

## 与 Excel 对照的测试

`src/services/pivot.test.ts` 用 `scripts/excel-pivot-reference.ps1` 调用本机 Excel 生成 `sample-data/excel-reference/pivot_cases.json` 中的透视表，然后逐格比较，差值超过 1e-9（相对值）就失败，多出的格子也算失败。用例覆盖求和、计数、平均值、最大值、最小值、两级行字段和页字段筛选。参考数据来自用户本机的真实文件，输出在已忽略的 `src-tauri/target/excel-reference/` 下；没有这些文件时这组测试自动跳过。

重新生成参考数据：

```powershell
pwsh -NoProfile -File scripts/excel-pivot-reference.ps1 D:\tmp\excel\sales_detail.csv sample-data\excel-reference\pivot_cases.json src-tauri\target\excel-reference\pivot_sales.json
```
