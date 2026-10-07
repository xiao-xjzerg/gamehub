# GameHub 接口与统计约定

公开接口前缀为 `/gamehub/api/`，浏览器使用同源请求，响应为 JSON UTF-8。支持 HappyJump、3d_runway 和 Gogodown 的游客身份、对局、排行榜与统计。Solovs 不开放排行榜。

## 身份与错误

`GET /guest` 首次创建游客，返回 `{guestId,nickname,visitId,csrfToken}`。随机 256 位令牌仅放 `gamehub_guest` Cookie，数据库仅存 SHA-256。Cookie 设置 HttpOnly、SameSite=Lax、Path=/gamehub/、一年有效期；HTTPS 部署时设置 `GAMEHUB_SECURE_COOKIE=true`。guestId 是内部标识而不是凭据，不能用昵称合并游客。玩家使用游客身份；后端按访问会话记录首次和最近 IP。

所有公开 POST 先获取 `/guest`，携带 Cookie 和 `X-GameHub-CSRF`；Content-Type 必须是 application/json。请求体最多 8192 字节。浏览器 Origin 必须匹配 GAMEHUB_ORIGIN；未设置时仅接受实际监听端口的 `http://127.0.0.1:<port>`。无 Origin 的本地客户端仍必须携带游客凭据和 CSRF token。

失败格式：`{"error":{"code":"INVALID_METRICS","message":"..."}}`。客户端仅在 2xx 后显示保存成功；超时、网络断开、5xx 可用原 requestId/原内容重试，不能创建新对局冒充重试。

| HTTP | 典型 code | 含义 |
| --- | --- | --- |
| 400 | INVALID_JSON / INVALID_RUN / INVALID_METRICS / INVALID_DURATION / INVALID_NICKNAME / INVALID_RULES / INVALID_LIMIT / INVALID_OUTCOME / INVALID_ENTRY / INVALID_HEARTBEAT | 参数、范围或规则错误 |
| 401 | GUEST_REQUIRED | Cookie 缺失或游客不存在 |
| 403 | CSRF_REJECTED / ORIGIN_REJECTED | 身份或跨站校验失败 |
| 404 | RUN_NOT_FOUND / PAGE_NOT_FOUND / GAME_NOT_FOUND / NOT_FOUND | 对局或页面不存在、不属于当前游客或资源不存在 |
| 409 | IDEMPOTENCY_CONFLICT / STALE_HEARTBEAT / RUN_NOT_FINISHED / RUN_EXPIRED / RANKING_DISABLED | 状态冲突、对局过期或未开放 |
| 413 / 415 | BODY_TOO_LARGE / JSON_REQUIRED | 内容过大或媒体类型不支持 |
| 429 | RATE_LIMITED | 每来源 IP 每分钟 180 次公开 API 请求，Retry-After=60 |
| 500 / 503 | INTERNAL_ERROR / BUSY | 内部故障或限流状态容量不足 |

默认按连接来源 IP 限流，忽略客户端转发头。仅在应用保持回环监听、Nginx 覆盖 `X-Real-IP` 且设置 `GAMEHUB_TRUST_PROXY=true` 时，采用代理提供的来源 IP，分别计算各来源的配额。

## 接口

以下路径均相对公开前缀。

| 方法 / 路径 | 内容 |
| --- | --- |
| GET /health | `{ok:true}` |
| GET /games | `{games:[{id,name,description,playUrl,coverUrl,mode,rulesVersion,ranking,available}]}`，不包含源码目录 |
| GET /guest | 初始化/复用游客和访问会话 |
| POST /entries | `{pageId,gameId}` → 201 `{pageId,replayed:false}`；页面实例 UUID 去重 |
| POST /runs | `{requestId,gameId,mode,rulesVersion}` → 201 `{runId,startedAt,replayed:false}` |
| POST /runs/:id/finish | `{outcome,metrics}` → 200 `{runId,finishedAt,replayed}` |
| POST /runs/:id/score | `{nickname}` → 201 `{scoreId,replayed:false}` |
| GET /leaderboards/:gameId | 可选 mode、rulesVersion、limit（默认 10，1–100），公开返回当前规则下所有已提交成绩的全站排名；每次成功提交独立占据名次 |

requestId 使用客户端 UUID，并在一次开局的重试期间保持不变。`guestId + requestId` 唯一：相同开局内容返回原 runId/200，不同内容返回 409。每局最多一次 finish 和一次 score；相同内容重试返回原结果/200，不同内容 409。数据库事务同时写入业务记录和事件，重复请求不会重复计数。对局最长 24 小时，超过后不可首次结算，已完成对局仍可幂等重试。

结算只记录对局；玩家在结算页主动点击提交昵称、成功调用 score 接口后，成绩才进入排行榜。未提交昵称的已结算对局不入榜。

前三款 outcome 固定 `completed`（正常游戏结束，不表示获胜）。异常关闭、掉线、刷新不调用正常结算，保留未完成对局。结算先固定成绩，再提交昵称；昵称 1–16 个 Unicode 字符，去两端空白、NFC 归一化、不含控制/格式字符，展示必须用 textContent。

## 计分字段与排序

前三款 mode 为 default，rulesVersion 为 v1。未知模式/版本拒绝，不跨版本混榜。记录时间由服务器生成，不接收客户端 createdAt。排行榜不返回 guestId、Cookie、对局 ID。

| 游戏 | metrics（字段必须完整且无多余字段） | 比较顺序 |
| --- | --- | --- |
| happyjump | score、level | score↓、level↓、受理时间↑、成绩 ID↑ |
| 3d-runway | coins、score、time（秒，归一到 0.1 秒） | coins↓、score↓、time↑、受理时间↓、成绩 ID↑ |
| gogodown | floor、level、duration（秒，归一到毫秒） | floor↓、level↓、duration↑、受理时间↓、成绩 ID↑ |
| solovs | 空对象 | 不开放 |

非时间字段为 0–100,000,000 的整数，level 至少 1。时间 0–86,400 秒，不得超过服务端对局经过时间加 2 秒容差。这里只做有限基础校验，不宣称客户端成绩可信或具备完整反作弊。

排行榜直接对已提交成绩按该游戏的比较顺序进行全局排序；同一游客多次成功提交、不同游客使用相同昵称，都分别占据名次。页面显示前十条，API 可通过 limit 查看最多 100 条；已有成绩不因显示条数或排序逻辑而删除。改变玩法必须更新规则版本，旧 localStorage 不导入。

## 统一统计口径

| 事件 | 去重 / 语义 |
| --- | --- |
| visit_start | 后端建立访问会话时一次；闲置 30 分钟后新建；刷新或多标签在会话有效期内复用 |
| run_start | 后端接受有效开局时一次，requestId 去重 |
| run_finish | 后端正常结算一次；不是提交昵称次数 |
| score_submit | 接受昵称成绩一次，runId 唯一 |
| game_enter | 每游戏页面进入一次，独立于开局；页面实例 ID 去重 |
| heartbeat | 15 秒周期及状态切换时发送；pageId + seq 去重，单次最多 20 秒，服务器时间与页面已记录区间封顶；前台页面与实际游玩分开累计 |

`POST /pages` 用 `{pageId,kind:'portal'|'game',gameId?}` 注册页面；原 `POST /entries` 仍可注册游戏页面，两者使用相同页面 ID 时不会重复记游戏进入。`POST /heartbeats` 用 `{pageId,seq,startedAt,endedAt,playing}` 报送可见区间。页面需属于当前游客；重复序号/内容可重放，不同内容冲突；迟到超过 30 秒、单段超过 20 秒或未来时间无效。服务端与既有区间取交集，防止同页面重复累计。

隐藏页不累计前台时间，未游玩或游戏结束不累计实际游玩；同游客多标签同类别时间区间合并，不能直接相加。刷新续用访问会话，掉线不补报整段离线时长，不依赖 unload。近期活跃按最后 60 秒心跳估计并标注“估算”。独立运行的游戏不请求门户计时接口。

当前不自动删除心跳、访问、对局或成绩数据。

## 数据与服务边界

启动自动执行版本化迁移 `server/migrations/001_initial.sql`、`002_game_enter.sql`、`003_telemetry.sql` 和 `004_admin_access.sql`，PRAGMA user_version=4，开启外键、WAL、5 秒 busy_timeout。默认数据位于仓库外的 `../data/gamehub.sqlite`（可通过 GAMEHUB_DB 覆盖），不在静态根，也不进入 Git。数据库同时保存访问 IP 和管理员凭据/会话；一致性备份使用 `scripts/db-tool.mjs`，不能只复制运行中的主数据库文件。

默认只监听 127.0.0.1；公开应用没有管理路由或根目录静态挂载。管理页面/API 由独立回环端口提供（开发默认 4174、生产默认 8002，可通过 GAMEHUB_ADMIN_PORT 调整），只通过 SSH 本地转发访问。开发模式读取相邻游戏白名单目录；生产模式读取发布包 public/gamehub/play/。生产清单将 Solovs 标记 available=false，禁止其开局与进入，门户保留开发中卡片。第三方脚本使用固定资源白名单。

首次使用后台时，在交互式终端运行 `node scripts/admin-password.mjs` 设置 6–128 个字符的密码；已有密码只能在已登录的“设置”页面凭旧密码修改，或由有服务器终端权限的人运行 `--reset` 重置。数据库仅保存随机盐和 scrypt 密码摘要；会话使用随机令牌，数据库只存令牌摘要，HttpOnly、SameSite=Strict Cookie 有效 8 小时。改密会撤销所有管理会话。登录接口有失败次数限制，所有管理数据接口必须有有效会话；改密/退出还要求同源 Origin 和 CSRF 请求头。后台无默认密码、自助注册或公开代理路由。

| 私有管理接口 | 作用 |
| --- | --- |
| GET `/admin/api/session` | 当前登录状态、是否需初始化密码；已登录时返回本会话 CSRF 令牌 |
| POST `/admin/api/login` | 验证 `{password}`，建立管理员会话 |
| POST `/admin/api/logout` | 注销当前会话 |
| POST `/admin/api/change-password` | `{currentPassword,newPassword}`；成功后全部会话失效 |
| GET `/admin/api/summary` | 今日/累计及各游戏、游客汇总；需要登录 |
| GET `/admin/api/users/:id` | 某游客最近 30 次访问和对局；需要登录 |
| GET `/admin/api/games/:id` | 某游戏最近 30 局；需要登录 |

统计“今日”以北京时间当天 00:00 为起点；访问按访问会话计，开局按已接受的对局计，入榜只计成功提交昵称的成绩。页面前台/运行时长是心跳估算。记录真实访问 IP 时，生产 Nginx 必须覆盖 `X-Real-IP` 并保持应用仅监听回环地址，此后才设置 `GAMEHUB_TRUST_PROXY=true`；IP 不作为玩家身份。

管理服务只提供 `/admin/`、固定 JS/CSS，以及 `/admin/assets/` 下的五张 WebP（四款游戏封面与网站背景）；图片复用 `portal/assets/` 文件。页面使用仅同源脚本、样式、图片与请求的内容安全策略。公开服务不提供管理资源路径。首页顶部榜单入口切换各游戏的排行榜，不合并不同游戏分数。

门户 HTML 不缓存；JS/CSS 缓存 5 分钟，WebP 图片缓存 1 小时，固定版本依赖缓存 1 天。release-manifest.json 记录来源提交及文件 SHA-256。

运行环境为 Node 26.10.0，使用内置 node:sqlite 的同步 DatabaseSync 与一致性 backup API，无第三方后端运行依赖。服务按单进程运行，适用于小规模游戏门户。
