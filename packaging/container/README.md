# 容器形态（PRD-11 FR-DEP-001 / NFR-POR-003）

与本地部署的差异只有**数据目录落在卷上**：镜像里跑的就是 `node soloengine-launch/bin.mjs install` 与 `start`，`doctor` / `status` / `repair` 在容器里同样可用。容器**同机制挂持久卷**——`data/` 一个卷装下 dsh home（profile、profile 的插件层、会话日志、派生索引）、业务库、主密钥与技能目录。

## 一、绑定与网络的形态事实

平台的 `web` 命令按安全设计**拒绝** `--host 0.0.0.0`：

```
error: --host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network; use 127.0.0.1 instead
```

因此容器里的实例只监听 `127.0.0.1:8991`；要让这个回环可被访问，容器必须以 **`--network=host`** 起——容器与宿主共用网络命名空间，**容器的回环即宿主的回环**。端口映射（`-p`）在这里没有意义：映射只把流量送到非回环地址，而产品按设计只绑回环。

> Docker Desktop for Windows 的 `--network=host` 落在 WSL 虚拟机的网络里，Windows 侧的回环访问不到容器——这是 Docker Desktop 的形态边界（本机实测记录在 `records/stage9-container-deployment.json` 的 `hostLoopback` 字段），不是产品差异。生产上的服务器形态（Linux 宿主）就是「容器回环 = 宿主回环」。

## 二、构建

```powershell
docker build -f packaging/container/Dockerfile `
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com `
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) `
  -t soloengine:local .
```

镜像内按启动器自己的两条命令准备环境（与本地一字不差）：`node soloengine-launch/bin.mjs install`（工作区依赖 + **profile 的第三方插件层**）与 `... build`（原生件 → lib 双面 → web）。

- **基础镜像 `node:24-bookworm`**：自带构建期需要的 `git`（`scripts/build.ts` 解析仓库状态）与 `gcc`/`libc6-dev`（编译 `native/system` 的 flock 原生插件），镜像不依赖 Debian 源。`-slim` 变体没有这两样，走 apt 安装时本机到 Debian CDN 与镜像站的 `.deb` 下载反复 502，故不采用。
- **`DSH_CLIENT_COMMIT_HASH`**：平台既有的构建变量（`scripts/client-build-environment.ts`）。镜像不复制 `.git`，客户端产物内嵌的源提交号由构建参数传入宿主检出的真实提交；不传则镜像内 `git rev-parse HEAD` 因无仓库而直接报错（fail loud）。
- **`NPM_REGISTRY`（可选）**：写进镜像的 `/root/.npmrc`。跨境直连官方 registry 的并行元数据请求在本机网络下会被反复重置（ECONNRESET），换就近镜像可稳定取数；镜像同时把 pnpm 的取数重试调高、并发压到 4。

## 三、运行

```powershell
docker run -d --name soloengine --network=host -v soloengine-data:/app/data soloengine:local
```

镜像默认命令是 `install && start`：`install` 幂等地补齐 profile 的第三方插件层（`@anionex/dsh-turn-rewind` / `dsh-free-search`）。首次用空卷启动时，Docker 会把镜像里 `/app/data` 的内容（含已装好的插件层）复制进新卷，故通常无需再联网；卷被清空重建时也只需一次网络。

## 四、验证与自检

容器内（回环只在容器网络命名空间可达，故自检在容器内跑）：

```powershell
docker exec soloengine node soloengine-launch/bin.mjs doctor     # 六类检查
docker exec soloengine node soloengine-launch/bin.mjs status     # 端口持有者 / 组合清单 / 就绪地址
docker exec soloengine node -e "fetch('http://127.0.0.1:8991/api/solo/health').then(r=>console.log(r.status))"
docker logs soloengine | Select-String 'dsh web: http'
```

`--network=host` 下容器不与宿主冲突端口：宿主上若有别的进程占用 8991，`doctor` 的第 1 类检查会报出（并提示 `start` 会以同端口重启）。端口归属按平台取系统真实来源（Windows `Get-NetTCPConnection`、Linux `/proc`、macOS `lsof`）——容器里没有 powershell，这条判据不能建立在它身上。

## 五、实测结果（`node test/soloengine/container-deployment-probe.mjs`）

**13/13**：镜像在位 / `--network=host` 起容器 / 容器内 `/api/solo/health` 200 / 容器日志出现平台就绪行与 `product surfaces mounted` 行 / 容器内 `doctor` 六类全过且**端口归属报到真实持有者**（`port 8991 held by this instance: pid 60`）/ 容器内 `status` 报组合清单与就绪地址 / **组合层禁用在镜像内同样生效**（面板 HTML 不含被禁用的平台品牌行、仍有产品品牌行）/ 容器内登录建画布 201 / `docker restart` 后同一画布仍在 / 停容器后主实例在 8991 恢复。逐条证据落 `test/soloengine/records/stage9-container-deployment.json` 与 `test/logs/container-probe.log`。

## 六、边界

- 容器内**不做**桌面壳（`apps/desktop` 那条线是另一形态：无监听端口 + 帧化字节管道）。
- 本机的容器实测宿主是 Windows + Docker Desktop（Linux 引擎）；macOS/Linux 宿主同机制，回环可达性随宿主而定（见 §一）。
