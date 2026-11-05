---
name: domain-glossary-adr-maintainer
description: 维护项目领域词表、CONTEXT.md、ADR 和长期设计决策。Use when terms are ambiguous, decisions should be recorded, or code/docs need shared language for future Codex sessions.
---


# Domain Glossary & ADR Maintainer

## 目标
让 Codex、开发者、文档使用同一套领域语言，并记录重要设计取舍，降低后续会话重复解释成本。

## CONTEXT.md 规则
只写领域概念定义、概念关系、避免混淆的同义词/禁用词、业务状态含义。

不写具体文件路径、实现步骤、临时 TODO、API 细节和数据库字段清单。

## ADR 规则
只有同时满足以下条件才写 ADR：
1. 决策难以逆转。
2. 没有上下文会让后人疑惑。
3. 存在真实备选方案和取舍。

## ADR 模板
- Title
- Status：Accepted / Superseded
- Context
- Decision
- Consequences
- Alternatives considered
- Rollout / Migration
- Revisit trigger

## 流程
1. 发现术语冲突或模糊说法。
2. 查现有 CONTEXT.md、README、docs、代码命名。
3. 提出统一术语和禁用替代词。
4. 更新 CONTEXT.md 或相关文档。
5. 重大取舍新增或更新 ADR。
6. 对会作为后续决策或实施依据的正式 ADR、共享术语基线，内容稳定后使用 `document-reader-validation` 检验；普通术语编辑、仅供作者讨论的草稿无需执行。
7. 最终回复列出新增/修改术语和 ADR；执行读者检验时记录通过/未通过/未独立验证及关键发现。

## 输出格式
1. **术语变更**
2. **ADR 变更**
3. **影响的代码/文档命名建议**
4. **后续 Codex 应遵守的语言规则**
