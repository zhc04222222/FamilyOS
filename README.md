# FamilyOS — 家庭育儿管理系统

> 一个轻量级的家庭育儿管理工具，记录从孕期到育儿的每一个重要时刻。  
> 一个 Docker 镜像，5 个环境变量，3 分钟部署。

---

## 🚀 快速开始

### 1. 拉取镜像

```bash
docker pull zhc0422/familyos:latest
```

### 2. 创建 `.env` 文件

```env
FAMILYOS_ADMIN_USERNAME=##修改这里##
FAMILYOS_ADMIN_PASSWORD=##修改这里##
FAMILYOS_USER_USERNAME=##修改这里##
FAMILYOS_USER_PASSWORD=##修改这里##
FAMILYOS_SECRET_KEY=##修改这里##
```

### 3. 创建数据目录

```bash
mkdir -p data uploads
```

> 如果有旧版本数据库，直接把 `familyos.db` 放到 `data/` 目录，容器启动后会自动补齐新增字段。

### 4. 启动

```bash
docker-compose up -d
```

浏览器访问：`http://你的服务器IP:29375`

---

## 📦 镜像地址

| 仓库 | 地址 |
|------|------|
| Docker Hub | `zhc0422/familyos:latest` |
| GitHub | `https://github.com/zhc04222222/FamilyOS` |

---

## 🔐 账号说明

| 环境变量 | 说明 |
|----------|------|
| `FAMILYOS_ADMIN_USERNAME` | 管理员用户名 |
| `FAMILYOS_ADMIN_PASSWORD` | 管理员密码（明文） |
| `FAMILYOS_USER_USERNAME` | 普通用户用户名 |
| `FAMILYOS_USER_PASSWORD` | 普通用户密码（明文） |
| `FAMILYOS_SECRET_KEY` | HMAC 签名密钥（随意一串字符即可） |

> ⚠️ `FAMILYOS_SECRET_KEY` 必须设置，否则容器无法启动。其余变量未设置时使用默认值。

---

## ✨ 功能

- 🌸 **生命周期切换** — 孕期 → 月子期（产后 42 天）→ 育儿期，自动识别
- 📝 **事件记录** — 产检 / 喂奶 / 睡眠 / 尿布 / 洗澡 / 疫苗 / 成长 / 待办
- 📦 **库存管理** — 消耗品出入库 + 补货记录 + 消耗统计
- 📊 **消费统计** — 总消费、月消费、日均消费、各品类明细
- 🖼️ **图片管理** — 按记录上传照片，时间轴浏览
- 🏠 **Home Assistant 集成** — 库存预警同步 + 日历事件同步（可选）
- 👥 **多用户** — 管理员（可删除）+ 普通用户（仅查看/添加）

---

## 📁 数据持久化

| 容器路径 | 宿主机路径 | 说明 |
|----------|-----------|------|
| `/app/data` | `./data` | SQLite 数据库 `familyos.db` |
| `/app/uploads` | `./uploads` | 上传的图片文件 |

备份只需复制 `data/familyos.db` 即可。

---

## 🏠 Home Assistant 集成（可选）

在设置页面填写以下信息即可启用：

| 配置项 | 说明 |
|--------|------|
| HA 地址 | Home Assistant 的访问地址，如 `http://192.168.1.100:8123` |
| HA Token | 在 HA 后台 → 个人资料 → 长期访问令牌 创建 |
| 自动同步 | 开启后新增/修改记录自动同步到 HA |

### 同步内容

| 类型 | 说明 |
|------|------|
| 📦 库存预警 | 每个物品在 HA 中生成 `binary_sensor.familyos_inventory_{id}`，缺货时状态为 `on` |
| 📅 日历事件 | 产检/疫苗/任务等事件同步到 HA 日历 `calendar.familyos` |

> 配置后可通过 HA 自动化实现"奶粉快没了发送手机通知"等场景。

---

## ⚙️ 技术栈

- **Python 3.11** / **FastAPI** / **SQLAlchemy** / **SQLite**
- **Jinja2 模板** + 原生 HTML/CSS/JS
- **Docker** host 网络模式，监听 29375 端口

---

## ❓ 常见问题

**Q: 改 `.env` 后重启，账号密码不生效？**  
A: `.env` 只在**数据库为空时**创建用户。已有数据后需登录到设置页面修改密码。

**Q: 旧版 Docker 的数据能迁移吗？**  
A: 可以。把旧 `data/familyos.db` 放进 `./data/` 目录，容器启动后自动补齐缺少的字段。

**Q: 端口被占用怎么办？**  
A: 修改 `docker-compose.yml` 中的端口映射，同时修改 `Dockerfile` 中 `CMD` 和 `EXPOSE` 的端口号。