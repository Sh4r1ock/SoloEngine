# profiles-templates · profile 初始化模板

> plan 目录结构里的 `profiles-templates/`：**profile 初始化模板（bundles 清单 + cordis.patch.yml + patch 命中审计脚本）**。

## 这里放什么

| 文件 | 作用 |
|---|---|
| `bundles.json` | profile 的 **bundle 层清单（唯一真源）**：顺序即层序，SoloEngine 组合层恒在最后（其 patch 覆盖前者生效） |
| `cordis.patch.yml` | profile 的**用户 patch 层**模板（出厂为空数组；部署方在此写 id 覆写/禁用/插入） |
| `cordis.yml` | profile 根配置模板（恒为空数组，平台每次重写） |
| `pnpm-workspace.yaml` | profile 的 pnpm 设置模板（`nodeLinker: hoisted`，与平台解析方式一致） |
| `audit-patch-hits.mjs` | **patch 命中审计**：判定组合层每条 insert/patch 是否真的生效 |

## 谁在用

`node soloengine-launch/bin.mjs init` 读本目录写出实例 profile（`data/dsh-home/profiles/soloengine/`）：

- 清单（`package.json` 的 `dsh.profile.bundles`）**每次重写**，来源就是 `bundles.json`；
- 三个配置模板**只在缺失时写入**，不覆盖部署方自己的 patch 与 workspace 设置。

启动器不再自带第二份 bundle 常量——两份清单迟早分叉，而分叉的症状是「profile 少装一层却不报错」。

## patch 命中审计

```bash
node profiles-templates/audit-patch-hits.mjs          # 人可读
node profiles-templates/audit-patch-hits.mjs --json   # 机器可读（回归用）
```

平台的「patch 未命中」只**告警**不报错：`cordis.patch.yml` 里写错一个 id、或写对一个 id 但 config
写得不会被应用，启动一切正常，只是那行改动**静默地没生效**。审计拿**平台自己解析出的组合结果**比：

- `dsh --profile <合成profile> --dump-config`（bundles = 交付清单）→「有本层」；
- 同一清单**去掉 `@soloengine/host`** 再 dump →「无本层」基线；

然后判定：

1. **insert 行**必须只在「有本层」出现（出现在基线里＝重复注册风险）；
2. **patch 行**必须**两侧都有**（只在新侧＝它其实是个 insert，说明 patch 静默没命中）；
3. **patch 真的生效**：本层声明的 `disabled` 与组合结果一致；本层声明的 `config` 与组合结果**整体相等**
   （patch 是整行替换，不做深合并）。`!!js` 表达式在组合结果里已求值，故只校验键位存在。

任一不成立即 **非零退出**。

### 反向对照（审计必须证明自己能判出问题）

回归里带两个反向对照，把交付层那份复制成副本、故意写坏后喂给审计：

- 把一条 patch 的 id 写错 → 必须报 `MISS <id>`；
- 把 `storage-domain` 的 `config.backend` 改成别的值 → 必须报「组合结果仍是 `sqlite`」。

没有反向对照的审计等于没审计（永远绿灯）。

## 刷新

bundle 清单变更后跑一次 `node soloengine-launch/bin.mjs init`（清单会按模板重写），再跑审计确认
`@soloengine/host` 组合层的每条 insert/patch 仍然命中。
