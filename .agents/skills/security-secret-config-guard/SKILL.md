---
name: security-secret-config-guard
description: 保护密钥、配置、日志、上传文件、本地 ignored 配置和导出文档。Use when reading env files, deployment configs, credentials, tokens, private URLs, logs, CI/CD variables, or generating docs/scripts that mention runtime configuration.
---

# Security / Secret / Config Guard

## 目标
在允许使用真实环境配置完成本地验证的同时，防止密钥泄露、硬编码、误提交、日志外传、文档夹带和压缩包夹带。

## 敏感信息范围
密码、token、API key、secret、cookie、session、JWT、私钥、公钥证书私有部分、证书密码、数据库/Redis/MinIO/ES/MQ 凭据、连接串、内网地址、生产 URL、生产用户数据、手机号、邮箱、身份证、CI/CD 变量、云服务密钥、SSH 配置、VPN/代理配置、License、Webhook URL。

## 脱敏标准
默认只允许展示以下信息：
- key 名称，例如 `DB_PASSWORD`、`MINIO_SECRET_KEY`。
- 来源位置，例如 `.env.local`、`application-prod.yml`、CI secret 名称。
- 是否存在，例如 `present=true/false`。
- 长度，例如 `len=32`。
- 类型或来源，例如 `from env`、`from ignored file`、`from secret manager`。
- 必要时用于比对的短 hash，例如 `sha256:ab12cd34`；不要把 hash 当成公开值传播。
- 必要时展示尾四位，例如 `****1234`；默认不展示，除非需要和用户核对。

禁止展示：
- 完整 token、cookie、密码、私钥、连接串、Authorization header。
- 完整生产 URL 中带签名、token、用户名密码或敏感路径的部分。
- 能直接访问内部服务的完整凭据组合。
- 用户上传文件中的隐私数据原文。

## 使用真实配置的规则
1. 可读取本地 ignored 配置用于运行验证，但不得打印完整值。
2. 文档和示例只能写占位符或用户已明确公开可写的信息。
3. 新增日志不能输出请求头、token、密码、完整连接串、Cookie、Set-Cookie。
4. 提交前扫描 staged diff、新增文件、导出包、文档、脚本，确认无密钥。
5. 配置应从环境变量、secret 文件、配置中心或本地 ignored 文件读取。
6. 测试缺密钥时应报清晰错误，不要回退到硬编码默认密钥。
7. 导出的部署文档区分“示例值”和“真实值由用户自行填写”。
8. 不把真实值写入 README、CHANGELOG、交接文档、测试快照、截图 OCR、日志附件、zip 包。

## 扫描建议
基础扫描：
```bash
rg -n --hidden --glob '!.git/**' --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!target' --glob '!*.png' --glob '!*.jpg' --glob '!*.jpeg' --glob '!*.gif' --glob '!*.zip' --glob '!*.pdf' --glob '!*.docx' "password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|cookie|jdbc:|redis://|mongodb://|AKIA|BEGIN .*PRIVATE KEY"
```

优先扫描当前变更和受版本控制的文本，避免把 `.git` 历史、二进制资产或构建产物当作新增泄露：
```bash
git grep -n -I -E "password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|cookie|jdbc:|redis://|mongodb://|AKIA|BEGIN .*PRIVATE KEY" -- .
git diff --cached --text -- .
git diff --text -- .
```

Git diff 扫描：
```bash
git diff --cached -- .
git diff -- .
```

可选工具扫描，存在才运行，不强制安装；优先复用按全局 AGENTS 配置核实过的 Gitleaks 绝对路径。没有版本库扫描需求时使用 `dir`，避免把历史提交当作当前新增问题；报告写入项目 ignored 的 `target`、`.codex/tmp` 或 `output`，只展示规则、文件、行号和计数：
```powershell
& 'C:\Users\16147\.codex\tools\gitleaks\8.30.1\gitleaks.exe' dir . --redact=100 --no-banner --report-format json --report-path 'target\gitleaks-report.json'
trufflehog filesystem . --no-update --only-verified
```

重点检查：
- `.env*`、`application*.yml/yaml/properties`、`docker-compose*.yml`、Helm/K8s、Nginx、CI/CD、脚本、README、日志新增行。
- zip/docx/pdf/html/md 导出内容是否包含真实密钥。
- 测试快照、Playwright trace、截图、HAR 文件是否包含 Authorization、Cookie 或用户隐私。

## 安全修复规则
- 发现泄露风险时，先停止传播：删除导出包、清理日志、替换占位符。
- 如果密钥已经可能进入 git、日志、CI 或外发文档，必须提示用户轮换密钥。
- 不擅自生成生产密钥；只生成本地开发占位符或说明生成命令。
- 不为了让测试通过写入弱默认密钥；测试用密钥必须清晰标注为 local/test only。

## 输出格式
1. **涉及的敏感配置面**
2. **采取的保护措施**
3. **配置读取方式**
4. **脱敏展示口径**
5. **泄露扫描结果**
6. **用户需要自行填写或轮换的值**
