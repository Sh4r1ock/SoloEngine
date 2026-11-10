/**
 * 全 VM 的 SSH 执行面：把 argv 变成 guest 内的一条 POSIX 命令。
 *
 * 全 VM 与容器共用同一「会话工作区」事实：宿主工作区经 virtio-9p 共享到 guest 的
 * {@link VM_WORKSPACE}，因此宿主机工作目录必须映射成 guest 路径后再交给远端 shell。
 * argv 逐项单引号转义，绝不拼接未转义的用户输入。
 *
 * @module @soloengine/executor-vm/ssh
 */

import { VmExecutorError } from './error.ts'

/** guest 内的工作区挂载点（基础镜像负责把 virtio-9p 的 `workspace` 标签挂到这里）。 */
export const VM_WORKSPACE = '/workspace'

/** 会话 VM 的 SSH 端口环境变量（节点为每次 shell 调用注入）。 */
export const VM_SSH_PORT_ENV_KEY = 'DSH_VM_SSH_PORT'

/** 会话 VM 的私钥路径环境变量。 */
export const VM_SSH_KEY_ENV_KEY = 'DSH_VM_SSH_KEY'

/** 会话 VM 的登录用户环境变量。 */
export const VM_SSH_USER_ENV_KEY = 'DSH_VM_SSH_USER'

/** 会话 VM 的宿主机工作区环境变量（映射到 guest 的 {@link VM_WORKSPACE}）。 */
export const VM_WORKSPACE_ENV_KEY = 'DSH_VM_WORKSPACE'

/** 一条会话 VM 的 SSH 路由事实（节点注入 shell 环境、执行器与子进程提供方共用）。 */
export interface VmSshRoute {
  /** 宿主机回环上转发到 guest 22 的端口。 */
  sshPort: number
  /** 平台私钥路径（基础镜像预置对应公钥）。 */
  sshKey: string
  /** guest 登录用户。 */
  sshUser: string
  /** 宿主机工作区绝对路径（共享到 guest 的 {@link VM_WORKSPACE}）。 */
  workspace: string
}

/**
 * 从一次调用的显式环境里读会话 VM 路由。
 * @param env - 子进程请求的显式环境。
 * @returns 路由；四项事实不全或端口非法时为 undefined（走本机/容器路径）。
 */
export function vmRouteFromEnv(env: NodeJS.ProcessEnv | undefined): VmSshRoute | undefined {
  const port = env?.[VM_SSH_PORT_ENV_KEY]
  const sshKey = env?.[VM_SSH_KEY_ENV_KEY]
  const sshUser = env?.[VM_SSH_USER_ENV_KEY]
  const workspace = env?.[VM_WORKSPACE_ENV_KEY]
  if (typeof port !== 'string' || port === '') return undefined
  if (typeof sshKey !== 'string' || sshKey === '') return undefined
  if (typeof sshUser !== 'string' || sshUser === '') return undefined
  if (typeof workspace !== 'string' || workspace === '') return undefined
  const sshPort = Number.parseInt(port, 10)
  if (!Number.isInteger(sshPort) || sshPort <= 0) return undefined
  return { sshPort, sshKey, sshUser, workspace }
}

/** 非交互、首次连接即信任平台镜像的 SSH 选项（密钥本身是唯一凭据）。 */
const SSH_OPTIONS: readonly string[] = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=10',
  '-o', 'LogLevel=ERROR',
]

/** 无需转义的参数（POSIX shell 安全字符集）。 */
const SAFE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/u

/**
 * POSIX shell 单引号转义。
 * @param value - 原值。
 * @returns 可直接拼进远端命令的片段。
 */
export function shellQuote(value: string): string {
  if (value === '') return "''"
  if (SAFE_ARGUMENT.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * 构造一条 SSH 调用（本机 `ssh` 进程 → guest）。
 * @param route - 会话 VM 路由。
 * @param remote - guest 内要执行的命令（已转义）。
 * @param tty - 是否为交互终端分配 TTY。
 * @returns 可直接交给本机子进程运行器的 argv。
 */
export function sshArgv(route: VmSshRoute, remote: string, tty = false): string[] {
  return [
    '-i', route.sshKey,
    '-p', String(route.sshPort),
    ...SSH_OPTIONS,
    ...tty ? ['-tt'] : [],
    `${route.sshUser}@127.0.0.1`,
    remote,
  ]
}

/** 远端命令的装配参数。 */
export interface RemoteCommandOptions {
  /** guest 内工作目录；默认 {@link VM_WORKSPACE}。 */
  cwd?: string
  /** 显式环境（逐项 `env KEY=VALUE` 传入 guest）。 */
  env?: NodeJS.ProcessEnv
}

/**
 * 把 argv 装配成 guest 内的 POSIX 命令（`cd … && env … argv…`）。
 *
 * `env` 与 argv 必须在**同一条**命令里：拆成 `env K=V && argv` 会让 `env` 单独执行
 * （打印整份 guest 环境后退出 0），随后 argv 在没有任何注入变量的情况下运行，
 * 同时把环境转储混进命令 stdout。
 * @param argv - 命令与参数（不经宿主 shell）。
 * @param options - 工作目录与显式环境。
 * @returns 远端 shell 命令。
 */
export function remoteCommand(argv: readonly string[], options: RemoteCommandOptions = {}): string {
  if (argv.length === 0) throw new VmExecutorError('remote command requires argv')
  const assignments = Object.entries(options.env ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
  const command = argv.map(shellQuote).join(' ')
  return [
    `cd ${shellQuote(options.cwd ?? VM_WORKSPACE)}`,
    assignments.length === 0 ? command : `env ${assignments.join(' ')} ${command}`,
  ].join(' && ')
}
