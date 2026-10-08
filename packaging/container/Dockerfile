# SoloEngine 容器形态（PRD-11 FR-DEP-001：一实例一进程一库一壳；本地/服务器/容器同一程序同一启动路径，
# 差异只有主机与信任域；容器同机制挂持久卷）。
#
# 构建（构建上下文 = 仓库根）：
#   docker build -f packaging/container/Dockerfile -t soloengine:local .
# 取数不稳的网络换就近源（`--build-arg NPM_REGISTRY=https://registry.npmmirror.com`）；
# 客户端产物要内嵌源提交号则传 `--build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD)`。
# 运行（持久卷挂 /app/data；容器与宿主共用网络命名空间，容器回环即宿主回环）：
#   docker run -d --name soloengine --network=host -v soloengine-data:/app/data soloengine:local
#
# 与本地部署的差异只有：数据目录落在卷上。主机与端口都不变（回环 + 8991）——平台的 web 命令按
# 安全设计拒绝 `--host 0.0.0.0`（它会把远程代码执行暴露到网络上），端口映射只到非回环地址，
# 故容器形态用 `--network=host`：启动路径完全一致，都是 `node soloengine-launch/bin.mjs start`，
# 也都能跑 `doctor` / `status` / `repair`。

# 基础镜像：完整变体（buildpack-deps 基座）自带 `git` 与 `gcc`/`libc6-dev`——
# 构建期正需要这两样（`scripts/build.ts` 解析仓库状态、`native/system` 编译 flock 原生插件），
# 于是这一层不依赖 Debian 源，构建可重复且不受镜像站抖动影响。`-slim` 变体没有这两样，
# 需要 apt 装，而本机到 Debian CDN/镜像站的 .deb 下载反复 502（见 packaging/README.md 的失败记录）。
FROM node:24-bookworm

# 代理参数（可选）：pnpm 认 http_proxy/https_proxy，构建期取依赖可整条走代理。
ARG http_proxy
ARG https_proxy
# 取数重试与并发：跨境链路（或经代理）上 registry 会偶发 ECONNRESET；pnpm 默认 3 次重试、16 路并发，
# 在受限网络里容易被打回。这里放宽重试并压低并发（本机实测：直连取数正常，经代理并发被重置）。
ENV NPM_CONFIG_FETCH_RETRIES=10 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000 \
    NPM_CONFIG_NETWORK_CONCURRENCY=4
# 取数源（可选）：`--build-arg NPM_REGISTRY=https://registry.npmmirror.com` 可换成就近镜像，
# 跨境到官方 registry 的并行元数据请求在部分网络下会被代理反复重置（ECONNRESET）。
# 写进 `/root/.npmrc` 而非无条件 ENV：空值时不该出现「空 registry」这种非法配置。
ARG NPM_REGISTRY=
RUN set -eux; \
    if [ -n "$NPM_REGISTRY" ]; then printf 'registry=%s\n' "$NPM_REGISTRY" > /root/.npmrc; fi

# 客户端产物内嵌的源提交号：镜像不复制 `.git`（体积与构建缓存都划算），故由构建参数传入宿主检出
# 的真实提交（`git rev-parse HEAD`）；不传则退回镜像内 `git rev-parse`（会因无仓库而报错，fail loud）。
ARG DSH_CLIENT_COMMIT_HASH
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

# 启动器与本地同路径调用 pnpm（`corepack pnpm ...`），故只启用 corepack，不另装包管理器。
WORKDIR /app
COPY . .

# 准备：`install`（工作区依赖 + profile 的第三方插件层）与 `build`（原生件 → lib 双面 → web）。
# 先单独 `init` 并回显 profile 清单：其中的 `packageManager` 是插件层安装能解析到正确 pnpm 的前提。
# BuildKit 缓存挂载（官方推荐做法）：pnpm store 与 corepack 的 pnpm 下载缓存跨构建复用，
# 于是取数失败重试不必重下 1200+ 包；缓存不落进镜像层。
RUN --mount=type=cache,id=soloengine-pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=soloengine-corepack,target=/root/.cache/node/corepack \
    set -eux; \
    corepack enable; \
    node soloengine-launch/bin.mjs init; \
    cat data/dsh-home/profiles/soloengine/package.json; \
    node soloengine-launch/bin.mjs install; \
    node soloengine-launch/bin.mjs build

# 容器形态：监听回环（平台的 web 命令按安全设计拒绝 `--host 0.0.0.0`，它会提示改用 127.0.0.1），
# 关闭浏览器自动打开（无头），端口恒为 8991。容器用 `--network=host` 起：容器与宿主共用网络命名空间，
# 回环即宿主的回环——这正是「同一程序同一条启动路径」在容器里的形态（不用端口映射，因为映射只到非回环地址）。
ENV SOLOENGINE_HOST=127.0.0.1 \
    SOLOENGINE_PORT=8991 \
    SOLOENGINE_NO_OPEN=1

# 持久卷：`data/` 承载 dsh home（profile、profile 的插件层、会话日志、派生索引）、业务库、主密钥与技能目录。
VOLUME ["/app/data"]
EXPOSE 8991

# 启动：先 `install` 再 `start`。`install` 幂等——它补齐 **profile 的第三方插件层**（这一层必须落在持久卷里，
# 镜像里装的那份会被卷挂载遮住），因此全新卷首次启动需要一次网络；已补齐的卷上它是空转。
CMD ["sh", "-c", "node soloengine-launch/bin.mjs install && node soloengine-launch/bin.mjs start"]
