---
name: ui-backend-contract-sync
description: 保证前端、后端、API、类型、文档、测试、权限、mock、OpenAPI/generated client 同步修改，并扫描旧字段/旧接口残留。Use when a change affects UI fields, backend DTOs, endpoints, database columns, permissions, routes, OpenAPI/types, generated clients, mocks, or docs.
---

# UI / Backend Contract Sync

## 目标
避免只改前端或只改后端造成字段不一致、页面假数据、接口漂移、权限缺口、旧字段残留和文档误导。

## 适用场景
- 后端 DTO、VO、实体、数据库字段、错误码、权限码、接口路径、请求/响应结构变化。
- 前端页面字段、表单、表格列、筛选项、路由、权限按钮、API client、TypeScript 类型变化。
- OpenAPI、generated client、mock、测试 fixture、文档示例需要同步。
- 用户感觉“前后端没对齐”“安全措施改了前端接口没跟上”。

## 必查同步面
- 数据库字段、实体、DTO、VO、Mapper、迁移脚本、索引、默认值。
- Controller/API 路径、HTTP 方法、请求体、响应体、错误码、分页排序、文件上传下载协议。
- OpenAPI/Swagger、generated client、SDK、TypeScript 类型、枚举、常量。
- 前端 API 调用、页面字段、表单校验、列表列、详情页、筛选项、导入导出。
- 权限码、菜单路由、按钮权限、后端鉴权、网关/拦截器策略。
- 文档、示例、测试、mock 数据、fixture、Playwright 脚本。
- 部署配置、环境变量、开关项、Nginx/gateway 代理路径。

## 契约图谱
开始修改前先列出契约图谱：
```text
DB/schema → Entity/Mapper → Service → Controller/API → OpenAPI/generated client → frontend api/types → page/component → tests/docs
```
每个变更点都要标记：新增、修改、删除、重命名、兼容保留。

## 硬规则
1. 新字段从 DB/API 到 UI 一链到底。
2. 删除字段必须删除所有调用、测试、文档和 mock。
3. 重命名字段不能只新增别名；必须说明旧字段删除策略。
4. 不允许前端继续兼容旧字段名，除非明确外部 API 灰度需要。
5. 不允许后端为了旧页面保留无用字段。
6. mock 只能用于开发辅助，不能掩盖真实接口缺失。
7. 权限前后端必须同名同义，不能只做前端隐藏。
8. 生成代码必须从源头重新生成或同步修改生成源，不得只手改 generated 文件。

## 旧契约残留扫描
字段删除、接口替换、权限码调整、错误码调整后，必须全仓扫描旧值：
- 旧字段名、旧 DTO/VO 属性、旧枚举值。
- 旧 API path、旧 HTTP 方法、旧 query/body 参数。
- 旧错误码、旧 i18n key、旧权限码、旧菜单 code、旧按钮 code。
- mock、fixture、测试快照、OpenAPI、generated client、README、部署文档、示例 curl。
- 前端路由、代理配置、Nginx/gateway rewrite、环境变量。

建议命令示例：
```bash
rg -n "oldField|old_field|/old/api/path|OLD_PERMISSION|old.error.code" .
```

## 兼容例外
只有以下情况允许临时兼容：
- 外部公共 API 已有用户使用；
- 生产多版本客户端并存；
- 数据库 expand-contract 迁移窗口；
- 灰度发布必须短期双读/双写。

每个兼容点必须写明：原因、范围、关闭条件、删除计划和扫描标记。

## 验收方式
- API 测试或集成测试覆盖请求/响应。
- 前端 typecheck/build 通过。
- 页面真实调用或代理请求验证。
- OpenAPI/generated client 与实现一致。
- 文档字段与实现一致。
- 旧字段/旧接口/旧权限码全仓扫描无残留，或残留均有解释。

## 输出格式
1. **契约变更点**
2. **契约图谱**
3. **同步修改清单**
4. **删除的旧契约**
5. **兼容例外及删除计划**
6. **验证命令**
7. **残留扫描结果**
