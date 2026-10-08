/**
 * Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
 * under deterministic server-qualified public names, and handles re-sync when
 * the server's tool list changes.
 *
 * Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
 * has the stable identity `(serverName, rawName)`; the model-facing public name
 * is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * constraints. The raw name is only ever sent on the wire (`tools/call`); the
 * public name is never parsed to recover it.
 *
 * @module
 */
import { type Client } from '@modelcontextprotocol/client';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/** Resolved options relevant to tool bridging. */
export interface ToolBridgeOptions {
    /** Whether a registry conflict is contained or rejects this synchronization. */
    registrationFailure: 'contain' | 'throw';
    serverName: string;
    toolCallTimeoutMs: number;
}
/** State for one sync generation: the current set of disposers keyed by public name. */
export type ToolDisposers = Map<string, () => void>;
/** Canonical MCP result exposed to PTC mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
    content: JsonValue[];
    structuredContent?: Structured;
};
/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
export declare function publicToolName(serverName: string, rawName: string): string;
/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: let the SDK aggregate `tools/list` and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error or duplicate raw name) rejects
 *    and leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server) and logged. Initial strict
 *    synchronization may propagate the conflict so its parent transaction
 *    rejects; ordinary clients and later re-syncs return an empty map.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
export declare function syncTools(client: Client, ctx: Context, opts: ToolBridgeOptions, previous: ToolDisposers): Promise<ToolDisposers>;
/** One upstream MCP tool and the callback that obtains its raw protocol result. */
export interface McpToolDefinitionOptions {
    /** ToolRuntime name presented to the model. */
    name: string;
    /** Upstream name used in result diagnostics. */
    rawName: string;
    /** Upstream model-facing description. */
    description: string;
    /** Upstream JSON input schema. */
    inputSchema: Record<string, unknown>;
    /** Advertised structured output schema, when present. */
    outputSchema?: unknown;
    /** Whether the upstream tool requires the unsupported task execution extension. */
    taskRequired?: boolean;
    /**
     * Obtain one raw MCP result from the provider.
     * @param args - model arguments admitted by the ToolRuntime.
     * @param execution - exact ToolRuntime invocation, including its Agent and cancellation.
     * @returns the external result object, validated before content projection.
     */
    call(args: Record<string, unknown>, execution: ToolExecution): Promise<unknown>;
}
/**
 * Adapt an upstream MCP tool to canonical values and durable image content.
 * Registration, provider lifetime, deadlines, and transport belong to the caller.
 * @param ctx - plugin context carrying optional attachment and model services.
 * @param options - upstream tool fields and its raw-result callback.
 * @returns the unregistered ToolRuntime definition.
 */
export declare function createMcpToolDefinition(ctx: Context, options: McpToolDefinitionOptions): ToolDefinition;
//# sourceMappingURL=tools.d.ts.map