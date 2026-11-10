# AGENTS.md

本文件为在本仓库工作的 AI Agent / 协作者约定，请在任何改动前先阅读。

## 仓库与远端

- 唯一远端：`origin` → `https://github.com/goldme2003/LaoDengWardrobe.git`
- 日常开发分支：`untested`（当前最新版本，含完整 Taro 小程序源码）
- 推送目标：`origin/untested`（`untested` 的 upstream）
- `main`：**仅为文档基线**，只保存 PRD / 开发日志 / 本约定文件，不用于日常开发，改动不得影响其内容与历史
- 不要新增其他远端；不要改写远端历史

## 提交与推送（强制）

1. 所有开发在 `untested` 分支上进行；切换到 `untested` 后再开始改动。
2. 任何代码 / 文档修改完成后，**必须** `git commit` 并 `git push`，不允许只在本地保留改动。
3. 本仓库已配置 `push.default = upstream`，`git push` 直接推送到 `origin/untested`，不会推到 `main`；如需显式指定，使用 `git push origin untested`。
4. 推送前确认与远端同步（`git pull --rebase`），避免无谓的 merge 提交。
5. **禁止** `git push --force` / `--force-with-lease` 到任何共享分支。
6. **禁止** 改写已推送的提交（对已推送提交做 `rebase`、`commit --amend`）、删除或覆盖远端已有内容。
7. 提交信息遵循 Conventional Commits 前缀 + 中文描述，例如
   `feat: 新增衣物筛选`、`docs: 更新 PRD v0.3`、`fix: 修复照片组上传失败`。

## 分支说明

| 分支 | 用途 | 说明 |
| --- | --- | --- |
| `untested` | 日常开发与预览版本 | v0.1.0-alpha 起，含 `src/`、`config/` 全部源码；推送到此 |
| `main` | 文档基线 + 版本快照 | `docs/`、`.gitignore`、`AGENTS.md`；另承载经用户确认的版本快照（当前 v0.3a，由 `untested` 合入）；日常开发仍在 `untested` |

## 网络与环境

- 本机访问 GitHub 需经本地代理 `127.0.0.1:7897`（verge-mihomo）。
- 本仓库已在 `.git/config` 中配置：
  `http.proxy = http://127.0.0.1:7897`、`https.proxy = http://127.0.0.1:7897`
- 若代理失效导致 `Connection was reset`，先用 `git ls-remote origin` 验证连通性，不要盲目重试；必要时改用 `socks5h://127.0.0.1:7897`。

## 项目文档

- `docs/PRD-v0.7.0.md`：产品需求文档（当前 v0.7.0 规划版，微信小程序「老登衣柜」）
- `docs/开发日志-v0.6.0.md`：按日期倒序记录每次更新与遇到的问题，改动后应追加条目（随版本更新改名，当前记录至 v0.6.0，v0.7.0 条目仍追加于本文件，文件名在 v0.7.0 收尾时同步升版）
- `docs/数据库开发文档-v0.2.md`：数据库表结构、字段类型、表关系、存储名称/地址/端口；每次修改数据库结构需同步更新并推送
- 文档命名规则：PRD、开发日志与数据库开发文档的文件名携带版本号；每次更新以上文档时，同步更新文件名中的版本号
