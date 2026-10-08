/**
 * Scoped MCP resource providers and the shared model-facing resource tools.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */
import { Service } from '@deepseek-ai/cordis';
import { createScope, NamedEntries, ScopedLayers, scopeOf } from '@deepseek-ai/dsh-scope';
import { registerResourceTools } from "./tools.js";
class ResourceLayer {
    servers = new NamedEntries(name => new Error(`MCP resource server "${name}" is already registered in this scope`));
    disposeTools;
    isEmpty() {
        return this.servers.isEmpty();
    }
}
/** Scoped resource access plus three tools shared by configured MCP servers. */
export class McpResourceRuntime extends Service {
    /** Tool registry required by the resource consumer. */
    static inject = ['tools'];
    layers = new ScopedLayers(() => new ResourceLayer(), () => undefined);
    /** Shared tool registrations outlive any one server's registering context. */
    selfCtx;
    constructor(ctx) {
        super(ctx, 'mcpResources');
        this.selfCtx = ctx;
        ctx.inject(['systemPrompt'], (inner) => {
            inner.systemPrompt.section({
                name: 'mcp-resource-servers',
                order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
                interpolate: false,
                text: ({ scope }) => {
                    const names = [...this.layers.merge(scope, layer => layer.servers).keys()].sort();
                    return names.length === 0 ? '' : '## MCP resource servers\n\n'
                        + 'Use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names '
                        + `as the server argument: ${JSON.stringify(names)}.`;
                },
            });
        });
    }
    /**
     * Register one server and expose resource tools while that scope has providers.
     * @param server - configured server name, unique in this scope.
     * @param provider - connection-owned resource operations.
     * @returns the effect disposer for this exact registration.
     */
    register(server, provider) {
        const ctx = this.ctx;
        const scope = scopeOf(ctx);
        const dispose = ctx.effect(function* () {
            let disposal;
            // Tools disappear synchronously; Cordis owns any pending scoped-fiber teardown.
            yield () => disposal;
            yield this.layers.effect(ctx, (layer) => {
                const first = layer.servers.isEmpty();
                const remove = layer.servers.insert(server, provider);
                try {
                    if (first)
                        layer.disposeTools = this.registerTools(scope);
                }
                catch (error) {
                    remove();
                    throw error;
                }
                return () => {
                    remove();
                    // oxlint-disable-next-line typescript/no-non-null-assertion -- successful provider registration owns the shared tools
                    if (layer.servers.isEmpty())
                        disposal = layer.disposeTools();
                };
            }, { label: `mcpResources.provider(${server})` });
        }.bind(this), `mcpResources.register(${server})`);
        // oxlint-disable-next-line typescript/no-misused-promises -- visibility cleanup is synchronous; Cordis retains pending fiber disposal
        return dispose;
    }
    /** Own one scope's tools independently of its configured server plugins. */
    registerTools(scope) {
        const ctx = this.selfCtx;
        return ctx.effect(function* () {
            let toolCtx = ctx;
            if (scope !== undefined) {
                const owned = createScope(ctx, scope);
                yield owned.rawDispose;
                toolCtx = owned.ctx;
            }
            yield registerResourceTools(toolCtx, (server, request, exec) => this.request(server, request, exec));
        }.bind(this), 'mcpResources.tools');
    }
    /** Resolve the caller-visible server before starting any network operation. */
    request(server, request, exec) {
        const provider = this.layers.merge(exec.agent, layer => layer.servers).get(server);
        if (!provider)
            throw new Error(`MCP resource server "${server}" is unavailable in this agent's scope`);
        return provider.request(request, exec);
    }
}
export default McpResourceRuntime;
//# sourceMappingURL=index.js.map