/**
 * Scoped MCP resource providers and the shared model-facing resource tools.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
declare module '@deepseek-ai/cordis' {
    interface Context {
        mcpResources: McpResourceRuntime;
    }
}
/** One supported resource operation, with server-owned cursors and URIs. */
export type McpResourceRequest = {
    method: 'resources/list' | 'resources/templates/list';
    cursor?: string;
} | {
    method: 'resources/read';
    uri: string;
};
/** One configured server's resource access, owned by its MCP connection plugin. */
export interface McpResourceProvider {
    /**
     * Run an operation against one live connection generation.
     * @param request - MCP resource method and parameters.
     * @param exec - caller identity and cancellation for this invocation.
     * @returns the protocol result as lossless JSON.
     */
    request(request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue>;
}
/** Scoped resource access plus three tools shared by configured MCP servers. */
export declare class McpResourceRuntime extends Service {
    /** Tool registry required by the resource consumer. */
    static inject: string[];
    private readonly layers;
    /** Shared tool registrations outlive any one server's registering context. */
    private readonly selfCtx;
    constructor(ctx: Context);
    /**
     * Register one server and expose resource tools while that scope has providers.
     * @param server - configured server name, unique in this scope.
     * @param provider - connection-owned resource operations.
     * @returns the effect disposer for this exact registration.
     */
    register(server: string, provider: McpResourceProvider): () => void;
    /** Own one scope's tools independently of its configured server plugins. */
    private registerTools;
    /** Resolve the caller-visible server before starting any network operation. */
    private request;
}
export default McpResourceRuntime;
//# sourceMappingURL=index.d.ts.map