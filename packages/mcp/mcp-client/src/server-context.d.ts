/**
 * Publish connection-owned MCP resources and literal server instructions.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */
import type { Context } from '@deepseek-ai/cordis';
import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources';
/** Connection-owned values used by the resource and prompt consumers. */
export interface ServerContext {
    /** Resource access through the current connection generation. */
    resources: McpResourceProvider;
    /**
     * Read the last successfully connected server's attributed instructions.
     * @returns literal prompt text, or an empty string when no server instructions are active.
     */
    instructions(): string;
}
/**
 * Contribute server context to the services enabled by this composition.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param server - configured server identity.
 * @param connection - live resource operations and successful instruction snapshot.
 */
export declare function registerServerContext(ctx: Context, server: string, connection: ServerContext): void;
//# sourceMappingURL=server-context.d.ts.map