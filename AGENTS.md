# AGENTS.md

本文件为在本仓库工作的 AI Agent / 协作者约定，请在任何改动前先阅读。

## 仓库与远端

- 唯一远端：`origin` → `https://github.com/goldme2003/LaoDengWardrobe.git`
- 默认分支：`main`（`origin/HEAD` 指向 `origin/main`）
- 其他远端分支：`untested`（预览初版 v0.1.0-alpha，含 Taro 小程序源码）
- 不要新增其他远端；不要改写远端历史。

## 提交与推送（强制）

1. 任何代码 / 文档修改完成后，**必须** `git commit` 并 `git push origin <分支>`，不允许只在本地保留改动。
2. 推送前先 `git pull --rebase` 或确认与远端同步，避免无谓的 merge 提交。
3. **禁止** `git push --force` / `--force-with-lease` 到任何共享分支。
4. **禁止** 改写已推送的提交（`rebase`、`commit --amend` 已推送的提交）、删除或覆盖远端已有内容。
5. 提交信息遵循仓库现有风格：Conventional Commits 前缀 + 中文描述，例如
   `feat: 新增衣物筛选`、`docs: 更新 PRD v0.3`、`fix: 修复照片组上传失败`。

## 网络与环境

- 本机访问 GitHub 需经本地代理 `127.0.0.1:7897`（verge-mihomo）。
- 本仓库已在 `.git/config` 中配置：
  `http.proxy = http://127.0.0.1:7897`、`https.proxy = http://127.0.0.1:7897`
- 若代理失效导致 `Connection was reset`，先用 `git ls-remote origin` 验证连通性，不要盲目重试；必要时改用 `socks5h://127.0.0.1:7897`。

## 项目文档

- `docs/PRD.md`：产品需求文档（当前 v0.2，微信小程序「老登衣柜」）
- `docs/开发日志.md`：按日期倒序记录每次更新与遇到的问题，改动后应追加条目
