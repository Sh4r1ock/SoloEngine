/**
 * Three shared tools adapt model arguments to scoped resource operations.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { renderResourceResult } from "./render.js";
const listParameters = {
    server: { type: 'string', required: true, description: 'Configured MCP server name.' },
    cursor: { type: 'string', description: 'Continuation cursor returned by this server.' },
};
const output = {
    schema: { type: 'json' },
    render: (args, value) => renderResourceResult(args.server, value),
};
/**
 * Register resource operations in the consumer's tool scope.
 * @param ctx - context owning the tool registrations.
 * @param request - caller-aware resource operation.
 * @returns the effect disposer that removes all three tools synchronously.
 */
export function registerResourceTools(ctx, request) {
    const dispose = ctx.effect(function* () {
        yield ctx.tools.register(defineTool({
            name: 'list_mcp_resources',
            description: 'List resources available from an MCP server.',
            parameters: listParameters,
            output,
            execute: (args, exec) => request(args.server, {
                method: 'resources/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
            }, exec),
        }));
        yield ctx.tools.register(defineTool({
            name: 'list_mcp_resource_templates',
            description: 'List parameterized resource URI templates from an MCP server.',
            parameters: listParameters,
            output,
            execute: (args, exec) => request(args.server, {
                method: 'resources/templates/list', ...args.cursor === undefined ? {} : { cursor: args.cursor },
            }, exec),
        }));
        yield ctx.tools.register(defineTool({
            name: 'read_mcp_resource',
            description: 'Read an MCP resource by URI from the named server. Use a listed URI or an expanded resource template.',
            parameters: {
                server: listParameters.server,
                uri: { type: 'string', required: true, description: 'Resource URI to read.' },
            },
            output,
            execute: (args, exec) => request(args.server, { method: 'resources/read', uri: args.uri }, exec),
        }));
    }, 'mcpResources.resourceTools');
    // oxlint-disable-next-line typescript/no-misused-promises -- all collected tool disposers are synchronous
    return dispose;
}
//# sourceMappingURL=tools.js.map