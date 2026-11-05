# 表匠 Tablesmith (disktopApp) AGENTS.md

继承全局约束规范，本文件提供表匠桌面数据转换与可视化应用（disktopApp）的项目级具体规则与工程约束。
本约束严格融合了 **Google TypeScript Style Guide**、**Meta / React 19 官方架构设计规范（Rules of React）**、**Tauri 2.0 官方安全与 IPC 通信基准**、**Apache ECharts 与 AG Grid 大数据渲染与内存治理规范**、**Apple 人机交互指南（macOS HIG）**、**阿里 Ant Design / 字节跳动 Semi Design / 腾讯 TDesign 工业级前端研发与视觉回归测试体系** 以及 **Codex 全局核心工程沉淀**。

适用范围：本仓库全部源码、Tauri 2.0 桌面端（Rust）、React 19 前端、样式与图表、数据处理与转换服务、打包分发脚本（GitHub Actions CI/CD）及产品文档。

---

## 0. 项目技能库与工作流调度规则（Project Skills Router）

本项目已将面向**编码、设计、审美、文档与工程交付**的高频核心技能全部沉淀在项目级目录 [`.agents/skills/`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/) 下。执行特定任务时，根据场景主动遵循对应技能规范：

### 0.1 编码、重构与架构演进（Coding & Architecture）
1. **精准局部改动（Surgical Change）**：当用户要求“只修这一个问题”、“不要动其他逻辑”、“按现有风格改”时，遵循 [`surgical-change-guard`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/surgical-change-guard/SKILL.md) 约束，不扩散修改范围，不顺手大重构。
2. **疑难根因排查（Root Cause Debugger）**：遇到 IPC 调用失败、异步竞态、前端白屏、构建报错但原因未知时，遵循 [`root-cause-debugger`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/root-cause-debugger/SKILL.md)，建立“现象收集 → 反馈环复现 → 假设树排除 → 根因证明 → 最小修复”证据链，拒绝靠猜测乱改。
3. **前后端与契约同步（UI / Backend Contract Sync）**：当涉及 Rust IPC 命令修改、数据模型字段增删、TypeScript 类型调整或页面表单变更时，遵循 [`ui-backend-contract-sync`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/ui-backend-contract-sync/SKILL.md)，严格一链到底同步更新前端、Rust 后端、类型定义、文档与 Mock，并扫描清理旧字段残留。
4. **架构深度演进与重构（Architecture Refactor Strategist）**：涉及复杂模块边界重构、状态机重写、跨端性能瓶颈排查时，遵循 [`architecture-refactor-strategist`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/architecture-refactor-strategist/SKILL.md)，做深模块设计，提供方案对比与演进路径，杜绝大爆炸重写。
5. **安全改动与测试矩阵（Safe Change Validation）**：代码改动后交付前，遵循 [`safe-change-validation`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/safe-change-validation/SKILL.md)，针对受影响链路制定测试矩阵，执行构建、类型检查与端到端验证。
6. **纵切片测试驱动开发（TDD Tracer Bullet）**：对于核心计算引擎、数据解析算法或复杂格式互转，遵循 [`tdd-tracer-bullet`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/tdd-tracer-bullet/SKILL.md)，以红-绿-重构的端到端探路方式快速实现并固化质量。

### 0.2 设计、审美与原型探索（Design & Aesthetics）
7. **一次性交互原型验证（Prototype Spike）**：当界面交互、复杂图表表现或状态机设计尚不明确时，遵循 [`prototype-spike`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/prototype-spike/SKILL.md)，通过可丢弃的隔离原型快速验证可行性，吸收结论后再转入正式实现。
8. **PDF 报表排版与视觉质量（PDF Skill）**：处理表匠模块 5（A4 图文混排报告导出、打印预览、表格与图表嵌入）时，遵循 [`pdf`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/pdf/SKILL.md)，注重版式层次、对齐边距、避免文字截断和图表失真。
9. **成熟设计系统与标杆借鉴**：结合已安装的 **Mobbin**（60万+ 顶级实机界面参考）与 **Figma**（设计稿高保真还原与 Tokens 映射）进行审美与交互对标。

### 0.3 需求分析、文档与架构决策（Requirements & Documentation）
10. **需求追问与规格澄清（Requirement Grill With Docs）**：当遇到模糊、重领域或业务规则未决的需求时，遵循 [`requirement-grill-with-docs`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/requirement-grill-with-docs/SKILL.md)，通过“查现状 + 追问 + 推荐方案”将模糊需求收敛为可执行基线并沉淀至文档。
11. **PRD 与软件设计说明书编写（PRD / Spec Writer）**：将讨论共识与代码现状整理为规范的产品规格或架构设计文档时，遵循 [`prd-spec-writer`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/prd-spec-writer/SKILL.md)。
12. **第三方视角文档读者冷读检验（Document Reader Validation）**：在交付正式 PRD、架构方案、ADR 或阶段交接文档前，遵循 [`document-reader-validation`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/document-reader-validation/SKILL.md)，模拟完全不带历史聊天背景的“第三方独立读者”进行冷读检验，排查作者因熟悉背景而遗漏的隐含前提、步骤断层与歧义。
13. **代码审计与文档防漂移（Code Audit & Doc Drift）**：进行阶段 Review 或更新核心功能时，遵循 [`code-audit-doc-drift`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/code-audit-doc-drift/SKILL.md)，检查实现与 [`README.md`](file:///d:/code/zhanglx-index/disktopApp/tablesmith/README.md) 及 [`PRODUCT_PLAN.md`](file:///d:/code/zhanglx-index/disktopApp/tablesmith/PRODUCT_PLAN.md) 是否保持严格一致。
14. **领域词表与架构决策记录（Domain Glossary & ADR Maintainer）**：维护业务专有名词（如工作表、数据透视表维度/度量、数据切片）并对重大不可逆技术决策编写 ADR，遵循 [`domain-glossary-adr-maintainer`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/domain-glossary-adr-maintainer/SKILL.md)。
15. **大需求纵切片规划（Vertical Slice Planner）**：面对复杂大型功能时，遵循 [`vertical-slice-planner`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/vertical-slice-planner/SKILL.md)，按端到端可独立验证的业务路径拆解为分步切片。
16. **UI 文案与说明去水化（Stop Slop）**：编写界面文案、提示信息或文档时，遵循 [`stop-slop`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/stop-slop/SKILL.md)，剔除机器味套话、虚假主语和空洞标语，保持自然真实的专业工程口吻。
17. **跨轮交接与状态沉淀（Codex Handoff）**：长任务阶段收口或需要跨会话交接时，遵循 [`codex-handoff`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/codex-handoff/SKILL.md)，沉淀事实清单、修改文件、验证命令与下一步建议，严禁泄露私有思考。

### 0.4 安全防护、发布与代码借鉴（Security, Release & References）
18. **密钥与敏感配置守卫（Security & Secret Guard）**：涉及读取配置、导出日志、生成文档或脚本时，遵循 [`security-secret-config-guard`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/security-secret-config-guard/SKILL.md)，严禁打印完整密钥，只展示脱敏摘要。
19. **发布就绪与回滚（Release Readiness）**：涉及 GitHub Actions 打包流水线、版本升级或多平台构建发布时，遵循 [`release-readiness-rollback`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/release-readiness-rollback/SKILL.md)，提前评估跨平台发布与回滚/前滚边界。
20. **参考实现挖掘（Repo Reference Mining）**：开发新特性前，遵循 [`repo-reference-mining`](file:///d:/code/zhanglx-index/disktopApp/.agents/skills/repo-reference-mining/SKILL.md)，先对照项目内已有成熟代码或指定参考项目，避免重复造轮子或违背既有架构。

---

## 1. 默认原则与体验三角兼顾

1. **最新现状原则**：文档只保留最新现状与真实实现，历史演进由 Git 追溯；严禁新增按日期命名的临时过程记录，不保留“曾经通过”、“旧口径作废”之类的历史冗余叙述。
2. **改动必验证**：修改代码后必须在对应目录下运行与改动相关的类型检查、编译或构建验证（前端运行 `npm run build`，Rust 后端运行 `cargo check` 等），并在最终回复中明确列出执行命令和输出结果。
3. **高风险改动前滚修复**：对于核心数据转换引擎、Tauri IPC 接口、文件读写权限（Capabilities）、CI/CD 自动化打包流水线等改动，必须确保方案闭环，测试阶段实行前滚修复，不回退未经验证的旧版本。
4. **文档与代码一致**：当代码实现变更时，必须同步更新 [`README.md`](file:///d:/code/zhanglx-index/disktopApp/tablesmith/README.md) 和 [`PRODUCT_PLAN.md`](file:///d:/code/zhanglx-index/disktopApp/tablesmith/PRODUCT_PLAN.md)，确保架构说明、文件结构与接口描述保持严格一致。
5. **体验三角兼顾原则与 AI 友好度准则（User, Dev & AI-First Experience）**：
   - **用户体验（User Experience）**：操作直观、无假死卡顿、错误提示清晰且附带指引、交互符合系统原生习惯；
   - **开发体验（Developer Experience）**：代码可维护、分层明确、类型严密、无无谓的过度抽象与过度封装；
   - **AI Agent 友好度（AI Agent Experience）**：
     - **不以改动行数最少为目标**：优先选择能完整解决问题、改善使用体验且易于维护的方案，不以追求 diff 行数最少为唯一目标。必要时可以调整相关结构、抽取公共能力或补充内容，但不做无关重构；
     - **最小改动的辩证法**：最小改动只有在不牺牲正确性、可用性、清晰度、完整链路和后续维护时才是优先选择；必要取舍须说明具体收益、代价、影响和验证依据，供用户评估，不擅自省略需求。架构升级、整体替换和完整落地均须完成授权范围内的全部闭环链路；
     - **项目结构清晰易发现**：项目结构、文件命名、数据模型契约、文档说明和构建命令保持稳定、直观、易发现、可操作；
     - **零残留防干扰（拒绝假兼容）**：彻底清理被合理替换的旧实现、死代码、废弃字段与兼容分支，严禁在工程中留下双轨逻辑，避免对后续 AI 的代码理解与上下文推理造成严重误导；
     - **证据驱动与追根溯源**：每个改动都应该有理有据，能明确追溯到用户需求、失败用例、代码路径、文档漂移或明确风险，拒绝盲目猜测；
     - **复用优先与适度抽象**：有公用方法时不要重复造轮子；多处类似逻辑可判断是否抽取公共通用方法，但坚决不搞为了抽象而抽象。
6. **文案与信息设计服务任务（删除不必要文案与界面信息降噪规范）**：
   - **操作名称直接具体**：操作名称必须具体明确（如“导出 CSV”、“执行去重”、“生成 A4 报表”），严禁使用模糊的“确定”、“操作”、“处理”代替真实行为。
   - **重新设计优于叠加解释**：优先通过直观命名、清晰的信息层级、合理布局与交互自身表达意图；若界面依赖大段冗长说明才能被用户理解，应主动重新设计该区域，而不是无休止地叠加解释性文字。
   - **按任务严审信息用途（坚决删除不必要文案）**：
     - 删除装饰性宣传标语、空洞口号、重复啰嗦说明，以及无实际辨识价值的次要标签；
     - 字段与元信息是否展示，以“能否帮助用户辨认数据、选择格式或正确操作”为唯一依据，严禁因为组件模板预留了占位而生搬硬套文字。
   - **必需信息不可随意削减**：保留理解业务、正确操作、判断状态和处理错误所必需的信息；字段真实标签、不可逆操作后果（如“清空历史”）、错误原因及异步转换状态均按实际用途严格保留。
   - **简洁不等于只留图标**：保留可访问名称（`aria-label`）与必要的可见文本标签，严禁用模糊的占位符（Placeholder）或隐藏的悬停提示（Tooltip）替代关键字段标签和操作后果；图标按钮必须具备明确可辨识度与状态反馈。
   - **次要信息不一定多余**：紧凑容器或窄屏下优先调整排列与弹性换行；确需折叠的次要信息必须有清晰、可达的展开入口，不得因空间不足就粗暴隐藏。删除重复文案前，必须确认剩余表达在当前布局、深浅色模式与辅助技术下仍准确自足。
7. **Shell 执行环境**：Windows 下运行 PowerShell 命令统一使用 `pwsh.exe` 7.6+（本机已核实路径：`C:\Program Files\PowerShell\7\pwsh.exe`）；不要使用 Windows PowerShell 5.1 的 `powershell.exe` 执行项目脚本。

---

## 2. 无必要不兼容原则

在功能演进或重构过程中，**在无必要条件下，严禁引入兼容判断、兼容字段、兼容分支、兼容方法、兼容入口**。

如果有新的字段、方法、组件或方案来替代旧实现：
1. **彻底替换**：旧实现应直接删除并清理干净，坚决不搞“先留着兼容一段时间”。
2. **两端同步**：前端组件、状态模型、Rust IPC 命令、类型定义（TypeScript interfaces）、测试与配置必须同步更新完成。
3. **禁止单侧迁就**：不允许只改动前端或只改动 Rust 后端，另一侧靠兼容代码勉强兜底。
4. **杜绝双轨逻辑**：不允许新增双入口、双字段、双转换逻辑并存。
5. **例外审批**：如果确实因跨端协议或外部格式标准必须兼容，必须明确在代码注释或文档中写出：为什么必须兼容、兼容范围、以及清理淘汰计划。

---

## 3. 安全保护区（严禁随意削弱）

不要擅自删除或降低以下防御机制，除非任务明确要求且给出充分影响分析：
1. **权限与作用域校验**：Tauri Capabilities 作用域限制、文件访问边界。
2. **数据完整性与安全**：数据脱敏规则、敏感字段屏蔽、文件解析大小边界防护。
3. **健壮性策略**：异常捕获与降级、并发防抖、异步任务取消（`AbortController`）、网络/读取超时机制。
4. **代码完整性**：严禁随意删除与当前修改无关的现有注释、技术说明或测试用例。

---

## 4. 编码与换行要求

1. 所有新增/修改文件必须统一使用 **UTF-8 无 BOM** 编码。
2. 除 Windows 专用批处理脚本（`.bat` / `.cmd`）外，所有前端源码（`.ts`, `.tsx`, `.js`, `.css`）、Rust 源码（`.rs`）、配置文件（`.json`, `.toml`, `.yaml`）和 Markdown 文档统一使用 **LF** 换行符。
3. 严禁无意义的整文件换行符格式化抖动（避免产生大面积无业务含义的 git diff）。

---

## 5. Google TypeScript 规范与严格静态类型守则

遵循 **Google TypeScript Style Guide** 与顶级大厂类型安全标准，确保代码具备最高健壮性：

1. **绝对禁止使用 `any`**：
   - 严禁在任何新写或修改的代码中使用 `any` 类型。`any` 会关闭编译器的类型检查，是产生运行时异常的元凶。
   - **动态/未知类型统一使用 `unknown`**：从外部读取文件（Excel/CSV/JSON/YAML）、解析未经验证的数据输入时，统一声明为 `unknown`。
   - **显式类型守卫（Type Narrowing）**：消费 `unknown` 数据前，必须使用 `typeof`、`Array.isArray()`、自定义 Type Guard（如 `isRecord(val): val is Record<string, unknown>`）或 Zod/结构断言将其收窄为具名类型后才能使用。
2. **类型断言与双重强转规范**：
   - 尽量避免滥用 `as Type` 强制断言；若由于类型推导限制不得不使用双重断言，**必须且只能通过 `unknown` 过渡**（如 `val as unknown as TargetType`），严禁使用 `val as any as TargetType`。
3. **参数化字典与对象类型**：
   - 字典型键值对必须显式标注类型，统一使用 `Record<string, T>`（例如 `Record<string, unknown>`），避免裸写宽泛的 `object`。
4. **公共 API 显式返回类型**：
   - 所有暴露给外部模块调用的 Service 方法、公共 Hook 及工具函数，必须显式书写返回值类型，不得依赖隐式推导，以便在签名变更时第一时间触发编译告警。

---

## 6. Meta / React 19 核心架构与 Rules of React 约束

基于 **React 19 现代架构** 与 Meta 官方 **Rules of React** 指南，杜绝并发竞争、内存泄露与脏重绘：

1. **纯粹渲染（Pure Rendering）**：
   - 组件的 Render 过程必须是纯函数：**严禁在渲染主体（组件函数体第一层）直接修改 Props、State、全局变量或直接操作 DOM**。
   - 严禁在渲染主体中直接触发网络请求、文件 I/O 或 Tauri IPC 命令。
2. **大厂分层状态管理法（Stratified State Management）**：
   - **严格禁止将所有状态滥丢进全局 Store**，按照数据生命周期精确分层：
     - **文件/数据集核心状态**：当前打开的数据集、全局字段定义、最近打开历史、主题偏好，归属 **Zustand 全局 Store**（`useDataStore.ts`）。
     - **局部 UI 交互状态**：弹窗开关、折叠面板、当前选中的行高亮、输入框草稿，坚决下沉归属于组件自身的 `useState` / `useReducer`。
     - **路由与页面视图状态**：导航选中视图、页面路径，归属 `react-router-dom`。
     - **推导状态计算原则**：凡是能基于现有 State 计算得出的派生数据（如清洗后的行列计数、当前选中列类型列表），**必须在 Render 中即时推导计算**，严禁新建冗余 State 并在 `useEffect` 中来回同步赋值。
3. **严格的副作用边界（Strict useEffect Boundaries）**：
   - `useEffect` **仅用于与外部系统同步**（如 ECharts 挂载/尺寸响应、原生 Window 事件监听、DOM 元素焦点管理），严禁用于组件内部“状态变了去改另一个状态”的联动逻辑。
   - **必须提供完整的清理函数（Cleanup Function）**：所有带订阅、监听器（ResizeObserver / Window Event）或外部实例的 Effect，必须在 return 中进行 100% 卸载清理。
4. **异步操作与卸载取消（AbortController）**：
   - 所有异步数据加载、格式转换或计算任务，在组件卸载或用户快速切换 Tab 时，必须通过 `AbortController` 或取消标志中止后续状态更新，严禁触发“Can't perform a React state update on an unmounted component”警告。

---

## 7. Tauri 2.0 官方安全基线与 IPC 通信准则

遵循 **Tauri 2.0 官方安全与权限能力（Capabilities）设计规范**：

1. **严格的信任边界（Trust Boundaries）**：
   - **WebView 前端视为非受信环境（Untrusted）**，**Rust 后端视为受信任核心（Trusted）**。
   - 前端向 Rust 发起的所有 IPC 命令（`invoke`），Rust 端必须执行入参校验（防越界、防注入、防非法路径访问）。
2. **最小特权原则（Principle of Least Privilege）**：
   - `src-tauri/capabilities/` 细粒度声明各窗口（Window）的权限范围。
   - **严禁使用 `fs:allow-all` 等危险通配权限**：文件系统操作必须严格限定在安全作用域内（如 `$APPDATA/*`、`$DOCUMENT/*` 或由用户通过系统原生文件对话框主动选取的路径）。
   - **严禁开放任意 Shell 执行命令（`shell:execute`）**，避免潜在的远程代码执行（RCE）风险。
3. **Web 与 Tauri 双运行模式（Dual Runtime Mode）**：
   - 应用必须保持“双轨运行能力”：纯 Web（`npm run dev`）与桌面端（`npm run tauri dev`）均需稳定可用。
   - 调用任何 Tauri 专属 API 前，必须做运行环境判断（如嗅探 `window.__TAURI_INTERNALS__`）；桌面端调用 Rust IPC，Web 端自动无缝降级为浏览器原生实现（如使用 SheetJS、PapaParse 纯前端解析/导出），**严禁在浏览器端引发任何未定义异常**。

---

## 8. 大数据处理、AG Grid 33 与 ECharts 5 内存治理规范

面向万行级报表与复杂可视化的高性能企业级治理规范：

1. **统一数据模型（Unified Data Model）**：
   - 无论输入是 Excel 多工作表、CSV、XML、JSON、YAML 还是 SQL，经解析后必须且只能抽象成标准中间模型：
     ```typescript
     columns: ColumnDef[]; // 包含 field, headerName, type ('string' | 'number' | 'date' | 'boolean')
     rows: Record<string, unknown>[];
     ```
   - 所有的清洗、过滤、透视、图表转换逻辑基于此模型操作，禁止编写与具体源文件格式强绑定的分支代码。
2. **Apache ECharts 实例治理与内存防泄漏（Memory Leak Prevention）**：
   - **严禁将 ECharts 实例存放在 React `useState` 中**：必须保存在 `useRef<echarts.EChartsType | null>(null)` 中，防止非序列化对象污染 React 状态树并引发重复渲染。
   - **必须显式执行 `dispose()`**：在包含 ECharts 的组件 `useEffect` cleanup 中，必须调用 `chartInstance.dispose()` 并解除所有 Resize 监听，杜绝 Canvas / SVG 孤立 DOM 节点内存泄露。
   - **图表更新策略**：当数据或主题更新时，使用 `chartInstance.setOption(option, true)` 增量覆盖，严禁频繁销毁并重新初始化 `echarts.init()`。
3. **AG Grid 33 高性能渲染准则**：
   - **必须提供稳定的唯一行标识（`getRowId`）**：例如 `(params) => params.data.id || params.data.__rowKey`，确保在排序、过滤与局部更新时利用增量 DOM 差量计算，避免全表重新挂载。
   - **静态化配置缓存**：`columnDefs`、`defaultColDef` 以及网格事件回调必须使用 `useMemo` 或 `useCallback` 包装，防止父组件重绘引发 AG Grid 内部网格重构。
   - **严禁在单元格渲染器（Cell Renderer）中内嵌完整 ECharts 实例**：会导致 DOM 节点数与 Canvas 上下文暴增。图表必须放置在独立的分析面板或右侧/下方详情抽屉中。
4. **长耗时任务防主线程阻塞**：
   - 大于 10MB 的超大文件解析、海量数据清洗、多维透视矩阵运算，优先利用 Tauri Rust 后端命令处理；若在 Web 模式下，必须使用 Web Worker 或异步微任务切片，保证界面始终维持 60fps 响应。

---

## 9. 苹果人机交互指南（macOS HIG）与核心设计原则

表匠采用精美、克制、高专业度的 **macOS 苹果设计语言（Apple HIG）**，视觉和交互必须满足以下核心原则：

### 9.1 核心设计原则与交互基准（Design Principles）
1. **统一面优于碎片卡片**：同类条目统一放在规整面板中，用微边框或统一分隔线分开，严禁给每个条目单独加厚重花哨的碎片化独立卡片、厚重投影或彩色左边线。
2. **材质与质感克制（毛玻璃只是点缀）**：`backdrop-filter` 磨砂玻璃质感只用于真正叠在内容之上的层（吸顶导航栏、弹层遮罩、浮动工具栏）；正文、报表表格、数据透视面板、编辑器一律实底，消除视觉疲劳与渲染开销。
3. **克制至上（留白与层级解决问题）**：能用留白（Padding/Margin）和字阶层级解决的排版，不额外添加多余边框、花哨底色、无意义图标或数字徽标。
4. **层级来自字重、字号与灰度，颜色只表达语义**：页面主体以中性 Slate/Zinc 黑白灰阶梯为骨架；主操作与品牌色统一使用克制专业的科技蓝（Accent Blue），状态颜色严格专色专用（绿色=成功/完成、红色=危险/错误、黄色/橙色=警告），严禁大面积铺陈高饱和亮色和彩色浅底。
5. **交互四大基础闭环**：
   - **空间可感知性**：每个页面/视图都必须清晰回答“我在哪、能去哪、这里有什么、怎么离开”；
   - **就近原则**：操作控件必须放置在它直接影响的内容旁边；
   - **就地校验与持续状态**：输入就地校验；耗时计算与转换持续展示进行中状态与真实行数，杜绝界面假死；
   - **可撤销优于繁琐确认**：常规高频操作提供即时撤销（如恢复默认排序、撤销清洗过滤规则），确认弹窗只用于真正危险且不可逆的毁灭性操作（如清空全部历史、删除已载入源数据）。

### 9.2 色彩体系、视口自适应与无障碍
1. **色彩体系与视觉层级**：
   - 整体使用中性 Slate / Zinc 为底色，主操作色采用克制专业的科技蓝（Accent Blue），禁止大面积滥用高饱和刺眼色彩。
   - 严格支持 **浅色模式（Light）、暗黑模式（Dark）、跟随系统（System）** 3 态持久化切换。
   - 切换主题时，页面底色、侧边栏、AG Grid 表格（`ag-theme-alpine` 与 `ag-theme-alpine-dark`）及 ECharts 图表（暗色背景与轴线反转）必须 100% 全局无缝同步，严禁深色界面中夹杂刺眼的大白块。
2. **弹窗、滚动与视口自适应**：
   - 业务弹窗（文件配置、转换导出、透视设置）统一居中弹出，附带精致磨砂半透明遮罩与微阴影。
   - 弹窗外框高度自适应视口尺寸，内部长内容正文区独立滚动，标题栏与底部操作按钮（取消/确定）必须始终可见常驻。
3. **人机工程与无障碍（A11y）**：
   - 点击与触控命中区最小尺寸保证 ≥ 44×44px。
   - 文字与背景对比度严格符合 WCAG AA 标准（正常文本对比度 ≥ 4.5:1）。
   - 快捷键支持：全局常用操作（如打开文件 `Cmd/Ctrl+O`、保存导出 `Cmd/Ctrl+S`）保持与系统原生习惯一致。
4. **动效克制与可预测性**：
   - 界面动效仅限 `transform` 与 `opacity` 属性，过渡时长控制在 150ms~250ms 之间，严禁添加妨碍用户高频数据处理的繁复过场动画。

---

## 10. 工业级前端交付防错与视觉回归测试体系（阿里 / 字节 / 腾讯大厂基准）

遵循 **阿里 Ant Design / 字节跳动 Semi Design / 腾讯 TDesign** 工业级前端研发与视觉回归测试体系，建立严格的前端交付防错与自检机制（详细标准见 [`BROWSER_ACCEPTANCE_SPEC.md`](file:///d:/code/zhanglx-index/disktopApp/BROWSER_ACCEPTANCE_SPEC.md)）：

1. **零假设与前置自检原则（Shift-Left & Zero-Assumption）**：
   - **严禁凭感觉交付，严禁把半成品丢给用户审查**。涉及界面布局、配色、组件间距、文本排版或图表渲染改动后，Agent 必须主动通过自动化浏览器（Puppeteer）生成实际渲染截图并亲自执行像素级自检。
   - 必须通过全局命令 `tablesmith-verify`（已持久化写入全局 PATH）对以下五大 P0 级场景全量跑通走查：
     1. 数据源表格视图（暗黑模式 + AG Grid 纯黑背景 + 奇偶行高对比度斑马纹）；
     2. 图表可视化视图（暗黑模式 + 多序列柱状图 + 3px 高反差光晕数值标签）；
     3. 数据处理视图（暗黑模式 + Excel 级四象限数据透视表配置及结果展示）；
     4. 报表生成视图（暗黑模式操作台 + A4 打印级排版预览）；
     5. 浅色模式复测（明暗切换分段控制器与卡片对比度回归）。
2. **100% 全局暗黑模式完整性规范 (True Global Dark Mode)**：
   - 严禁出现局部白块、白色边框、未适配原生表格（AG Grid 默认浅色变量）或浅色弹窗；必须覆盖所有层级容器、输入框及第三方集成组件。
3. **排版与紧凑空间审美规范**：
   - 在侧边栏、按钮组等窄宽容器（`< 180px`）中，**绝对禁止出现中文单个字竖向挤压折行**（如“浅\n色”、“深\n色”、“外\n观”）；必须采用极简 Icon 分段控制器（`[ ☀️ | 🌙 | 💻 ]`）搭配 Tooltip 悬浮提示。
4. **图表可读性强制规范**：
   - 数值标签文字必须具备 WCAG AA 级对比度（$\ge 4.5:1$），统一启用 3px 动态遮罩反差描边（暗黑模式白字黑边，浅色模式黑字白边），杜绝标签被柱体或背景吞没。
5. **自动化工具链持久化与 PATH 约束**：
   - 自动化无头浏览器（Puppeteer）与测试脚本统一配置在全局环境（`C:\Users\16147\AppData\Roaming\npm` 及用户环境变量 `NODE_PATH`）。任何开发者或终端可直接在系统任意目录运行 `tablesmith-verify` 进行秒级验收。

---

## 11. 桌面端分发、密钥保护与本地持久化 Gitleaks 工具

1. **零成本打包与分发策略**：
   - 免每年 \$99 Apple 开发者账号，macOS 端采用免费 Ad-hoc 签名构建 `.dmg`，并在文档及 Release Notes 中清晰指导用户通过“右键打开”或 `xattr -cr` 绕过 Gatekeeper。
   - Windows 端打包生成标准绿色免安装版与 NSIS 安装包。
2. **自动化 GitHub Actions 流水线（CI/CD）**：
   - 打包构建严格依赖 `.github/workflows/release.yml` 运行多平台矩阵构建。任何涉及打包配置、Tauri 插件升级的操作，必须确保在 CI 环境中能无报错顺利构建。
3. **敏感凭证绝不入库与本地持久化扫描**：
   - 严禁在代码仓库中提交真实密钥、Token 或敏感个人数据。所有测试与示例文件统一放在 `sample-data/` 目录下，且必须完全脱敏。
   - **本机持久化 Gitleaks 绝对路径**：`C:\Users\16147\.codex\tools\gitleaks\8.30.1\gitleaks.exe`
   - **标准扫描执行命令**：
     ```powershell
     & 'C:\Users\16147\.codex\tools\gitleaks\8.30.1\gitleaks.exe' dir . --redact=100 --no-banner --report-format json --report-path 'target\gitleaks-report.json'
     ```
     报告输出必须指定在 ignored 目录下，并且强制 `--redact=100`，只展示规则和位置，严禁泄露 Secret 原文。

---

## 12. 源码与官方资料优先排障准则

1. **拒绝盲目试错**：遇到 Tauri 2.0 宏与指令、Rust Cargo 编译错误、React 19 渲染行为、AG Grid 33 API 变更或 ECharts 5 渲染异常时，严禁依靠猜测连续修改试错；必须首先查阅本仓库已有的实现模式、错误调用栈以及官方一手文档（Official Docs / Release Notes / Migration Guides）。
2. **单向排障链条**：定位问题应严格按照“输入数据 -> 格式解析 -> 统一状态模型 -> UI/图表渲染”单向逐步核验，避免多点并发修改导致故障面扩散。
3. **杜绝掩盖真实错误**：严禁为了让构建通过而写 `any`、关闭 TypeScript 严格检查、或者通过空的 `try-catch` 吞没错误导致白屏。

---

## 13. 每轮任务结束前资源清理与进程台账

1. **后台服务清理**：每轮任务完成后，必须检查并停止由本轮启动的 Vite 前端开发服务器（默认端口 1420/5173 等）、Tauri 调试运行实例及可能常驻的 Node/Rust 临时构建进程。
2. **进程台账规约**：启动后台开发服务或长耗时脚本时，记录进程 PID、监听端口及命令行归属；清理时依据精准 PID 关闭，**严禁全局误杀用户的 `node`、`chrome`、编辑器或系统开发工具进程**。
3. **透明说明**：在最终回复中，明确告知用户本轮改动执行的验证命令、验证结果，以及后台开发服务是否已清理完毕。

---

## 14. PowerShell 执行规避与复杂脚本处理准则

在 Windows 环境下使用 `pwsh.exe` 执行命令行任务时，必须严格遵守以下规则：

1. `pwsh.exe -NoProfile -Command` 的脚本中如果包含 `$变量`、`$_`、`$env:*`、`@{}` 或管道对象，外层命令必须优先用**单引号**包裹脚本，防止在调用前被外层环境提前插值展开。
2. **多语言与大段复杂脚本处理**：凡脚本内容包含大段多行文本、JSON/YAML 模板、Python 三引号或复杂管道时，**严禁在 `-Command` 中死磕嵌套转义**；优先写入受控临时 `.ps1`、`.js` 脚本或通过标准输入（stdin）传递，执行验收完毕后立即清理。
3. `Invoke-RestMethod` 遇到 HTTP 4xx/5xx 会抛异常；需要检查失败响应体时使用 `Invoke-WebRequest -SkipHttpErrorCheck`。
4. Windows 沙箱或并发 shell 偶发 `CreateProcessAsUserW failed: 1920` 时，不要反复重试；改用单条明确的命令顺序执行。
5. 后台服务用 `Start-Process -WindowStyle Hidden -PassThru` 启动时，必须记录进程 PID；排查确认后再进行 `Stop-Process`。
6. PowerShell 会把未加引号的逗号参数解析成数组/参数列表；传递包含逗号的 CLI 参数时必须整体加上引号。
7. **严禁把自定义变量命名为 `$pid`**，因为 PowerShell 内置的 `$PID` 是系统的只读环境变量（且大小写不敏感）；处理进程时统一使用 `$procId` 或 `$processIdValue`。

---

## 15. 交付标准与输出事实原则

最终回复与交接材料必须遵守事实驱动准则：
1. **只输出可交接事实**：列出核心文件变更、具体命令及执行输出、验证状态、残余风险与下一步明确建议。
2. **严禁输出私有思维过程**：不输出大段无意义的内心独白、自我辩解或空洞套话。
3. **状态清晰透明**：若某项验证由于环境限制未执行（如本地未安装 Rust 导致未运行 `cargo check`），必须如实明确说明，并给出用户可在本机直接运行的验证命令。
