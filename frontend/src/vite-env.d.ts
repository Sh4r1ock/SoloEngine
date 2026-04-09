/**
 * SoloEngine : Vite环境类型声明模块
 *
 * @file vite-env.d.ts
 * @description Vite环境类型声明
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块定义Vite环境的类型声明，包括：
 *     - ImportMetaEnv: 导入元数据环境接口
 *     - ImportMeta: 导入元数据接口
 *
 * 依赖:
 *     - vite/client: Vite客户端类型
 *
 * 使用示例:
 *     - const apiUrl = import.meta.env.VITE_API_BASE_URL
 */

/// <reference types="vite/client" />

/**
 * 导入元数据环境接口
 *
 * 属性:
 *     - VITE_API_BASE_URL: API基础URL
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

/**
 * 导入元数据接口
 *
 * 属性:
 *     - env: 环境变量
 */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
