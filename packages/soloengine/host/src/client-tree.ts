/**
 * 运行面板的实例客户端组合（Plan W4）。
 *
 * 客户端的启动图由 `dsh-client-modules` 按宿主 Loader 的活动行组装（`window.__DSH_BOOT__`），
 * 全量下发；本模块做三件事：
 * - 在服务端用实例组合校验「保留行不得依赖本画布关闭的包」，组合错误显式报错；
 * - 为 `/run/:agenticFlowId` 生成结构化注入行：该画布另有全局图之外的客户端包时，先以实例图
 *   覆盖 `__DSH_BOOT__`，再在入口模块（defer）执行前裁剪 `entries/batches`，使该面板只激活
 *   这份实例的客户端插件；
 * - 把实例组合错误渲染成整页错误（fail loud，不渲染半棵树）。
 *
 * 不新造加载器：模块的获取、批次与工厂注册继续由原生启动面承担（实例图复用
 * `ClientModuleRegistry.extendGraph`），这里只决定「哪些行进入本次激活」。
 *
 * @module @soloengine/host/client-tree
 */

import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { INSTANCE_HEADER, INSTANCE_PARAM } from '@deepseek-ai/dsh-client-connection'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** 引导注入的输入。 */
export interface RunBootstrapInput {
  /** 地址栏里的 agenticflow id。 */
  readonly flowId: string
  /** 宿主解析出的该画布最近一次运行的会话键（无运行会话时缺省）。 */
  readonly sessionKey?: string
  /** 该画布关闭的客户端包名（客户端启动图里不移除这些行）。 */
  readonly disabled: readonly string[]
  /**
   * 该画布专属的客户端启动图（全局图 + 画布新增/替换的客户端包）。
   *
   * 缺省表示没有新增包，页面沿用原生注入的全局 `__DSH_BOOT__` 并只做 disabled 裁剪。
   */
  readonly instanceGraph?: WebBootGraph
}

/**
 * 校验实例客户端组合：保留行不得依赖本画布关闭的包。
 *
 * 依赖关系读自启动图行的 `inject`（包名依赖边）。被关闭且无人依赖的行是合法裁剪；
 * 被依赖的行关闭会让依赖方无法完成工厂装配，属加载期组合错误。
 * @param graph - 宿主当前的客户端启动图。
 * @param disabled - 该画布关闭的客户端包名。
 * @returns 每行一条错误描述；空数组表示组合合法。
 */
export function clientTreeProblems(graph: WebBootGraph, disabled: readonly string[]): string[] {
  const off = new Set(disabled)
  const problems: string[] = []
  for (const entry of graph.entries) {
    if (off.has(entry.id)) continue
    const blocked = (entry.inject ?? []).filter(dep => off.has(dep))
    if (blocked.length > 0) {
      problems.push(`${entry.id} depends on ${blocked.join(', ')}, which this canvas disables`)
    }
  }
  return problems
}

/**
 * 运行面板的实例声明脚本：该面板发出的每个请求都带本 flow。
 *
 * HTTP 带请求头，WebSocket 升级不能带自定义头，故同一个值走查询参数。连接层只把它
 * 当**不透明实例值**转给账号作用域；面板之间的会话/工作区因此互不可见。两个线上名字
 * 从连接层的常量插值进来，不在这里维护第二份。
 */
const DECLARE_INSTANCE_SCRIPT = `(function(){
var flow=globalThis.__SOLOENGINE_RUN_FLOW__;
if(typeof flow!=="string"||flow==="")return;
var header=${JSON.stringify(INSTANCE_HEADER)},param=${JSON.stringify(INSTANCE_PARAM)};
var rawFetch=globalThis.fetch;
if(typeof rawFetch==="function"){
globalThis.fetch=function(input,init){
var next=init?Object.assign({},init):{};
var source=next.headers!==undefined?next.headers:(input&&typeof input==="object"&&"headers"in input?input.headers:undefined);
var headers=new Headers(source||undefined);
if(!headers.has(header))headers.set(header,flow);
next.headers=headers;
return rawFetch.call(this,input,next);
};
}
var RawSocket=globalThis.WebSocket;
if(typeof RawSocket==="function"){
var ScopedSocket=function(url,protocols){
var target=String(url);
try{
var parsed=new URL(target,location.href);
if(!parsed.searchParams.has(param))parsed.searchParams.set(param,flow);
target=parsed.href;
}catch(ignored){/* a malformed socket URL is left untouched and fails at the socket layer */}
return protocols===undefined?new RawSocket(target):new RawSocket(target,protocols);
};
ScopedSocket.prototype=RawSocket.prototype;
["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(key){ScopedSocket[key]=RawSocket[key];});
globalThis.WebSocket=ScopedSocket;
}
})();`

/**
 * 生成 `/run/:agenticFlowId` 的结构化注入行。
 *
 * 三条事实（flow、session、本画布关闭的客户端包）以 `global` 行进入 `<head>`，裁剪逻辑以
 * `body` 行进入外壳末尾；该画布另有全局图之外的客户端包时，实例图以
 * `__SOLOENGINE_INSTANCE_BOOT__` 下发，并先于裁剪脚本覆盖 `__DSH_BOOT__`。`__DSH_BOOT__`
 * 已在 `<head>` 注入，入口模块是 defer 模块，因此覆盖与裁剪必然先于首次客户端激活。
 * 裁剪只按包名移除行，批次随之收缩，空批次丢弃；模块内容与加载路径仍走原生启动面
 * （`webserver/index-inject` 的注入表，不再做 `</body>` 字符串替换）。
 * @param input - 画布 id、会话键、关闭的客户端包名与该画布的实例启动图。
 * @returns 交给 `renderIndex` 的注入行。
 */
export function runBootstrapRows(input: RunBootstrapInput): IndexInjection[] {
  const instanceRows: IndexInjection[] = input.instanceGraph === undefined
    ? []
    : [
      { kind: 'global', name: '__SOLOENGINE_INSTANCE_BOOT__', value: input.instanceGraph },
      {
        kind: 'script',
        placement: 'body',
        text: '(function(){'
          + 'var graph=globalThis.__SOLOENGINE_INSTANCE_BOOT__;'
          + 'if(graph&&typeof graph==="object")globalThis.__DSH_BOOT__=graph;'
          + '})();',
      },
    ]
  return [
    { kind: 'global', name: '__SOLOENGINE_RUN_FLOW__', value: input.flowId },
    ...input.sessionKey === undefined
      ? []
      : [{ kind: 'global' as const, name: '__SOLOENGINE_RUN_SESSION__', value: input.sessionKey }],
    { kind: 'global', name: '__SOLOENGINE_CLIENT_OFF__', value: input.disabled },
    ...instanceRows,
    {
      kind: 'script',
      placement: 'body',
      text: DECLARE_INSTANCE_SCRIPT,
    },
    {
      kind: 'script',
      placement: 'body',
      text: '(function(){'
        + 'var boot=globalThis.__DSH_BOOT__;'
        + 'var off=globalThis.__SOLOENGINE_CLIENT_OFF__;'
        + 'if(!boot||!Array.isArray(boot.entries)||!Array.isArray(off)||off.length===0)return;'
        + 'var drop=Object.create(null);'
        + 'for(var i=0;i<off.length;i++)drop[off[i]]=true;'
        + 'boot.entries=boot.entries.filter(function(entry){return entry&&!drop[entry.id];});'
        + 'if(Array.isArray(boot.batches)){'
        + 'boot.batches=boot.batches.map(function(batch){'
        + 'return Object.assign({},batch,{entries:(batch.entries||[]).filter(function(id){return !drop[id];})});'
        + '}).filter(function(batch){return batch.entries.length>0;});'
        + '}'
        + '})();',
    },
  ]
}

/** HTML 文本转义（错误页承载组合错误原文）。 */
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * 实例组合错误的整页呈现（fail loud：不渲染半棵客户端树，也不静默回退到全量组合）。
 * @param flowId - 地址栏里的画布 id。
 * @param problems - 组合错误描述。
 * @returns 独立 HTML 文档。
 */
export function clientTreeErrorPage(flowId: string, problems: readonly string[]): string {
  const rows = problems.map(problem => `<li>${escapeHtml(problem)}</li>`).join('')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>实例组合错误</title></head>'
    + '<body style="font:14px/22px system-ui;padding:32px;max-width:760px">'
    + '<h1 style="font-size:18px">实例组合错误</h1>'
    + `<p>画布 <code>${escapeHtml(flowId)}</code> 的客户端插件组合无法装载：</p>`
    + `<ul>${rows}</ul>`
    + '<p>在画布设置里恢复被依赖的插件，或一并关闭依赖它的行。</p>'
    + '</body></html>'
}
