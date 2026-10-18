# 校园闲换 · 校园二手交易平台

> 课程设计项目 —— Flask + MySQL + 原生 JavaScript 实现的校园二手闲置交易平台。

![Version](https://img.shields.io/badge/version-v1.0.0-blue)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/Flask-3.x-green)
![MySQL](https://img.shields.io/badge/MySQL-8.0-orange)
![License](https://img.shields.io/badge/license-MIT-green)

**当前版本：v1.0.0（首个开源版本）** · 2026-10-19

无需预先建库、无需预置账号：配置好 `.env` 后 `python app.py` 一条命令即可启动，
数据库与全部数据表会在首次启动时自动创建，账号请在网页上自行注册。

## 功能

### 用户
- 注册 / 登录 / 退出，图形验证码做真人验证
- Flask Session 登录态，登录后 7 天免重复登录
- 个人中心：修改昵称、上传头像、修改密码
- 信用分体系（初始 100）

### 商品
- 商品列表：关键词搜索、分类筛选、排序（最新 / 价格升 / 价格降 / 最热）、分页
- 分类由数据库下发，前端不写死
- 发布闲置：标题、分类、价格、原价、成色、描述、地点、多图上传
- 商品详情：多图 + 缩略图切换、浏览量统计
- 商品管理：在售 / 已售出 / 已下架切换，删除自己的商品

### 交易
- 收藏 / 想要（联合唯一索引，杜绝重复累加）
- 下单，订单状态：待付款 / 已付款 / 已完成 / 已取消
- 站内私信：按商品的买卖双方对话、会话列表、未读计数

### 工程
- 请求限流：登录 / 注册 / 上传 / 私信分别收紧，已登录按用户限流（避免校园 NAT 共用出口被连带误伤）
- 连接池：DBUtils PooledDB，上限 20，池满阻塞等待，取用前 ping 探活
- 密钥外置：支持环境变量，未配置时本地生成并持久化
- 统一异常处理：未捕获异常只写日志，不回前端堆栈
- 响应式布局：窄屏自动切换移动端

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 后端 | Python 3.10+ / Flask 3 |
| 数据库 | MySQL 8.0（utf8mb4） |
| 数据库访问 | PyMySQL + DBUtils 连接池 |
| 认证 | Flask Session + PBKDF2-SHA256 密码哈希 |
| 限流 | Flask-Limiter |
| 验证码 | Pillow 动态生成 |
| 前端 | 原生 HTML / CSS / JavaScript（无框架、无构建） |
| 配置 | python-dotenv + .env |

## 界面预览

> 截图存放于 `docs/screenshots/`。

| 首页 | 商品详情 |
| --- | --- |
| ![首页](docs/screenshots/index.png) | ![商品详情](docs/screenshots/detail.png) |

| 登录注册 | 个人中心 |
| --- | --- |
| ![登录注册](docs/screenshots/login.png) | ![个人中心](docs/screenshots/profile.png) |

## 快速开始

### 环境要求
- Python 3.10+
- MySQL 8.0+

### 1. 获取代码

    git clone https://github.com/MZYQ-LH/secondhand-trade-platform.git
    cd secondhand-trade-platform

### 2. 安装依赖

    python -m pip install -r requirements.txt

### 3. 配置数据库连接

复制 `.env.example` 为 `.env`，填入你自己的 MySQL 账号密码：

    XQ_DB_HOST=127.0.0.1
    XQ_DB_PORT=3306
    XQ_DB_USER=root
    XQ_DB_PASSWORD=你的密码
    XQ_DB_NAME=xq_secondhand

> `.env` 已被 `.gitignore` 忽略，不会被提交。
> 数据库名只能用字母、数字、下划线；库不存在时会自动创建。

### 4. 启动

    python app.py

首次启动会自动完成：建库 → 建表 → 建分类 → 补索引。
浏览器打开 <http://127.0.0.1:5000/index.html>，点「注册」创建你的第一个账号。

> 如果 `pip install` 卡住，可换国内镜像：
> `python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

## 项目结构

    secondhand-trade-platform/
    ├── app.py                  # Flask 后端：全部 API、鉴权、限流、静态托管
    ├── config.py               # 统一配置：加载 .env，导出数据库/服务配置
    ├── db_migrate.py           # 建库建表 + 分类 + 历史数据迁移（可单独执行）
    ├── db_indexes.py           # 热查询索引补齐（可单独执行）
    ├── requirements.txt
    ├── .env.example            # 环境变量模板（复制为 .env）
    ├── .gitignore
    ├── index.html              # 首页（商品列表）
    ├── login.html              # 登录 / 注册
    ├── detail.html             # 商品详情
    ├── publish.html            # 发布闲置
    ├── profile.html            # 个人中心
    ├── logo.svg
    ├── css/
    │   ├── style.css
    │   ├── pages.css
    │   └── theme.css
    ├── js/
    │   ├── data.js             # API 封装 / 登录态 / 公共组件
    │   ├── index.js
    │   ├── detail.js
    │   ├── login.js
    │   ├── publish.js
    │   ├── profile.js
    │   └── petals.js           # 樱花飘落背景（纯装饰）
    ├── images/                 # 上传图片目录（gitignore，仅保留 .gitkeep）
    └── docs/
        └── screenshots/        # README 用截图（可选）

## 配置项

全部通过环境变量或 `.env` 注入，优先级：**真实环境变量 > .env > config.py 默认值**。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `XQ_DB_HOST` | `127.0.0.1` | MySQL 地址 |
| `XQ_DB_PORT` | `3306` | MySQL 端口 |
| `XQ_DB_USER` | `root` | MySQL 用户 |
| `XQ_DB_PASSWORD` | 空 | MySQL 密码 |
| `XQ_DB_NAME` | `xq_secondhand` | 数据库名（不存在会自动创建） |
| `XQ_DB_POOL_SIZE` | `20` | 连接池上限 |
| `XQ_HOST` | `127.0.0.1` | 监听地址，`0.0.0.0` 允许局域网访问 |
| `XQ_PORT` | `5000` | 监听端口 |
| `FLASK_DEBUG` | `0` | 调试模式，生产务必为 0 |
| `XQ_SECRET_KEY` | 空 | 会话密钥，留空则自动生成 `instance_secret.key` |

## 主要接口

所有业务接口以 `/api` 为前缀，返回 JSON；写操作需要登录。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/captcha` | 获取图形验证码 |
| POST | `/api/register` | 注册 |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前用户 |
| POST | `/api/me/profile` | 修改昵称 / 头像 |
| POST | `/api/me/password` | 修改密码 |
| GET | `/api/categories` | 分类列表 |
| GET | `/api/products` | 商品列表（搜索 / 分类 / 排序 / 分页） |
| GET | `/api/products/<id>` | 商品详情 |
| POST | `/api/products` | 发布商品 |
| POST | `/api/products/<id>/status` | 切换商品状态 |
| DELETE | `/api/products/<id>` | 删除商品 |
| POST | `/api/products/<id>/favorite` | 收藏 / 取消收藏 |
| POST | `/api/products/<id>/want` | 想要 / 取消想要 |
| GET | `/api/me/collections` | 我的收藏 |
| GET | `/api/me/products` | 我发布的商品 |
| POST | `/api/orders` | 下单 |
| GET | `/api/orders` | 订单列表 |
| POST | `/api/orders/<id>/status` | 更新订单状态 |
| GET | `/api/messages` | 对话消息 |
| POST | `/api/messages` | 发送私信 |
| GET | `/api/messages/conversations` | 会话列表 |
| GET | `/api/messages/unread` | 未读数量 |
| POST | `/api/upload` | 上传图片 |

## 数据库设计

共 7 张表，全部由程序自动创建：

| 表 | 说明 |
| --- | --- |
| `users` | 用户（账号、PBKDF2 密码哈希、昵称、头像、信用分） |
| `categories` | 商品分类（10 个校园分类） |
| `products` | 商品主表 |
| `product_images` | 商品图片（与商品一对多） |
| `favorites` | 收藏 / 想要（`type` 区分） |
| `orders` | 订单 |
| `messages` | 站内私信 |

## 数据初始化说明

本项目**不预置任何账号、不预置任何商品**。

- 账号：在网页「注册」页自行创建
- 分类：程序自动写入 10 个校园分类
- 商品：由你发布

## 安全说明

已做的基础防护：

- 密码 PBKDF2-SHA256 加盐哈希，不存明文
- 会话密钥外置，`instance_secret.key` 与 `.env` 均已 gitignore
- 写接口全部要求登录
- 未捕获异常只写日志，不回显堆栈
- 登录 / 注册 / 上传 / 私信分别限流
- 上传文件按扩展名白名单校验

部署到公网前还需要：

- 默认监听 `127.0.0.1`；若要开放访问请显式设 `XQ_HOST=0.0.0.0`，并置于反向代理与 HTTPS 之后
- `app.py` 中 `CORS(app, supports_credentials=True)` 目前对任意来源放行，公网部署应收窄 `origins`
- 生产环境请使用专用最小权限数据库账号，不要用 `root`
- Flask 自带开发服务器不适合公网，请换用 gunicorn / waitress 等 WSGI 服务器

## 常见问题

**启动时报连不上 MySQL / `Unknown database`**

检查 `.env` 里的 `XQ_DB_*` 是否正确，并确认 MySQL 服务已启动。数据库不存在时会自动创建，但所用账号需要有建库权限。

**端口 5000 被占用**

在 `.env` 中把 `XQ_PORT` 改成其它端口，或先结束占用该端口的进程。

**首页是空的，一件商品都没有**

本项目不预置商品。请先注册账号，再通过「发布闲置」发布商品。

**上传的图片重启后还在吗**

文件保存在 `images/` 目录。该目录已被 `.gitignore` 忽略，但文件仍在本机；换机器或手动删除目录后图片会丢失（数据库里只剩路径）。

**改了代码不生效**

默认关闭自动重载。把 `.env` 里的 `FLASK_DEBUG` 设为 `1` 即可开启 debug 与热重载。

**演示时提示「请求过于频繁」**

触发了限流。可在 `.env` 中设 `XQ_RATE_LIMIT_ENABLED=0` 临时关闭，演示完记得改回 `1`。

**数据库想换个名字/换台机器**

只改 `.env` 里的 `XQ_DB_NAME` 即可，下次启动会自动建新库并初始化好全部表结构；旧库不会被动。

## 已知限制

- 前端为原生 JS，未引入框架，页面状态管理靠手写
- 未接入支付，订单状态由买卖双方手动流转
- 未做图片压缩，上传大图占用磁盘较多
- 无自动化测试

## 版本迭代

### v1.0.0 — 首个开源版本（2026-10-19）

在内部课程迭代版本（v0.x）基础上完成开源化整理，作为对外发布的第一个版本。

**功能**

- 用户体系：注册 / 登录 / 退出、图形验证码、Session 登录态、个人中心、信用分
- 商品：浏览 / 搜索 / 分类 / 排序 / 分页、多图发布、详情页、状态切换、删除
- 交易：收藏 / 想要、下单与订单状态流转、站内私信
- 工程：请求限流、数据库连接池、统一异常处理、响应式布局

**开源化改造**

- 新增统一配置入口 `config.py`，支持 `.env`
  （优先级：真实环境变量 > `.env` > 代码默认值）
- 启动自动初始化：`python app.py` 自动建库、建表、写分类、补索引，全部幂等
- 移除全部预置账号与商品，改为使用者自行注册、自行发布
- 补充 `README.md`、`LICENSE`（MIT）、`.gitignore`、`.env.example`
- 清理源码中的硬编码数据库凭据与本机绝对路径；默认监听地址改为 `127.0.0.1`
- 上传图片目录 `images/` 不再纳入版本控制，避免仓库随使用不断膨胀
- 移除 Windows 启动脚本，统一使用 `python app.py` 启动

### v0.x — 内部迭代版本

课程作业期间的迭代版本，完成 7 张数据表的迁移、登录鉴权、前端页面与交互补齐、
图形验证码真人验证等改造，未对外发布。

## License

[MIT](LICENSE)