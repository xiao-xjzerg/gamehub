# 部署说明

运行环境为 **Node.js 26.10.0**。公开服务监听 `127.0.0.1:8001`，管理服务监听 `127.0.0.1:8002`；Nginx 只代理公开服务，管理后台通过 SSH 通道访问。

## 构建发布包

将 `deploy/source-lock.example.json` 复制到仓库外，填写门户与四款游戏共五个源码仓库的路径、GitHub 地址、分支和完整提交 SHA。源码工作区须干净，资源可分发时设置 `artworkDistributionConfirmed=true`。

```powershell
node scripts/build-release.mjs --lock ../release/source-lock.json --output ../release/artifacts/my-release
node scripts/verify-release.mjs ../release/artifacts/my-release
```

输出目录必须尚不存在。`publication=pending` 用于本地构建；`published` 会验证远程分支与锁定提交一致。`codeLicense=UNLICENSED` 表示项目未设置开源许可，第三方原始许可仍随包保留。

产物包括私有运行目录 `app/`、公开资源 `public/gamehub/` 和逐文件 SHA-256 清单 `release-manifest.json`。四款游戏从包内运行，无需相邻源码目录或外部 CDN；Solovs（test）开放游玩和返回门户，排行榜及开局、结算统计尚未启用。数据库与服务器凭据独立于部署包保存。

## 服务器目录与配置

```text
/opt/gamehub/
  runtime/node-v26.10.0-linux-x64/
  releases/<版本>/
    app/
    public/gamehub/
    release-manifest.json
  current -> releases/<版本>
  data/gamehub.sqlite
  backups/
/etc/gamehub/gamehub.env
```

`deploy/gamehub.service` 为 systemd 示例，`deploy/gamehub.env.example` 为环境配置示例。按服务器路径和域名填写配置；`GAMEHUB_DB` 必须指向版本目录外的固定绝对路径，如 `/opt/gamehub/data/gamehub.sqlite`。服务用户需要数据与备份目录的写权限。

安装对应 Node 版本并校验官方 SHA-256，将发布包放入新的版本目录，在该目录执行：

```bash
/opt/gamehub/runtime/node-v26.10.0-linux-x64/bin/node app/scripts/verify-release.mjs .
```

设置 `current` 后安装服务配置，执行 `systemctl daemon-reload` 和 `systemctl start gamehub`。先通过回环地址检查 `/gamehub/api/health`、门户和游戏入口。

将 `deploy/nginx-gamehub.conf` 加入站点的 `server` 配置块，保留已有首页和其他路由。执行 `nginx -t`，通过后再平滑重载。Nginx 使用 `$remote_addr` 覆盖 `X-Real-IP`；启用这一配置并保持应用回环监听后，才设置 `GAMEHUB_TRUST_PROXY=true`。HTTPS 部署时设置 `GAMEHUB_SECURE_COOKIE=true`。

管理端口不对公网开放，也不通过 Nginx 代理。统计日期按北京时间计算，systemd 配置仅为 GameHub 进程设置 `TZ=Asia/Shanghai`。

## 数据备份与迁移

所有游戏共用同一个 SQLite 数据库，保存游客、访问、对局、成绩、统计和管理员信息。代码更新继续使用原数据路径。

```powershell
node scripts/db-tool.mjs backup ../data/gamehub.sqlite ../backups/gamehub.sqlite
node scripts/db-tool.mjs inspect ../backups/gamehub.sqlite
node scripts/db-tool.mjs restore ../backups/gamehub.sqlite ../restore-check/gamehub.sqlite
```

备份工具生成一致性快照和 `.json` 校验信息，检查完整性、外键、数据库版本和记录数量。恢复只能写入新路径，不能覆盖已有数据库。

首次迁入服务器时，在服务停止且目标数据库不存在的情况下，通过 SSH/SCP 传输备份及其 `.json`，恢复到 `/opt/gamehub/data/gamehub.sqlite`，核对记录数量后再启动。历史成绩、游客关联和管理员信息一起保留；更换域名可能产生新的游客 Cookie，但不会删除旧成绩。定时备份可采用每周一次、保留 31 天，每次发布前额外生成一致性备份。

## 管理员与 SSH 访问

已有管理员可使用原密码。首次设置时在服务器交互终端执行：

```bash
sudo -u gamehub env GAMEHUB_DB=/opt/gamehub/data/gamehub.sqlite /opt/gamehub/runtime/node-v26.10.0-linux-x64/bin/node /opt/gamehub/current/app/scripts/admin-password.mjs
```

密码为 6–128 个字符，无默认密码。登录后在设置页修改；忘记时执行同一脚本并加 `--reset`。改密会使所有旧会话失效。

```powershell
ssh -N -L 18002:127.0.0.1:8002 <SSH用户名>@<服务器地址>
```

保持通道开启，浏览器访问 **http://127.0.0.1:18002/admin/**。SSH 默认使用 22 端口，其他端口用 `-p <端口>` 指定。

## 游戏更新与回滚

游戏代码在独立仓库维护，部署包根据来源锁定文件中的提交 SHA 组合；未变更的仓库沿用原提交。每次生成完整组合包，包含门户与四款游戏；只有游戏内容变化时无需修改门户源码。已部署版本保持完整，更新使用新的版本目录，避免破坏文件哈希与回滚记录。

回滚代码时停止服务，将 `current` 切回上一版本，再沿用当前数据库启动。当前数据库结构版本为 4，后端拒绝打开高于自身支持版本的数据库。包含结构迁移的版本须在备份副本上验证旧代码兼容性；代码回滚不会自动降级数据库，旧备份不能覆盖新增成绩。
