/**
 * SoloEngine : 前端应用入口模块
 *
 * @file index.tsx
 * @description React应用入口，配置主题和路由
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块是前端应用的入口，负责：
 *     - 创建React根节点
 *     - 配置Ant Design主题
 *     - 提供路由配置
 *     - 启用React严格模式
 *
 * 依赖:
 *     - react: React核心库
 *     - react-dom: React DOM渲染
 *     - react-router-dom: 路由管理
 *     - antd: Ant Design组件库
 *
 * 使用示例:
 *     - 自动由构建工具加载
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider, theme, App } from 'antd'
import router from './router'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3F51B5',
          controlHeight: 40,
          fontSize: 14,
        },
        components: {
          Select: {
            singleItemHeightLG: 40,
          },
          Input: {
            controlHeight: 40,
          },
          InputNumber: {
            controlHeight: 40,
          },
        },
      }}
    >
      <App>
        <RouterProvider router={router} />
      </App>
    </ConfigProvider>
  </React.StrictMode>,
)
