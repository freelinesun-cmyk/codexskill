# 发布规则

本插件每次更新都应执行以下步骤：

1. 修改源码并完成语法与功能回归。
2. 更新 `manifest.json` 中的版本号。
3. 在 `CHANGELOG.md` 顶部追加新版本说明和发布日期。
4. 重新生成 `releases/百变大侦探后台辅助工具-vX.Y.Z.zip`。
5. 提交源码和安装包，提交信息使用 `Release baibian admin helper vX.Y.Z`。
6. 创建 Git 标签 `baibian-admin-helper-vX.Y.Z`。
7. 创建对应 GitHub Release，并附上 ZIP 安装包。

发布前必须确认安装包能够通过 `unzip -t`，并确保仓库中没有账号凭据、
Cookie、Token、私钥或本地环境文件。

