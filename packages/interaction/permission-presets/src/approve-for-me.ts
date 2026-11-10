/**
 * Deterministic admission for the `approve-for-me` preset. Rules establish the
 * largest auto-approval set: the call's tool must be listed, every shell
 * command segment must match a configured literal token prefix, and no fixed
 * high-risk check (destructive commands, history rewrites, credential paths)
 * may fire. An optional reviewer can only narrow that set; everything
 * unmatched, unparsable, or failed returns to the native approval waterfall,
 * which fails closed without an answerer.
 *
 * @module @deepseek-ai/dsh-permission-presets/approve-for-me
 */

/** Canonical identity of the rule-gated approval preset. */
export const APPROVE_FOR_ME_PRESET = 'approve-for-me'

/** Tool names whose `command` argument is checked against the prefix rules. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh'])

/** Bound on argument strings inspected for sensitive paths. */
const MAX_ARGUMENT_STRINGS = 64

/** Bound on nested containers inspected for sensitive paths. */
const MAX_ARGUMENT_DEPTH = 4

/** One rule outcome: auto-approve, ask the narrow reviewer, or defer to native approval. */
export type Admission = 'allow' | 'review' | 'human'

/** Operator-facing admission rules for the `approve-for-me` preset. */
export interface ApproveForMeConfig {
  /** Tool names eligible for automatic approval; empty approves nothing. */
  tools: string[]
  /** Literal token prefixes; every segment of a compound shell command must match one. */
  commandPrefixes: string[]
  /** Consult the current session model before approving; it can only narrow. */
  review: boolean
}

/** A rule-matched pending call, retained from its `tools/pre-execute` execution. */
export interface PendingCall {
  /** The tool name the model requested. */
  readonly toolName: string
  /** The parsed tool arguments the model requested. */
  readonly arguments: unknown
}

/**
 * Parse configured command prefixes into token sequences.
 * @param prefixes - operator-configured literal prefixes.
 * @returns one token sequence per prefix.
 * @throws when a prefix is empty, spans segments, or cannot be tokenized
 *   unambiguously — a misconfiguration must fail at load, not silently admit.
 */
export function parseCommandPrefixes(prefixes: readonly string[]): readonly (readonly string[])[] {
  return prefixes.map((prefix) => {
    const segments = commandSegments(prefix)
    if (segments === undefined || segments.length !== 1) {
      throw new Error(`permission: command prefix "${prefix}" must be one unquoted command segment`)
    }
    return segments[0] as readonly string[]
  })
}

/**
 * Decide one pending call against the configured rules.
 * @param call - the pending tool call and its parsed arguments.
 * @param config - the configured admission rules.
 * @param prefixes - {@link parseCommandPrefixes} output.
 * @returns `allow` for a fully matched call, `review` when the reviewer must
 *   confirm first, or `human` to defer to the native approval waterfall.
 */
export function admit(
  call: PendingCall,
  config: ApproveForMeConfig,
  prefixes: readonly (readonly string[])[],
): Admission {
  if (!config.tools.includes(call.toolName)) return 'human'
  if (containsSensitivePath(call.arguments)) return 'human'
  if (SHELL_TOOLS.has(call.toolName)) {
    const command = commandOf(call.arguments)
    if (command === undefined) return 'human'
    const segments = commandSegments(command)
    if (segments === undefined) return 'human'
    if (shellHighRisk(segments)) return 'human'
    if (!segments.every(segment => matchesPrefix(segment, prefixes))) return 'human'
  }
  return config.review ? 'review' : 'allow'
}

/**
 * Read the shell command string from one call's arguments.
 * @param arguments_ - the parsed tool arguments.
 * @returns the command, or undefined when the arguments do not carry one.
 */
function commandOf(arguments_: unknown): string | undefined {
  if (arguments_ === null || typeof arguments_ !== 'object' || Array.isArray(arguments_)) return undefined
  const command = (arguments_ as Record<string, unknown>)['command']
  return typeof command === 'string' ? command : undefined
}

/** Whether one segment starts with a configured literal token prefix. */
function matchesPrefix(segment: readonly string[], prefixes: readonly (readonly string[])[]): boolean {
  /* v8 ignore next -- parsed segments never contain an empty word list. */
  const commandWord = segment[0] ?? ''
  // A path-qualified executable escapes the prefix vocabulary (a different
  // binary can share the basename), so it always returns to human approval.
  if (commandWord.includes('/') || commandWord.includes('\\')) return false
  return prefixes.some(prefix => prefix.length <= segment.length
    && prefix.every((token, index) => segment[index] === token))
}

/**
 * Split one shell command into its segments and literal words.
 *
 * Quoting is honoured so `git commit -m "a; b"` stays one segment. Every
 * construct whose effect cannot be established from the literal text —
 * substitution, redirection, subshells, backgrounding, an unbalanced quote —
 * yields undefined, which callers treat as "ask a human".
 * @param command - the raw shell command.
 * @returns the parsed segments, or undefined when parsing is not unambiguous.
 */
function commandSegments(command: string): readonly (readonly string[])[] | undefined {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let started = false
  let quote: '"' | "'" | undefined
  const pushWord = (): void => {
    if (!started) return
    words.push(word)
    word = ''
    started = false
  }
  const pushSegment = (): void => {
    pushWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    if (quote === "'") {
      if (char === "'") quote = undefined
      else word += char
      started = true
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = undefined
      } else if (char === '\\' && index + 1 < command.length) {
        index += 1
        word += command[index] as string
      } else if (char === '$' || char === '`') {
        return undefined
      } else {
        word += char
      }
      started = true
      continue
    }
    if (char === '\\') {
      if (index + 1 >= command.length) return undefined
      index += 1
      word += command[index] as string
      started = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      pushWord()
      continue
    }
    if (char === '\n' || char === ';') {
      pushSegment()
      continue
    }
    if (char === '|' || char === '&') {
      pushSegment()
      if (command[index + 1] === char) {
        index += 1
        continue
      }
      if (char === '|') continue
      return undefined
    }
    if (char === '$' || char === '`' || char === '<' || char === '>' || char === '(' || char === ')') return undefined
    word += char
    started = true
  }
  if (quote !== undefined) return undefined
  pushSegment()
  return segments.length === 0 ? undefined : segments
}

/** Whether any segment performs a fixed high-risk effect. */
function shellHighRisk(segments: readonly (readonly string[])[]): boolean {
  for (const words of segments) {
    if (words.some(word => isSensitivePath(word))) return true
    if (isHighRiskSegment(words)) return true
  }
  for (let index = 1; index < segments.length; index += 1) {
    /* v8 ignore next -- parsed segments never contain an empty word list. */
    const fetcher = basename((segments[index - 1] as readonly string[])[0] ?? '')
    /* v8 ignore next -- parsed segments never contain an empty word list. */
    const runner = basename((segments[index] as readonly string[])[0] ?? '')
    if ((fetcher === 'curl' || fetcher === 'wget') && runner.endsWith('sh')) return true
  }
  return false
}

/** Whether one literal command segment performs a fixed high-risk effect. */
function isHighRiskSegment(words: readonly string[]): boolean {
  /* v8 ignore next -- parsed segments never contain an empty word list. */
  const command = basename(words[0] ?? '')
  const args = words.slice(1)
  switch (command) {
    case 'rm':
      return args.some(flag => /^-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*$/u.test(flag) || /^-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*$/u.test(flag))
        && args.some(target => target === '/' || target === '/*')
    case 'dd':
      return args.some(arg => arg.startsWith('of=/dev/')
        && !['of=/dev/null', 'of=/dev/zero', 'of=/dev/random', 'of=/dev/urandom', 'of=/dev/stdout', 'of=/dev/stderr', 'of=/dev/tty'].includes(arg))
    case 'chmod':
      return (args.includes('-R') && args.includes('777'))
        || args.some(arg => arg === 'u+s' || arg === 'g+s' || arg === '+s' || /^[4-7]...$/u.test(arg))
    case 'chown':
      return args.includes('-R')
    case 'shutdown':
    case 'reboot':
    case 'halt':
    case 'poweroff':
      return true
    case 'git':
      return (args.includes('push') && args.some(arg => arg === '--force' || arg === '-f' || arg === '--force-with-lease'))
        || (args.includes('reset') && args.includes('--hard'))
    default:
      return command.startsWith('mkfs')
  }
}

/** Basename of one command word across both path separators. */
function basename(word: string): string {
  const cut = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'))
  return (cut === -1 ? word : word.slice(cut + 1)).toLowerCase()
}

/** Fixed credential and secret path shapes from the absorbed high-risk baseline. */
const SENSITIVE_PATHS: readonly RegExp[] = [
  /(^|[\\/])\.ssh([\\/]|$)/u,
  /(^|[\\/])\.env$/u,
  /(^|[\\/])\.aws([\\/]|$)/u,
  /(^|[\\/])\.gnupg([\\/]|$)/u,
  /(^|[\\/])\.kube([\\/]|$)/u,
  /\.pem$/u,
  /\.key$/u,
  /(^|[\\/])credentials$/u,
  /(^|[\\/])kubeconfig$/u,
  /(^|[\\/])id_rsa[^\\/]*$/u,
  /(^|[\\/])id_ed25519[^\\/]*$/u,
]

/** Whether one literal word names a credential or secret path. */
function isSensitivePath(word: string): boolean {
  return SENSITIVE_PATHS.some(pattern => pattern.test(word))
}

/** Whether any string inside the arguments names a credential or secret path. */
function containsSensitivePath(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return isSensitivePath(value)
  if (depth >= MAX_ARGUMENT_DEPTH || value === null || typeof value !== 'object') return false
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  let inspected = 0
  for (const child of children) {
    if (inspected >= MAX_ARGUMENT_STRINGS) break
    inspected += 1
    if (containsSensitivePath(child, depth + 1)) return true
  }
  return false
}

/** Fixed prompt for the optional narrowing reviewer. */
export const REVIEW_POLICY = `REVIEW_POLICY
You are a narrow second reviewer for exactly one tool call that already matched the deployment's deterministic approval rules. Your decision can only narrow that set: allow the call, or return it to the human approval prompt. Never widen the rules.

Return exactly one JSON object and no other text. The only valid shapes are:
{"decision":"allow"}
{"decision":"deny"}

Deny when the call's actual effects are unclear, broader than its apparent purpose, destructive, irreversible, production-facing, or touch credentials, secrets, or remote state. Judge the arguments, never the tool name or a claimed intention.`

/**
 * Render the reviewer's user message for one pending call.
 * @param call - the rule-matched call.
 * @param cwd - the session working directory the call would run in.
 * @returns the JSON sections the reviewer reads.
 */
export function reviewPrompt(call: PendingCall, cwd: string): string {
  return [
    'PENDING_ACTION',
    JSON.stringify({ cwd, tool: call.toolName, arguments: call.arguments }, undefined, 2),
  ].join('\n\n')
}

/**
 * Parse one reviewer response.
 * @param text - the complete reviewer text.
 * @returns whether it is exactly the allow object; every other shape narrows.
 */
export function reviewAllows(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return Object.keys(record).length === 1 && record['decision'] === 'allow'
  } catch {
    return false
  }
}
