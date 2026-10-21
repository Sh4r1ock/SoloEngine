/** Package admission shared by offline catalog generation and release ordering. */

/**
 * Public DSH release members available through the ordinary on-demand bundle installer.
 *
 * The upstream list held the two optional subagent providers (`subagent-claude-code`,
 * `subagent-codex`). SoloEngine trims both (D1/D16): they pull the sdk and hooks domains
 * the product does not carry, and a user who wants them installs the DSH plugin manually.
 * The catalog therefore ships empty.
 */
export const ON_DEMAND_BUNDLES: readonly string[] = []
