# 📊 表匠（Tablesmith）— 桌面报表数据转换与可视化工具

基于 Tauri 2 的桌面应用。当前以 Windows 为主要开发和验证平台，macOS 版本通过 GitHub Actions 打包后再在 Mac 上验证；不提供浏览器版本。

---

## 🌟 核心功能

1. **多数据源读取与预览**
   - 支持 `.xlsx` / `.xlsm` / `.xlsb` / `.xls` / `.ods`、`.csv` / `.tsv` / `.txt`、`.json` / `.jsonl`、`.xml`、`.xsd`、`.yaml`；可一次选择或拖入多个文件，单个文件上限 200 MB
   - **统一导入管线**：Rust 读取文件（calamine 读表格单元格，文本做编码识别）；calamine 读不了的工作簿（xlsb、ods、部分 xls）改由 SheetJS 读取。两种读取方式都输出同一种原始单元格网格，再交给同一个 TypeScript 规整器生成表格（有逐文件对比测试保证两者一致）。解析在 Web Worker 中进行，大文件不卡界面
   - **表头识别**：跳过报表大标题和空行，按“文字/日期多、数字少”定位真实表头；合并单元格的多级表头拼成 `上半年 / Q1`；纵向合并的单元格向下填充；首行就是数字的表按无表头处理，列名为 `列A`、`列B`；月份表头显示为 `2024-01`
   - **一表多块**：同一工作表中用空行和小标题隔开的多个表格拆成独立工作表（如 `Summary · Monthly trend`）；表头上方的说明行、表尾的“数据来源”类备注不进入数据，并在导入提示中列出
   - **单元格值**：数值保留原始精度（15 位有效数字，`0.1+0.2` 显示为 `0.3`，不做货币/千分位格式化）；日期、时间、日期时间分别输出 `2024-01-31`、`13:45:00`、`2024-02-01 09:30:15`；公式取缓存结果，没有缓存结果的公式会提示数量；隐藏工作表照常导入并提示，空白工作表跳过
   - **文本编码与分隔符**：识别 UTF-8（含 BOM）、UTF-16 LE/BE（含无 BOM）、XML 声明的编码，其余按 GB18030（兼容 GBK/GB2312）读取；CSV 自动识别逗号、分号、Tab、竖线，正确处理引号内的分隔符和换行；行长度不齐时自动补齐
   - **JSON / YAML**：顶层数组直接成表；`{ "data": { "items": [...] } }` 这类包装结构会找出每个对象数组各成一表，其余标量字段放进 `元信息` 表；嵌套对象展开为 `address.city` 列；支持 JSON Lines 和多文档 YAML；语法错误会给出行列位置
   - **XML / XSD**：保持源文件中的列顺序；每种重复出现的元素各成一表，只出现一次的元素和根属性进入 `元信息`；去掉命名空间前缀；子元素属性记为 `Total@currency`；XSD 结构化为元素、属性、类型、约束、元信息 5 张表
   - **重复列名**自动编号为 `金额_2`；空列自动去除；加密工作簿、不支持的类型、空文件、语法错误都会显示具体原因，批量导入时单个失败不影响其他文件
   - **原始值红线**：导入不改变任何存储值（数字保留完整双精度、文本保留前导零与长编号），逐格对照桌面 Excel 验证。
   - **Excel 格式显示**：表格默认按单元格的 Excel 数字格式显示（`$28,975,558`、`61.4%`、`2024年1月31日`），底部可切换「Excel 格式 / 原始值」，悬停查看另一种值；排序、数值筛选、计算与默认导出按原始值，导出时可选导出 Excel 显示的文字。详见 [docs/display-formats.md](docs/display-formats.md)。
   - **数据体检**：数据源页面一键检查当前工作表的唯一列重复、公式错误、整行重复、首尾空格、带千分位或货币符号的数字、非数字值、日期写法不一、分类写法不一、空值和数量级异常；只读，点击结果定位到单元格。详见 [docs/health-check.md](docs/health-check.md)。
   - **处理步骤记录与重放**：数据处理页面按顺序记录清洗、筛选、计算列、脱敏、删列、透视等步骤，可撤销、保存为步骤文件，并在下个月的同类表格上一键重放；缺列时不执行并指出第几步。详见 [docs/recipes.md](docs/recipes.md)。
   - **跨文件对比**：数据处理 → 合并 → 对比差异，按所选列匹配两份文件，列出新增、删除、修改的行及改了哪些列；重复键和空键单独标出，不静默丢行。关联（VLOOKUP）会提示匹配数与重复键。详见 [docs/compare.md](docs/compare.md)。
   - **导入说明**：跳过的说明行、隐藏工作表、编码转换等信息记录在文件上，在该文件表格上方的“导入说明（N 条）”中展开查看；导入完成时只弹出一行简短提示
   - **全格网垂直分割线与平滑列宽拖拽**：表头与单元格均具备清晰垂直分割线（浅色 `#e2e8f0` / 深色 `#1e293b`），扩充列宽调节热区至 14px，支持边框丝滑拖拽、双击表头边缘自动贴合内容，状态栏配备“自适应列宽”与“平铺撑满”一键控制
   - **单元格与字体多维缩放系统（Cell & View Zoom）**：状态栏原生集成缩放控制（`70% ~ 160%` 微调），配备 `紧凑 (85%)`、`标准 (100%)`、`宽松 (120%)` 三态密度预设，联动行高、字号与表头无级自适应重绘，偏好设置持久化记忆
   - **全场景高对比度 SVG 筛选按钮与弹窗防重叠**：采用独立矢量 SVG 滤镜遮罩与 CSP 穿透优化，杜绝按钮白块与图标丢失；优化筛选弹出面板输入框边距（`padding-left: 26px`），彻底消除背景放大镜图标与搜索文字的重叠
   - **工作台会话无缝持久化（Session Continuity）**：未主动点击关闭标签（`X`）的数据源在应用重启或刷新后 100% 自动恢复（基于 IndexedDB 异步缓存），直接继续操作而无需重新导入
   - 支持把文件拖入窗口任意位置导入、文件选择器多选，以及从系统剪贴板粘贴 Excel / 网页表格
   - 高性能 AG Grid 33 数据表格预览（中文界面），支持虚拟滚动、多列排序、条件筛选、多选、列宽自适应与行列状态统计；数值列右对齐、显示原始精度；筛选弹窗带搜索图标和“清空”按钮，有筛选时状态栏显示“已筛选 N / M 行”并可一键清除全部筛选

2. **多格式双向互转与导出**
   - 6 大格式双向无损互转（Excel ↔ CSV ↔ XML ↔ JSON ↔ YAML ↔ SQL）
   - CSV 自定义分隔符（逗号、分号、Tab、竖线）
   - SQL 自动生成 `CREATE TABLE` 建表与批量 `INSERT INTO` 语句

3. **数据可视化图表辅助**
   - 一键生成 **折线图、柱状图、饼图/环形图、散点图、面积图**
   - 自由选择 X 轴与多 Y 轴数据维度对比，支持堆叠累加模式 (Stack)
   - 4 套专业调色板（商务经典、科技霓虹、莫兰迪雅致、日落暖调）
   - 具备 WCAG AA 级 3px 动态高反差光晕数值标签，一键导出 2x 高清 PNG 图片

4. **高级数据处理与 Excel 级数据透视表**
   - **四象限数据透视表 (Pivot Table)**：行维度分组（支持多层级展开）、列交叉对比、6 大聚合统计（SUM/AVG/COUNT/DISTINCT/MAX/MIN）、4 种占比计算、字段切片器与行列总计；计算口径与桌面 Excel 透视表逐格一致（空格留空、总计按明细重算、不四舍五入），详见 [docs/pivot.md](docs/pivot.md)
   - **基础清洗**：一键数据排重、一键清空行、全局空白字符修剪（Trim）、复合条件组合筛选
   - **计算列与派生**：加减乘除四则运算派生列、多列文本拼接列、指定列快捷删除
   - 去重、计算列与筛选的结果与桌面 Excel 逐行一致（删除重复项不分大小写、按值和日期比较；计算列与 `=A+B` 相同，含 `#VALUE!` / `#DIV/0!`；日期可按大小筛选），详见 [docs/process-rules.md](docs/process-rules.md)
   - **合规脱敏**：手机号、身份证、中文姓名、电子邮箱一键合规打码
   - **多表关联与拼接**：横向关联（Inner/Left/Right/Full JOIN）与纵向追加（Union）

5. **A4 图文混排报表导出**
   - 沉浸式 A4 打印级排版预览工作台
   - 核心 KPI 指标卡片、动态嵌入 ECharts 可视化图表、前 20 行数据摘要表格、分析结论卡
   - 一键纯前端导出高清 PDF 电子报告，支持系统原生打印（`Cmd/Ctrl+P`）

6. **100% 全局暗黑模式与大厂级自动化走查**
   - 极简 Icon 胶囊分段控制器（`[ ☀️ | 🌙 | 💻 ]`），杜绝紧凑空间文字折行
   - AG Grid 深度穿透全深色定制，无眩光局部白块
   - 写入系统 PATH 的 `tablesmith-verify` 走查命令：启动真实的 release exe，通过 WebView2 调试端口完成 5 大 P0 场景截屏自检

---

## 🚀 快速上手与运行

需要 Node.js 与 Rust（Windows 还需要系统自带的 WebView2 Runtime）。

```bash
cd tablesmith
npm install

# 开发模式：自动启动 Vite 并打开桌面窗口，前端改动热更新
npm run tauri dev

# 编译 release exe（不打安装包），产物为 src-tauri/target/release/tablesmith.exe
npx tauri build --no-bundle
```

`npm run dev` 只为 `tauri dev` 提供前端页面，单独在浏览器里打开不能使用（没有 Rust 读写文件能力）。`sample-data/` 下有示例文件：`multi_sheet_demo.xlsx`、`sales_report.csv`、`department_stats.xml`、`saas_products.json`，`edge-cases/` 为导入边界样例。

### 测试

```bash
# 导入管线单元测试（含 sample-data/edge-cases 与 D:/tmp/excel 真实文件）
npm test

# Rust 读取层测试
cd src-tauri && cargo test --lib

# 生成 Rust 读取结果快照，npm test 会据此比对 calamine 与 SheetJS 两种读取结果
cd src-tauri && cargo test --lib export_payloads -- --ignored
```

边界样例由 `scripts/generate-edge-fixtures.py`（需要 openpyxl）和 `scripts/generate-edge-fixtures.cjs` 生成到 `sample-data/edge-cases/`。界面检查都在真实 exe 上进行：先编译 release exe，再在仓库根目录运行 `node tools/verify-import-e2e.cjs`（导入端到端）或 `tablesmith-verify`（P0 场景截图）。脚本使用临时 WebView2 配置目录，不会影响你本机已打开的工作台和历史记录。

---

## 🍎 macOS 免开发者账号（零费用）打包与分发指南

由于无需支付 \$99/年 购买 Apple 开发者账号，你可以在 Mac 机器上直接使用 **免费的 Ad-hoc 签名** 打包 `.dmg`：

### 1. 打包生成 DMG

在 Mac 电脑的终端中运行：

```bash
# 生成 release 版本并打包为 .dmg
npm run tauri build -- --bundles dmg
```

打包产物位于：
`src-tauri/target/release/bundle/dmg/Tablesmith_0.1.0_x64.dmg`（或 `_aarch64.dmg`）

### 2. 用户安装与绕过 Gatekeeper（三种简单方式）

未经过 Apple 官方公证的 App 首次打开时，macOS 会弹出提示：“无法验证开发者”。只需按以下任一方式操作一次：

- **方式一（最简便，推荐）**：
  在「应用程序」目录中，**右键** 点击 `Tablesmith.app` → 选择 **「打开」** → 在弹窗中再次点击 **「打开」** 即可正常运行，后续双击即可启动。
- **方式二**：
  打开 **系统设置** → **隐私与安全性** → 滚动到下方看到 “已阻止使用 Tablesmith” → 点击 **「仍要打开」**。
- **方式三（终端一键去隔离）**：
  ```bash
  xattr -cr /Applications/Tablesmith.app
  ```

---

## 📁 项目目录结构

```
tablesmith/
├── src/                           # 前端 React + TypeScript
│   ├── components/                # UI 组件
│   │   ├── ChartPanel.tsx         # ECharts 图表构建与导出面板
│   │   ├── DataTable.tsx          # AG Grid 数据表格
│   │   ├── ExportModal.tsx        # 人体工学直接导出弹窗（记忆上次路径/无二次确认）
│   │   ├── FileDropZone.tsx       # 空状态的拖入 / 选择文件区域
│   │   ├── FileTypeIcon.tsx       # 按文件类型显示图标
│   │   ├── ImportNotes.tsx        # 当前文件的导入说明（可折叠）
│   │   ├── FormatConverter.tsx    # 格式转换与导出控制面板
│   │   ├── GlobalToast.tsx        # 全局浮层通知系统（支持一键在文件夹中显示）
│   │   └── Sidebar.tsx            # macOS 风格侧边栏
│   ├── hooks/
│   │   └── useFileImport.ts       # 选择 / 拖入 / 粘贴三种导入入口的统一流程、提示与取消
│   ├── services/
│   │   ├── import/                # 导入管线（与 Tauri 无关的纯函数，可单测）
│   │   │   ├── index.ts           # 入口：按扩展名与文件头分派格式
│   │   │   ├── types.ts           # 原始单元格网格契约（与 src-tauri/src/import.rs 对应）
│   │   │   ├── normalize.ts       # 表头识别、合并单元格、一表多块拆分、去空列
│   │   │   ├── sheetjsReader.ts   # SheetJS 读取（calamine 读不了的工作簿）
│   │   │   ├── decode.ts          # 文本编码识别
│   │   │   ├── delimited.ts       # CSV / TSV / 分隔符文本
│   │   │   ├── structured.ts      # JSON / JSONL / YAML
│   │   │   ├── xml.ts / xsd.ts    # XML 与 XSD
│   │   │   ├── client.ts          # Web Worker 调用与取消
│   │   │   └── import.worker.ts   # 后台解析线程
│   │   ├── chartService.ts        # 图表配置生成服务
│   │   ├── dataProcessService.ts  # 数据清洗、计算衍生列、脱敏、关联与拼接引擎
│   │   ├── fileService.ts         # 导入入口、原生拖放、各格式导出与统一保存流程
│   │   ├── pivotTableService.ts   # Excel 级多维交叉数据透视表计算引擎
│   │   ├── reportService.ts       # A4 图文混排报告导出与系统打印服务
│   │   └── storageService.ts      # IndexedDB 工作台未关闭数据源自动恢复与缓存服务
│   ├── store/
│   │   └── useDataStore.ts        # Zustand 全局数据状态管理
│   ├── types/                     # TypeScript 类型定义
│   ├── utils/
│   │   └── numberUtils.ts         # 财务级数值解析引擎（支持货币符号、千分位、负数括号与百分比）
│   ├── views/                     # 页面路由视图 (数据源/转换/图表/处理/报表生成)
│   │   ├── ChartView.tsx          # 图表可视化分析视图
│   │   ├── ConvertView.tsx        # 6 大格式双向互转视图
│   │   ├── DataSourceView.tsx     # 数据源表格与多 Sheet 切换视图
│   │   ├── ProcessView.tsx        # 7 大数据加工与透视表处理视图
│   │   └── ReportView.tsx         # A4 打印级专业图文分析报告视图
│   ├── App.tsx                    # 布局框架
│   └── main.tsx                   # 入口文件
│
├── src-tauri/                     # Tauri 2.0 Rust 后端
│   ├── capabilities/              # 细粒度权限控制配置
│   ├── src/
│   │   ├── commands.rs            # IPC 指令：read_file_data / read_file_bytes / 写文件 / 在文件夹中显示
│   │   ├── import.rs              # 文件读取：calamine 原始网格、编码识别、类型与大小校验
│   │   ├── lib.rs                 # Tauri 插件与指令注册中心
│   │   └── main.rs                # 桌面主程序入口
│   ├── Cargo.toml                 # Rust 依赖声明 (calamine, chrono, encoding_rs)
│   └── tauri.conf.json            # Tauri 应用配置
│
├── sample-data/                   # 示例数据；edge-cases/ 为导入边界样例
├── scripts/                       # 边界样例生成脚本
├── package.json                   # 前端依赖与构建脚本
└── vite.config.ts                 # Vite 构建配置
```

---

## 🛠️ 后续远期演进路线 (Roadmap)

- [ ] 嵌入式本地高速分析数据库（DuckDB / SQLite-WASM），支持 100 万+行秒级即时聚合
- [ ] 动态联动仪表盘（Dashboard），支持多图表多工作表联动筛选
- [ ] 本地大模型（Ollama / DeepSeek）私有化智能分析助手，自然语言一键生成透视表与图表配置
