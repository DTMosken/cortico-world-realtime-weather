<!-- Owner: .github/workflows/release.yml, .github/workflows/ci.yml -->
# 发布

CI 在 push、PR 和手动运行时检查测试、类型、WebUI 构建、扩展契约与打包内容。Node.js 24，Cortico 基线使用 release.yml 的 CORTICO_REF；两个工作流使用同一基线。

Release 从 main 手动运行：patch/minor/major 创建版本 PR；publish 发布 npm 并创建 GitHub Release；finish 核对已发布 tarball 后补建 GitHub Release。发布说明取自 CHANGELOG.md 对应版本。

首次发布需要 npm 登录及发布认证。包建立后配置 npm Trusted Publisher：用户 DTMosken、仓库 cortico-world-realtime-weather、workflow release.yml、Environment 留空、允许 npm publish。后续工作流使用 OIDC，不保存 NPM_TOKEN。

本地 bot 正在运行时，使用隔离目录或 CI 构建，不能覆盖其正在使用的 WebUI 产物。
