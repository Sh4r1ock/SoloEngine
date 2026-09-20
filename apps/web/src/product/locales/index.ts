/**
 * 字典注册表：命名空间 → 双语字典（每页一个模块）。
 */
import { common } from './common.ts'
import { shell } from './shell.ts'
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

export const dictionaries = {
  common,
  shell,
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
}

/** 命名空间名。 */
export type Namespace = keyof typeof dictionaries
