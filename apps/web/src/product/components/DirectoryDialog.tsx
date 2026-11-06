/**
 * 工作目录选择对话框（产品页面内的目录浏览）。
 *
 * 走宿主 `/soloengine/directory` 桥（`browse` 后端的逐层列举与新建子目录），因此选择动作
 * 完全发生在页面里：远程访问同样可用，结果可复现，不依赖宿主桌面的 OS 选择器。
 *
 * 交互与原生页内选择器一致：面包屑可回到任意上级，列表只列子目录，进入子目录后再确认，
 * 也可以在当前位置新建目录。取消不产生任何副作用。
 *
 * @module product/components/DirectoryDialog
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconFolderOpenOutlineRegular, IconPlusOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../i18n.ts'
import { NoticeLine } from './NoticeLine.tsx'
import css from '../styles/directoryDialog.module.css'

/** 一层目录（宿主桥返回的字段）。 */
interface DirectoryListing {
  path: string
  home: string
  crumbs: { name: string; path: string; hidden: boolean }[]
  entries: { name: string; path: string; hidden: boolean }[]
  truncated: boolean
}

/**
 * 读取一层目录。
 * @param path - 绝对路径；缺省列主目录。
 * @returns 该层目录的内容。
 */
async function listDirectory(path?: string): Promise<DirectoryListing> {
  const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`
  const response = await fetch(`/soloengine/directory${query}`, { credentials: 'same-origin' })
  const body = await response.json() as { ok?: boolean; listing?: DirectoryListing; error?: { message?: string } }
  if (body.ok !== true || body.listing === undefined) {
    throw new Error(body.error?.message ?? t('directoryDialog', 'errorList'))
  }
  return body.listing
}

/**
 * 在父目录下新建子目录。
 * @param path - 父目录绝对路径。
 * @param name - 新的目录名（单个路径段）。
 * @returns 新目录的绝对路径。
 */
async function createDirectory(path: string, name: string): Promise<string> {
  const response = await fetch('/soloengine/directory', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, name }),
  })
  const body = await response.json() as { ok?: boolean; path?: string; error?: { message?: string } }
  if (body.ok !== true || typeof body.path !== 'string') {
    throw new Error(body.error?.message ?? t('directoryDialog', 'errorCreate'))
  }
  return body.path
}

/**
 * 渲染目录选择对话框。
 * @param props.open - 是否显示。
 * @param props.onClose - 关闭（取消）。
 * @param props.onPicked - 确认选择（传绝对路径）。
 * @param props.initialPath - 打开时定位的目录；缺省为主目录。
 */
export function DirectoryDialog({ open, onClose, onPicked, initialPath }: {
  open: boolean
  onClose: () => void
  onPicked: (path: string) => void
  initialPath?: string
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((path?: string): void => {
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const next = await listDirectory(path)
        setListing(next)
        setPathDraft(next.path)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // 每次打开都重新定位（上一次的浏览位置不残留），并回到「未在新建」的初始态。
  useEffect(() => {
    if (!open) return
    setListing(null)
    setPathDraft('')
    setError(null)
    setCreating(false)
    setNewName('')
    setBusy(false)
    load(initialPath)
  }, [open, initialPath, load])

  const submitCreate = (): void => {
    const name = newName.trim()
    if (listing === null || name === '' || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const created = await createDirectory(listing.path, name)
        setCreating(false)
        setNewName('')
        load(created)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setBusy(false)
      }
    })()
  }

  const confirm = (): void => {
    if (listing === null) return
    onPicked(listing.path)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('directoryDialog', 'title')}
      description={t('directoryDialog', 'description')}
      closeLabel={t('directoryDialog', 'cancel')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('directoryDialog', 'cancel')}</Button>
          <Button variant="primary" disabled={listing === null || busy} onClick={confirm}>
            {t('directoryDialog', 'confirm')}
          </Button>
        </>
      )}
    >
      <div className={css.body}>
        {error !== null && (
          <NoticeLine tone="error" text={error} action={{ label: t('directoryDialog', 'retry'), onClick: () => { load(listing?.path) } }} />
        )}

        <div className={css.toolbar}>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconChevronLeftOutlineRegular size={14} />}
            disabled={listing === null || listing.crumbs.length <= 1}
            onClick={() => {
              if (listing === null) return
              const parent = listing.crumbs[listing.crumbs.length - 2]
              if (parent !== undefined) load(parent.path)
            }}
          >
            {t('directoryDialog', 'up')}
          </Button>
          <Button size="sm" variant="ghost" disabled={listing === null} onClick={() => { setCreating(true) }}>
            <IconPlusOutlineRegular size={14} />
            {t('directoryDialog', 'newFolder')}
          </Button>
        </div>

        {listing !== null && (
          <nav className={css.crumbs} aria-label={t('directoryDialog', 'crumbsAria')}>
            {listing.crumbs.map((crumb, index) => (
              <button
                key={crumb.path}
                type="button"
                className={index === listing.crumbs.length - 1 ? `${css.crumb} ${css.crumbActive}` : css.crumb}
                onClick={() => { load(crumb.path) }}
              >
                {crumb.name === '' ? t('directoryDialog', 'root') : crumb.name}
              </button>
            ))}
          </nav>
        )}

        {/* 直接输入绝对路径：跨盘符跳转只能靠它（面包屑只在同一棵卷内向上）。 */}
        <form
          className={css.pathRow}
          onSubmit={(event) => { event.preventDefault(); load(pathDraft.trim()) }}
        >
          <input
            className={css.pathInput}
            value={pathDraft}
            placeholder={t('directoryDialog', 'pathPlaceholder')}
            aria-label={t('directoryDialog', 'pathLabel')}
            onChange={(event) => { setPathDraft(event.currentTarget.value) }}
          />
          <Button type="submit" size="sm" variant="outline" disabled={pathDraft.trim() === ''}>
            {t('directoryDialog', 'go')}
          </Button>
        </form>

        {creating && (
          <form
            className={css.createRow}
            onSubmit={(event) => { event.preventDefault(); submitCreate() }}
          >
            <input
              className={css.createInput}
              value={newName}
              autoFocus
              placeholder={t('directoryDialog', 'newFolderPlaceholder')}
              aria-label={t('directoryDialog', 'newFolder')}
              onChange={(event) => { setNewName(event.currentTarget.value) }}
            />
            <Button type="submit" size="sm" variant="primary" disabled={busy || newName.trim() === ''}>
              {t('directoryDialog', 'create')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName('') }}>
              {t('directoryDialog', 'cancel')}
            </Button>
          </form>
        )}

        <div className={css.list} role="listbox" aria-label={t('directoryDialog', 'listAria')}>
          {loading && <p className={css.hint}>{t('directoryDialog', 'loading')}</p>}
          {!loading && listing !== null && listing.entries.length === 0 && (
            <p className={css.hint}>{t('directoryDialog', 'empty')}</p>
          )}
          {!loading && listing?.entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={false}
              className={css.row}
              onClick={() => { load(entry.path) }}
            >
              <IconFolderOpenOutlineRegular size={16} />
              <span className={css.rowName}>{entry.name}</span>
            </button>
          ))}
          {listing?.truncated === true && <p className={css.hint}>{t('directoryDialog', 'truncated')}</p>}
        </div>
      </div>
    </Modal>
  )
}
