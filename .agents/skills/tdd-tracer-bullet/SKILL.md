---
name: tdd-tracer-bullet
description: 用红-绿-重构的纵切片 TDD 方式实现功能或修复。Use when user asks for TDD, test-first, integration tests, or when a risky change needs behavior locked before implementation.
---


# TDD Tracer Bullet

## 目标
用一个行为测试带动一个最小实现，反复红-绿-重构，避免一次写一堆想象中的测试和代码。

## 测试哲学
- 好测试验证外部可观察行为，不验证私有实现细节。
- 优先公共接口、API、页面交互、CLI 输出、任务效果。
- 少 mock 内部协作者；可以 mock 外部不可控依赖。
- 测试名使用项目领域词，不用临时技术黑话。

## 禁止事项
- 不允许“先写全部测试，再写全部实现”的横向切片。
- 不允许为了测试暴露私有方法或污染生产接口。
- 不允许只断言“不报错”。
- 不允许在 RED 阶段做重构。

## 工作流程
1. 选第一个 tracer bullet：最小但真实的业务路径。
2. RED：写一个行为测试，确认失败且失败原因正确。
3. GREEN：写最少代码让它通过。
4. REPEAT：下一个行为再写一个测试。
5. REFACTOR：全部相关测试通过后再整理设计。
6. FULL CHECK：运行相关测试、类型检查、构建。

## 输出格式
1. **行为列表**
2. **TDD 切片顺序**
3. **新增/修改测试**
4. **实现改动**
5. **重构内容**
6. **验证结果**
