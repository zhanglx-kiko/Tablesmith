# 去重、计算列与筛选的规则

这三个操作的结果与桌面 Excel 逐行一致，由 `src/services/processOps.test.ts` 对照 Excel 的真实结果测试。所有操作都只生成新表，不改源数据。

## 什么算数字

整个单元格是一个数时才算数字，规则与 Excel 打开 CSV 时一样：可以有正负号、货币符号（`$ ¥ € £ ₩ ฿`）、三位一组的千分位、小数、科学计数和结尾的 `%`；`(5)` 是会计写法的 -5；`12%` 是 0.12。`2024-01-31`、`12abc`、`1.2.3`、`1,2,3` 都不是数字。比 Excel 最大值（9.99999999999999E+307）更大的数按文本处理。这条规则也用于透视表、图表和报表统计。

## 删除重复项

与 Excel 的「删除重复项」一样，保留每组的第一行，按 Excel 显示的值判断是否相同：

- 文本不分大小写：`Alice` 与 `alice` 是重复项。
- 普通数字按值比较：`1`、`1.0`、`+1` 是重复项，`(5)` 与 `-5` 是重复项。
- 日期按日期比较：`2024/1/31` 与 `2024-01-31` 是重复项。
- Excel 带格式显示的数字不合并：`1,000` 与 `1000`、`10%` 与 `0.1`、`1e0` 与 `1` 都不算重复。
- 空格算内容：`Alice ` 与 `Alice` 不是重复项。要忽略空格，先做「去除首尾空格」。

## 计算列

加减乘除与 Excel 公式 `=A+B` 的结果相同：

- 空单元格按 0 算；只有空格的单元格是文本。
- `TRUE` / `FALSE` 按 1 / 0 算。
- 文本参与计算得 `#VALUE!`，除以 0 得 `#DIV/0!`，超出 Excel 数值范围得 `#NUM!`。单元格里已有的错误值（如 `#N/A`）原样传下去。
- 结果保留完整精度，不四舍五入。

## 筛选

- 大于、小于等比较：两边都是数字时按数值比较，两边都是日期时按日期比较（`2024-06-30 13:45:00` 晚于 `2024-06-30`），其他情况不匹配。
- 等于、不等于、包含、不包含不分大小写，比较前去掉首尾空格。
- 「包含」比 Excel 宽：Excel 的文本筛选会跳过数字单元格，所以「包含 1」找不到 1000；这里数字也按文本搜索。错误值（如 `#N/A`）也当文本处理。

## 对照数据

| 文件 | 生成方式 |
| --- | --- |
| `sample-data/edge-cases/dedupe_variants.csv` | `node scripts/gen-dedupe-cases.cjs` |
| `sample-data/edge-cases/ops_variants.csv` | `node scripts/gen-ops-cases.cjs` |
| `sample-data/excel-reference/dedupe_variants.*.json` | `scripts/excel-dedupe-reference.ps1` 调用 Excel 删除重复项 |
| `sample-data/excel-reference/ops_variants.json` | `scripts/excel-ops-reference.ps1` 调用 Excel 公式和自动筛选，筛选条件在 `ops_filters.json` |
