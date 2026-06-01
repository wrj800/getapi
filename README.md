# 公益 AI 站 Vercel MVP

这是一个不依赖自有服务器的公益 AI 站 MVP。部署完成后，前台、登录、后台、聊天代理都运行在 Vercel；用户数据和额度放在 Vercel KV 或 Upstash Redis。

## 已有功能

- 普通用户注册、登录、退出
- 管理员账号独立登录
- 登录/注册限流
- 邀请码注册
- HttpOnly 签名 Cookie Session
- PBKDF2 密码哈希
- 10 个模型白名单
- 用户模型权限
- 每日额度、总额度
- 聊天请求扣额度，失败自动退回
- 管理后台：用户列表、禁用/启用、切换角色、调整今日额度
- 后台生成/停用邀请码
- 后台精确调整用户每日额度、总额度、清零已用量
- 后台勾选单个用户可用模型
- 用量统计：请求数、输入字符、输出字符、最近调用
- 多个 NVIDIA key 轮询
- 上游 `NVIDIA_API_KEY` 只存在 Vercel 环境变量
- 流式输出

## 必填 Vercel 环境变量

```text
NVIDIA_API_KEYS=nvapi-key-1,nvapi-key-2
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
AUTH_SECRET=一段足够长的随机字符串
ADMIN_EMAIL=你的管理员账号，例如 root
ADMIN_PASSWORD=你的管理员密码
```

还必须配置一个 Redis REST 存储，二选一：

```text
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

或：

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

如果 Vercel Marketplace 自动生成了带前缀的变量，例如
`UPSTASH_REDIS_REST_KV_REST_API_URL` / `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`，本项目也会自动识别。

## 可选环境变量

```text
ALLOW_PUBLIC_REGISTER=true
REQUIRE_INVITE_CODE=true
DEFAULT_DAILY_CREDITS=30
DEFAULT_TOTAL_CREDITS=1000
ADMIN_BYPASS_QUOTA=true
LOGIN_RATE_LIMIT_WINDOW_SECONDS=300
LOGIN_RATE_LIMIT_MAX=8
REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600
REGISTER_RATE_LIMIT_MAX=4
MAX_HISTORY_MESSAGES=18
MAX_OUTPUT_TOKENS=1800
```

## 管理员首次登录

配置 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 后，直接用这组账号登录。`ADMIN_EMAIL` 可以是邮箱，也可以是 `root` 这样的管理员账号。系统会在第一次登录时自动创建管理员用户。

## 邀请码

默认 `REQUIRE_INVITE_CODE=true`，普通用户注册需要邀请码。管理员登录后台后，可以生成一次性邀请码并发给用户。

如果你想临时开放注册，可以设置：

```text
REQUIRE_INVITE_CODE=false
```

## Key Pool

`NVIDIA_API_KEYS` 支持多个 key，用英文逗号或换行分隔。系统会按请求轮询 key，并记录最近上游调用状态。

## 部署到 Vercel

1. 把本目录推到 GitHub。
2. 在 Vercel 点击 `Add New... -> Project`。
3. 导入 GitHub 仓库。
4. 在项目 Settings 里添加上面的环境变量。
5. 在 Vercel Marketplace 添加 Vercel KV 或 Upstash Redis，并把 REST 环境变量填进项目。
6. 点击 Deploy。

部署完成后，你的电脑不需要开机，所有用户访问都走 Vercel。

## 重要边界

这个项目是 Vercel-only 的完整 MVP，不是完整 New API。它适合先上线公益聊天站：登录、额度、后台、模型分发都有了。完整 New API 仍更适合 Docker + 数据库 + 常驻服务器或容器平台。
