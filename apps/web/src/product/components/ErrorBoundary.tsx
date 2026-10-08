/**
 * 渲染期错误边界（R24 优雅降级）。
 *
 * 此前产品层没有任何错误边界：任一页面在 render 阶段抛错会卸载整棵 React 树 → 白屏，
 * 用户既看不到失败原因，也没有恢复入口。这里把故障隔离在被包裹的子树内：外壳（侧边导航、
 * 主题/语言切换）继续可用，故障区给出可操作出路（重新加载），用户仍能切到别的页面。
 *
 * 复位时机：`resetKey` 变化（路由 pathname/查询变化）且当前处于降级态时，复位后按新路由
 * 重新渲染子树——否则「同一路由下降级 → 用户点击侧边导航回同一路由」会永久钉在降级态
 * （实测：/canvases?explode=1 降级后点 Canvases 导航，pathname 不变，key 复位方案失效）。
 *
 * 不把 `error.message` 直出到界面：它是实现细节（可能是断言文本或第三方消息），
 * 直出即「机器码直出」（R8）。原因由 React 打到控制台，界面只呈现产品文案 + 恢复动作。
 */
import { Component, type ReactNode } from 'react'
import { NoticeLine } from './NoticeLine.tsx'
import { t } from '../i18n.ts'
import css from '../styles/common.module.css'

/** 错误边界属性。 */
interface ErrorBoundaryProps {
  /** 复位信号：路由身份（pathname + 查询串）。变化时清除降级态。 */
  resetKey: string
  children: ReactNode
}

/** 错误边界状态。 */
interface ErrorBoundaryState {
  failed: boolean
}

/** 把子树渲染期的异常隔离在边界内。 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  /** 子树抛错时切到降级态。 */
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  /** 路由身份变化时从降级态复位，让新路由正常渲染。 */
  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className={css.page}>
        <NoticeLine
          tone="error"
          text={t('common', 'panelRenderFailed')}
          action={{ label: t('common', 'actionReload'), onClick: () => { window.location.reload() } }}
        />
      </div>
    )
  }
}
