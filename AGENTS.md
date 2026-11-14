# AGENTS.md

本文件为在本仓库工作的 AI Agent / 协作者约定，请在任何改动前先阅读。

## 仓库与远端

- 唯一远端：`origin` → `https://github.com/goldme2003/LaoDengWardrobe.git`
- 日常开发分支：`untested`（当前最新版本，含完整 Taro 小程序源码）
- 推送目标：`origin/untested`（`untested` 的 upstream）
- `main`：**仅为文档基线**，只保存 PRD / 开发日志 / 本约定文件，不用于日常开发，改动不得影响其内容与历史
- 不要新增其他远端；不要改写远端历史

## 版本一致性校验（开发前置，强制）

在本地执行代码操作、功能修改、逻辑调整等**任何变更动作之前**，必须先完成版本一致性校验；校验未完成或结论为「远端有更新但未同步」时，不得开始改动。

**基本原则：保留高版本。** 以版本号高者为准，任何同步动作都不得用低版本覆盖高版本；仅当远端版本号**严格高于**本地版本时才执行同步。远端版本低于或等于本地时，保持本地现状不做覆盖。

1. **拉取远端元数据**：`git fetch origin --prune`（必要时先用 `git ls-remote origin` 验证连通性）。此步只更新远端分支元数据，不改动工作区。
2. **双基准比对**：同时以 `origin/main`（文档基线 + 版本快照）与 `origin/untested`（日常开发线）为基准校验，维度为：
   - **提交时间**：远端分支最新提交时间是否晚于本地 `HEAD`；
   - **版本号**：读取 `package.json` 的 `version`，判断 `origin/main` 快照版本号是否**严格高于**本地当前版本。
3. **同步策略（安全同步）**：
   - `origin/untested` 版本号等于本地且提交更新 → 执行 `git pull --rebase` 同步，保持线性历史。
   - `origin/main` 版本号严格高于本地版本 → 说明已有更新版本快照，先向用户确认再对齐（`git checkout main && git pull` 或按快照版本建分支），**不得**直接用 `main` 覆盖 `untested` 工作区。
   - `origin/main` 版本号低于本地版本 → **保留本地高版本**，不拉取、不降级、不覆盖。
   - 工作区存在未提交改动（`git status --porcelain` 非空）→ **禁止**自动覆盖；提示用户并按其选择 `stash` / 提交 / 放弃，任何情况下不得静默丢弃本地改动。
   - 两个基准均不高于本地 → 结论记为「已是最新」，可继续后续改动。
4. **记录**：校验结论（基准分支、本地版本、远端版本、是否执行同步）需写入当次「开发日志」条目。

## 提交与推送（强制）

1. 所有开发在 `untested` 分支上进行；切换到 `untested` 后再开始改动。
2. 任何代码 / 文档修改完成后，**必须** `git commit` 并 `git push`，不允许只在本地保留改动。
3. 本仓库已配置 `push.default = upstream`，`git push` 直接推送到 `origin/untested`，不会推到 `main`；如需显式指定，使用 `git push origin untested`。
4. 推送前确认与远端同步（`git pull --rebase`），避免无谓的 merge 提交。
5. **禁止** `git push --force` / `--force-with-lease` 到任何共享分支。
6. **禁止** 改写已推送的提交（对已推送提交做 `rebase`、`commit --amend`）、删除或覆盖远端已有内容。
7. 提交信息遵循 Conventional Commits 前缀 + 中文描述，例如
   `feat: 新增衣物筛选`、`docs: 更新 PRD v0.3`、`fix: 修复照片组上传失败`。
8. **可预览版本推送约定（v1.2.0 起确认）**：每次经测试确认无 bug 的可预览版本，必须推送至 `origin/untested`；`package.json` 的 `version` 同步升版，开发日志追加条目并同步文件名版本号。

## 分支说明

| 分支 | 用途 | 说明 |
| --- | --- | --- |
| `untested` | 日常开发与预览版本 | v0.1.0-alpha 起，含 `src/`、`config/`、`cloudfunctions/` 全部源码；当前最新版本 v1.2.0；推送到此 |
| `main` | 文档基线 + 版本快照 | `docs/`、`.gitignore`、`AGENTS.md`；另承载经用户确认的版本快照（当前 v1.0.0 正式发布版，由 `untested` 合入）；日常开发仍在 `untested` |

## 网络与环境

- 本机访问 GitHub 需经本地代理 `127.0.0.1:7897`（verge-mihomo）。
- 本仓库已在 `.git/config` 中配置：
  `http.proxy = http://127.0.0.1:7897`、`https.proxy = http://127.0.0.1:7897`
- 若代理失效导致 `Connection was reset`，先用 `git ls-remote origin` 验证连通性，不要盲目重试；必要时改用 `socks5h://127.0.0.1:7897`。

## 项目文档

- `docs/PRD-v1.2.0.md`：产品需求文档（当前 v1.2.0，微信小程序「老登衣柜」）
- `docs/开发日志-v1.0.0.md`：按日期倒序记录每次更新与遇到的问题，改动后应追加条目
- `docs/数据库开发文档-v0.2.md`：数据库表结构、字段类型、表关系、存储名称/地址/端口；每次修改数据库结构需同步更新并推送
- 文档命名规则：PRD、开发日志与数据库开发文档的文件名携带版本号；每次更新以上文档时，同步更新文件名中的版本号
