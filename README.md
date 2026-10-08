# GameHub

GameHub 是网页游戏门户，提供游客游玩、公开排行榜和通过 SSH 通道访问的管理后台。当前接入 **HappyJump、3d_runway、Gogodown、Solovs（test）**；Solovs 开放试运行，不开放排行榜。

排行榜向所有访客展示前十名；每次成功提交昵称的成绩独立参与排名，未提交昵称的成绩不入榜。

## 环境与启动

使用 **Node.js 26.10.0**，见 `.node-version`。数据库使用 Node 内置 SQLite，无需安装数据库服务或运行时 npm 依赖。

在本仓库目录运行：

```powershell
npm run dev
```

门户：**http://127.0.0.1:4173/gamehub/**；后台：**http://127.0.0.1:4174/admin/**。按 `Ctrl+C` 停止。

开发模式按以下布局读取独立游戏源码；目录位置可在 `shared/games.json` 中配置：

```text
workspace/
  HappyJump/
  3d_runway/
  Gogodown/
  Solovs/
    Solovs_dev_0/
  gamehub/
    gamehub_dev/    本仓库
    data/           持久数据库
```

首次使用后台，在交互式终端设置密码：

```powershell
node scripts/admin-password.mjs
```

密码长度为 **6–128 个字符**，没有默认密码。登录后可在“设置”修改密码；忘记密码时可通过终端执行 `node scripts/admin-password.mjs --reset`。改密后需要重新登录。

## 管理与配置

后台包含总览、游戏管理、用户管理和设置，展示访问、进入、开局、结算及入榜统计。玩家使用游客身份；IP 表示网络来源，页面停留与游玩时长由心跳估算。

Solovs（test）提供试运行入口和返回门户功能，暂未接入开局、结算及游玩时长统计，也不提交排行成绩。

配置示例见 `.env.example`。程序通过环境变量读取配置，不会自动加载 `.env` 文件。

| 配置 | 用途 |
| --- | --- |
| `PORT` | 公开服务端口；开发默认 4173，普通启动默认 8001 |
| `GAMEHUB_ADMIN_PORT` | 管理服务端口；开发默认 4174，普通启动默认 8002 |
| `GAMEHUB_DB` | SQLite 路径；本地默认 `../data/gamehub.sqlite` |
| `GAMEHUB_ORIGIN` | 允许提交请求的网站来源，不包含 `/gamehub/` 路径 |
| `GAMEHUB_TRUST_PROXY` | 是否采用可信反向代理覆盖的来源 IP |
| `GAMEHUB_SECURE_COOKIE` | HTTPS 部署时启用安全 Cookie |

两个服务均监听回环地址。服务器后台通过 SSH 转发访问，具体命令见 [部署说明](docs/DEPLOYMENT.md)。数据库、备份和服务器凭据不进入 Git，也不随代码更新替换。

## 项目结构

| 目录 | 作用 |
| --- | --- |
| `portal/` | 首页、公开排行榜及网页图片 |
| `admin/` | 管理端登录和统计界面 |
| `server/` | HTTP 服务、数据库、统计及结构迁移 |
| `shared/` | 游戏清单与排名规则 |
| `assets/source/` | 美术源图 |
| `assets/vendor/` | 固定版本第三方代码及原始许可 |
| `scripts/` | 启动、密码设置、图片优化、构建及备份工具 |
| `docs/` | 接口与部署说明 |
| `deploy/` | 来源锁定、Nginx、systemd 和环境配置模板 |

首页入口为 `portal/index.html`，后台入口为 `admin/index.html`。数据库由 `server/store.mjs` 自动执行 `server/migrations/*.sql` 构建。

游戏分别维护源码，GameHub 构建工具将指定版本组合为部署包，并随站提供固定版本依赖。构建、数据备份和回滚方法见 [部署说明](docs/DEPLOYMENT.md)，接口和计分规则见 [API 文档](docs/API.md)。
