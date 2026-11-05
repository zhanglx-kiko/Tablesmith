# 📊 表匠（Tablesmith）— 桌面报表数据转换与可视化工具

一款专为 macOS（并兼容 Windows）打造的高性能轻量桌面应用，**无需上架 App Store，无需付费购买 Apple 开发者账号**，直接生成 `.dmg` 安装包即可分发使用。

---

## 🌟 核心功能

1. **多数据源读取与预览**
   - 支持 `.xlsx` / `.xls`（多 Sheet 自由切换与日期格式化）、`.csv`、`.xsd`（XML Schema 模式定义）、`.xml`、`.json`、`.yaml`
   - **XSD 模式定义深度解析与元数据透视**：支持将 `.xsd` 文件结构化提取为 5 大全景工作表（`Elements 元素结构`、`Attributes 字段属性`、`SimpleTypes 枚举与约束`、`Constraints 主外键与唯一性约束`、`SchemaSummary 命名空间元信息`），无缝纳管企业级数据契约与接口规范
   - **复杂多编码与多分隔符 CSV 自适应引擎**：自动识别并剥除 UTF-8 BOM，原生支持 GBK/GB18030（中文 Windows Excel 默认编码），自动嗅探逗号（`,`）、分号（`;`，欧洲 Excel 习惯）、制表符（`\t`，TSV）与竖线（`|`）
   - **智能表头定位与多级 Banner 规避**：支持专业财务/业务 Excel 模型（如 Rolling Forecast），自动识别并跳过首行大标题/合并单元格 Banner，准确定位多列真实表头，防止列名塌陷
   - **企业级多工作表 XML 解析**：基于栈式元素追踪（Stack-based Extraction），全面支持属性型 XML（如 `<Fact id="..." amount="..."/>`）与深度嵌套自闭合标签，父节点属性与子节点内容完整保留，智能按标签分发生成多工作表
   - **严格去空与字段消毒**：CSV 与 Excel 解析具备尾部空行自动清洗、重复列名自动去重编号（`_1`, `_2`）以及无名列合法占位（`列N`）
   - **全格网垂直分割线与平滑列宽拖拽**：表头与单元格均具备清晰垂直分割线（浅色 `#e2e8f0` / 深色 `#1e293b`），扩充列宽调节热区至 14px，支持边框丝滑拖拽、双击表头边缘自动贴合内容，状态栏配备“自适应列宽”与“平铺撑满”一键控制
   - **单元格与字体多维缩放系统（Cell & View Zoom）**：状态栏原生集成缩放控制（`70% ~ 160%` 微调），配备 `紧凑 (85%)`、`标准 (100%)`、`宽松 (120%)` 三态密度预设，联动行高、字号与表头无级自适应重绘，偏好设置持久化记忆
   - **全场景高对比度 SVG 筛选按钮与弹窗防重叠**：桌面端与 Web 端均采用独立矢量 SVG 滤镜遮罩与 CSP 穿透优化，杜绝按钮白块与图标丢失；优化筛选弹出面板输入框边距（`padding-left: 26px`），彻底消除背景放大镜图标与搜索文字的重叠
   - **工作台会话无缝持久化（Session Continuity）**：未主动点击关闭标签（`X`）的数据源在应用重启或刷新后 100% 自动恢复（基于 IndexedDB 异步缓存），直接继续操作而无需重新导入
   - 支持拖拽文件直接导入或文件选择器，支持从系统剪贴板一键粘贴表格
   - 高性能 AG Grid 33 数据表格预览，支持虚拟滚动、多列排序、条件筛选、多选、列宽自适应与行列状态统计

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
   - **四象限数据透视表 (Pivot Table)**：行维度分组（支持多层级展开）、列交叉对比、6 大聚合统计（SUM/AVG/COUNT/DISTINCT/MAX/MIN）、4 种占比计算、字段切片器与行列总计
   - **基础清洗**：一键数据排重、一键清空行、全局空白字符修剪（Trim）、复合条件组合筛选
   - **计算列与派生**：加减乘除四则运算派生列、多列文本拼接列、指定列快捷删除
   - **合规脱敏**：手机号、身份证、中文姓名、电子邮箱一键合规打码
   - **多表关联与拼接**：横向关联（Inner/Left/Right/Full JOIN）与纵向追加（Union）

5. **A4 图文混排报表导出**
   - 沉浸式 A4 打印级排版预览工作台
   - 核心 KPI 指标卡片、动态嵌入 ECharts 可视化图表、前 20 行数据摘要表格、分析结论卡
   - 一键纯前端导出高清 PDF 电子报告，支持系统原生打印（`Cmd/Ctrl+P`）

6. **100% 全局暗黑模式与大厂级自动化走查**
   - 极简 Icon 胶囊分段控制器（`[ ☀️ | 🌙 | 💻 ]`），杜绝紧凑空间文字折行
   - AG Grid 深度穿透全深色定制，无眩光局部白块
   - 写入系统 PATH 的 `tablesmith-verify` 浏览器自动化走查引擎，秒级完成 5 大 P0 场景截屏自检

---

## 🚀 快速上手与运行

### 方式一：浏览器极速预览（无需 Rust）

无需安装 Rust 环境，只需 Node.js：

```bash
cd tablesmith
npm install
npm run dev
```

在浏览器打开 `http://localhost:1420` 即可体验完整的数据导入、预览、转换与图表功能！已在 `sample-data/` 目录下准备好了示例文件：
- `sample-data/multi_sheet_demo.xlsx` (多工作表 Excel)
- `sample-data/sales_report.csv` (年度销售数据)
- `sample-data/department_stats.xml` (部门报表 XML)
- `sample-data/saas_products.json` (SaaS 产品指标 JSON)

### 方式二：macOS / Windows 桌面端运行（基于 Tauri 2.0）

需要安装 Rust 编译器（如未安装请见下方说明）：

```bash
# 启动桌面开发模式
npm run tauri dev
```

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
│   │   ├── FileDropZone.tsx       # 文件拖拽上传与解析区
│   │   ├── FormatConverter.tsx    # 格式转换与导出控制面板
│   │   ├── GlobalToast.tsx        # 全局浮层通知系统（支持一键在文件夹中显示）
│   │   └── Sidebar.tsx            # macOS 风格侧边栏
│   ├── services/
│   │   ├── chartService.ts        # 图表配置生成服务
│   │   ├── dataProcessService.ts  # 数据清洗、计算衍生列、脱敏、关联与拼接引擎
│   │   ├── fileService.ts         # 统一文件读写、解析与导出（支持 Tauri/Web 双模式）
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
│   │   ├── commands.rs            # Rust 高性能文件解析与写入 IPC 指令
│   │   ├── lib.rs                 # Tauri 插件与指令注册中心
│   │   └── main.rs                # 桌面主程序入口
│   ├── Cargo.toml                 # Rust 依赖声明 (calamine, quick-xml, csv)
│   └── tauri.conf.json            # Tauri 应用配置
│
├── sample-data/                   # 开箱即用的测试报表数据
├── package.json                   # 前端依赖与构建脚本
└── vite.config.ts                 # Vite 构建配置
```

---

## 🛠️ 后续远期演进路线 (Roadmap)

- [ ] 嵌入式本地高速分析数据库（DuckDB / SQLite-WASM），支持 100 万+行秒级即时聚合
- [ ] 动态联动仪表盘（Dashboard），支持多图表多工作表联动筛选
- [ ] 本地大模型（Ollama / DeepSeek）私有化智能分析助手，自然语言一键生成透视表与图表配置
