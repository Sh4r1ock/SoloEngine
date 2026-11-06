/**
 * 运行起始页（管理层）：`/run/:agenticFlowId` 还没有运行会话时由产品应用渲染。
 *
 * 该 URL 一旦有运行会话就换由 DSH 原生运行面板渲染（`client-bootstrap` 选会话）；没有会话时
 * 不进入 Harness 层——「选工作目录并发起一次运行」是管理动作，不是 Harness 面的一部分。
 * 同一 URL 因此只有一个入口、一层文案，不再出现原生空态与浮层开始卡叠加。
 *
 * 目录选择在页面内完成（`DirectoryDialog` → 宿主目录桥的 `browse` 后端），目录只作为本次运行的
 * 工作根，同一画布可以使用任意多个目录（需求 §9.5 ⑤：flow 与运行项目不绑定）。
 *
 * @module product/pages/RunStartPage
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, IconFolderOpenOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { DirectoryDialog } from '../components/DirectoryDialog.tsx'
import type { CanvasView, RunSessionView } from '../types.ts'
import common from '../styles/common.module.css'
import css from '../styles/runStart.module.css'

/**
 * 启动失败的可读文案：按接口错误码给出成因与出路，其余情况回落接口原文。
 * @param failure - 启动请求抛出的异常。
 * @returns 用户可读的原因。
 */
function startFailureText(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.code === 'MISSING_MODEL') return t('runStart', 'errorMissingModel')
    if (failure.code === 'CANVAS_EMPTY' || failure.code === 'CANVAS_NO_NODES') return t('runStart', 'errorEmptyCanvas')
    if (failure.code === 'NODE_PLUGIN_INVALID' || failure.code === 'CONFLICTING_PLUGIN_VERSION') {
      return t('runStart', 'errorPluginConflict')
    }
    if (failure.code === 'CYCLE_DETECTED') return t('runStart', 'errorCycle')
  }
  return describeError(failure)
}

/**
 * 渲染运行起始页。
 * @param props.flowId - 地址栏里的 agenticflow id。
 */
export function RunStartPage({ flowId }: { flowId: string }) {
  useLocale()
  const [canvas, setCanvas] = useState<CanvasView | null>(null)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 卸载即中止：迟到的响应不得写进已离开的页面（以 signal 判定，不用本地布尔——闭包里
    // 的类型收窄会把「已卸载」判成不可能分支）。
    const controller = new AbortController()
    void (async () => {
      try {
        const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${flowId}`, { signal: controller.signal })
        setCanvas(result.canvas)
        setError(null)
      } catch (failure) {
        if (controller.signal.aborted) return
        setError(`${t('runStart', 'errorLoadCanvas')} — ${describeError(failure)}`)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => { controller.abort() }
  }, [flowId])

  const nodeCount = canvas?.canvas.nodes.length ?? 0
  const canStart = canvas !== null && nodeCount > 0 && !busy

  const start = useCallback((folderPath: string): void => {
    setPicking(false)
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; session: RunSessionView }>('/runs', {
          method: 'POST',
          body: { canvasId: flowId, folderPath },
        })
        window.location.replace(result.session.panel_path)
      } catch (failure) {
        setError(`${t('runStart', 'errorStart')} — ${startFailureText(failure)}`)
        setBusy(false)
      }
    })()
  }, [flowId])

  return (
    <div className={common.page}>
      <PageHeader
        title={loading ? t('runStart', 'pageTitle') : (canvas?.name ?? t('runStart', 'pageTitle'))}
        subtitle={canvas?.description !== null && canvas?.description !== undefined && canvas.description !== ''
          ? canvas.description
          : t('runStart', 'subtitle')}
        actions={(
          <Button
            icon={<IconPlayOutlineRegular size={14} />}
            variant="primary"
            disabled={!canStart}
            onClick={() => { setPicking(true) }}
          >
            {busy ? t('runStart', 'starting') : t('runStart', 'start')}
          </Button>
        )}
      />

      <div className={css.body}>
        {error !== null && <NoticeLine tone="error" text={error} />}
        {!loading && canvas !== null && nodeCount === 0 && (
          <NoticeLine
            tone="info"
            text={t('runStart', 'emptyCanvas')}
            action={{ label: t('runStart', 'openEditor'), onClick: () => { navigate(`/canvas/${flowId}`) } }}
          />
        )}
        <section className={css.card}>
          <h2 className={css.cardTitle}>{t('runStart', 'directoryTitle')}</h2>
          <p className={css.cardText}>{t('runStart', 'directoryHint')}</p>
          <div className={css.cardActions}>
            <Button
              icon={<IconFolderOpenOutlineRegular size={14} />}
              variant="primary"
              disabled={!canStart}
              onClick={() => { setPicking(true) }}
            >
              {busy ? t('runStart', 'starting') : t('runStart', 'pickAndStart')}
            </Button>
            <Button variant="outline" onClick={() => { navigate(`/canvas/${flowId}`) }}>
              {t('runStart', 'openEditor')}
            </Button>
          </div>
        </section>
        {!loading && canvas !== null && nodeCount > 0 && (
          <p className={css.meta}>{t('runStart', 'nodeCount', { count: nodeCount })}</p>
        )}
      </div>

      <DirectoryDialog
        open={picking}
        onClose={() => { setPicking(false) }}
        onPicked={start}
      />
    </div>
  )
}
