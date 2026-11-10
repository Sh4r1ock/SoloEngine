/**
 * `@soloengine/ui-theme` 的 Node 半：把浏览器偏好（主题 / 内容字号）注入运行面板首屏。
 *
 * 偏好存浏览器 localStorage（与框架层产品页面同一键 `soloengine.preferences`）；
 * 运行面板是同一浏览器的另一个文档，因此在 body 末尾注入一段小脚本把同一份值落到 DOM，
 * 使「整站生效」在管理面与运行面板同时成立，且不写服务端设置命名空间（用户/浏览器隔离）。
 *
 * @module @soloengine/ui-theme
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** Cordis 插件名。 */
export const name = 'soloengine-ui-theme'

/**
 * 运行面板首屏应用浏览器偏好的内联脚本。
 *
 * 与产品页同一判据：`light` / `dark` 固定，`system` 跟随 `prefers-color-scheme`；
 * 内容字号写到 `--dsh-content-font-size`，并按产品区间 12~20 夹取（存储可被用户或旧版本写入
 * 越界值，运行面板不能把 200px 之类的值原样落到 DOM）。存储缺失或损坏时保持原生默认。
 */
const BROWSER_PREFERENCE_SCRIPT = `(function(){
  var KEY='soloengine.preferences';
  function apply(){
    try{
      var raw=localStorage.getItem(KEY); if(!raw) return;
      var parsed=JSON.parse(raw); var theme=parsed&&parsed.theme; if(!theme) return;
      var preference=theme.preference==='light'||theme.preference==='dark'?theme.preference:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
      var root=document.documentElement; var body=document.body;
      root.setAttribute('data-ds-theme-source', theme.preference==='system'?'system':preference);
      root.style.colorScheme=preference;
      if(preference==='dark') body.setAttribute('data-ds-dark-theme',''); else body.removeAttribute('data-ds-dark-theme');
      if(typeof theme.fontSize==='number'&&isFinite(theme.fontSize)){
        var size=Math.min(20,Math.max(12,Math.round(theme.fontSize)));
        body.style.setProperty('--dsh-content-font-size', size+'px');
      }
    }catch(error){}
  }
  apply();
  addEventListener('storage', function(event){ if(event.key===KEY) apply() });
})();`

/**
 * 注册首屏注入：运行面板文档加载时应用同一份浏览器偏好。
 * @param ctx - 插件上下文（`webserver/index-inject` 事件）。
 */
export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', (table) => {
    const row: IndexInjection = { kind: 'script', placement: 'body', text: BROWSER_PREFERENCE_SCRIPT }
    table.push(row)
  })
}
