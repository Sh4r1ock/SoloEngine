/**
 * 字典注册表：命名空间 → 双语字典（每页一个模块）。
 */
import { common } from './common.ts'
import { shell } from './shell.ts'
import { home } from './home.ts'
import { styleguide } from './styleguide.ts'
import { login } from './login.ts'
import { canvases } from './canvases.ts'
import { editor } from './editor.ts'
import { models } from './models.ts'
import { skills } from './skills.ts'
import { skillFile } from './skillFile.ts'
import { mcp } from './mcp.ts'
import { market } from './market.ts'
import { packaging } from './packaging.ts'
import { settings } from './settings.ts'
import { users } from './users.ts'
import { runStart } from './runStart.ts'
import { directoryDialog } from './directoryDialog.ts'

export const dictionaries = {
  common,
  shell,
  home,
  styleguide,
  login,
  canvases,
  editor,
  models,
  skills,
  skillFile,
  mcp,
  market,
  packaging,
  settings,
  users,
  runStart,
  directoryDialog,
}

/** 命名空间名。 */
export type Namespace = keyof typeof dictionaries
