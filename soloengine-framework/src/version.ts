/**
 * 框架层版本号。
 *
 * 单一来源：`/api/solo/health` 的 `version` 字段与产品壳下发的 `__SOLOENGINE_VERSION__`
 * 全局都读这里，登录品牌面板的版本脚注因此与健康检查报同一版本。
 */
export const FRAMEWORK_VERSION = '0.1.0'
