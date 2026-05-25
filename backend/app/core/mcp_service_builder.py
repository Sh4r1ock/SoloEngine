# -*- coding: utf-8 -*-
"""
SoloEngine : MCP服务构建器模块

@file mcp_service_builder.py
@description MCP服务构建器 - 创建自定义MCP服务
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 创建自定义MCP服务模板
    - 生成MCP服务代码（Python/TypeScript）
    - 支持多种传输协议（stdio/http）
    - 生成MCP服务配置
    - 提供预设模板

依赖:
    - os: 操作系统接口
    - json: JSON处理
    - logging: 日志记录
    - typing: 类型注解支持
    - pathlib: 路径处理
    - datetime: 日期时间处理

使用示例:
    - from app.core.mcp_service_builder import MCPServiceBuilder
    - builder = MCPServiceBuilder()
    - result = builder.create_service("my_service", "描述", tools, "python", "stdio")

使用场景：
    - 用户手动编写新的MCP服务
    - 快速生成MCP服务框架
"""

import os
import logging
from typing import Dict, List, Any
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings

logger = logging.getLogger(__name__)


class MCPServiceTemplate:
    """MCP服务模板生成器。"""

    @staticmethod
    def generate_python_service(
        service_name: str,
        description: str,
        tools: List[Dict[str, Any]],
        resources: List[Dict[str, Any]] = None,
        output_dir: str = None
    ) -> str:
        tools_code = []
        for tool in tools:
            tool_name = tool.get("name", "unnamed_tool")
            tool_desc = tool.get("description", "")
            tool_params = tool.get("parameters", {})
            
            params_code = []
            for param_name, param_info in tool_params.items():
                param_type = param_info.get("type", "string")
                param_desc = param_info.get("description", "")
                params_code.append(f'        "{param_name}": {{"type": "{param_type}", "description": "{param_desc}"}},')
            
            tools_code.append(f'''
    @server.tool(
        name="{tool_name}",
        description="{tool_desc}",
        parameters={{
{chr(10).join(params_code)}
        }}
    )
    async def {tool_name.replace("-", "_")}(**kwargs):
        """实现 {tool_name} 工具。"""
        logger.info(f"Tool {tool_name} called with: {{kwargs}}")
        result = {{
            "success": True,
            "tool": "{tool_name}",
            "arguments": kwargs,
            "output": f"Tool {tool_name} executed successfully"
        }}
        return result
''')

        resources_code = ""
        if resources:
            for resource in resources:
                resource_name = resource.get("name", "unnamed_resource")
                resource_desc = resource.get("description", "")
                resources_code += f'''
    @server.resource(
        uri="{resource_name}",
        name="{resource_name}",
        description="{resource_desc}"
    )
    async def get_{resource_name.replace("-", "_")}():
        """实现 {resource_name} 资源。"""
        logger.info(f"Resource {resource_name} accessed")
        return {{"content": "Resource {resource_name} content", "uri": "{resource_name}"}}
'''

        template = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{service_name} - MCP服务

描述: {description}
创建时间: {datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()}
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class {service_name.replace("-", "_").replace(" ", "_").title()}Server:
    """{service_name} MCP服务器。"""

    def __init__(self):
        self.name = "{service_name}"
        self.version = "1.0.0"
        self.tools = []
        self.resources = []

    async def initialize(self):
        """初始化服务器。"""
        logger.info(f"Initializing {{self.name}} MCP server")

    async def list_tools(self) -> List[Dict[str, Any]]:
        """列出可用工具。"""
        return [
            {", ".join([f'{{"name": "{t.get("name")}", "description": "{t.get("description")}"}}' for t in tools])}
        ]

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """调用工具。"""
        logger.info(f"Tool called: {{name}} with arguments: {{arguments}}")
        
        result = {{"success": False, "error": "Unknown tool"}}
        
        tool_handlers = {{
            # 工具处理器映射 - 根据实际需求实现
        }}
        
        handler = tool_handlers.get(name)
        if handler:
            try:
                result = await handler(arguments)
            except Exception as e:
                result = {{"success": False, "error": str(e)}}
        else:
            result = {{"success": False, "error": f"Tool '{{name}}' not implemented. Please implement the handler in the tool_handlers dictionary."}}
        
        return result

    async def list_resources(self) -> List[Dict[str, Any]]:
        """列出可用资源。"""
        return []

    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """读取资源。"""
        logger.info(f"Resource read: {{uri}}")
        return {{"content": ""}}

    async def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """处理MCP请求。"""
        method = request.get("method", "")
        params = request.get("params", {{}})
        
        if method == "initialize":
            return {{
                "result": {{
                    "protocolVersion": "2024-11-05",
                    "capabilities": {{
                        "tools": {{}},
                        "resources": {{}}
                    }},
                    "serverInfo": {{
                        "name": self.name,
                        "version": self.version
                    }}
                }}
            }}
        elif method == "tools/list":
            tools = await self.list_tools()
            return {{"result": {{"tools": tools}}}}
        elif method == "tools/call":
            name = params.get("name", "")
            arguments = params.get("arguments", {{}})
            result = await self.call_tool(name, arguments)
            return {{"result": result}}
        elif method == "resources/list":
            resources = await self.list_resources()
            return {{"result": {{"resources": resources}}}}
        elif method == "resources/read":
            uri = params.get("uri", "")
            result = await self.read_resource(uri)
            return {{"result": result}}
        else:
            return {{"error": {{"code": -32601, "message": f"Method not found: {{method}}"}}}}


async def run_stdio():
    """以stdio模式运行。"""
    server = {service_name.replace("-", "_").replace(" ", "_").title()}Server()
    await server.initialize()
    
    import sys
    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            
            request = json.loads(line.strip())
            response = await server.handle_request(request)
            response["id"] = request.get("id")
            
            print(json.dumps(response), flush=True)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {{e}}")
        except Exception as e:
            logger.error(f"Error: {{e}}")


async def run_http(host: str = "localhost", port: int = 8080):
    """以HTTP模式运行。"""
    from aiohttp import web
    
    server = {service_name.replace("-", "_").replace(" ", "_").title()}Server()
    await server.initialize()
    
    async def handle_post(request):
        data = await request.json()
        response = await server.handle_request(data)
        return web.json_response(response)
    
    app = web.Application()
    app.router.add_post("/", handle_post)
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    
    logger.info(f"HTTP server running on http://{{host}}:{{port}}")
    
    try:
        while True:
            from app.core.config import settings
            await asyncio.sleep(settings.MCP_SERVICE_KEEPALIVE_INTERVAL)
    except asyncio.CancelledError:
        pass
    finally:
        await runner.cleanup()


def main():
    """主入口。"""
    import argparse
    
    parser = argparse.ArgumentParser(description="{service_name} MCP Server")
    parser.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8080)
    
    args = parser.parse_args()
    
    if args.transport == "stdio":
        asyncio.run(run_stdio())
    else:
        asyncio.run(run_http(args.host, args.port))


if __name__ == "__main__":
    main()
'''
        output_dir = output_dir or os.path.join(os.getcwd(), "mcp_services")
        os.makedirs(output_dir, exist_ok=True)
        
        file_name = f"{service_name.lower().replace('-', '_').replace(' ', '_')}.py"
        file_path = os.path.join(output_dir, file_name)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(template)
        
        logger.info(f"Generated MCP service: {file_path}")
        return file_path

    @staticmethod
    def generate_typescript_service(
        service_name: str,
        description: str,
        tools: List[Dict[str, Any]],
        output_dir: str = None
    ) -> str:
        tools_code = []
        for tool in tools:
            tool_name = tool.get("name", "unnamed_tool")
            tool_desc = tool.get("description", "")
            tools_code.append(f'''
  {{
    name: "{tool_name}",
    description: "{tool_desc}",
    inputSchema: {{
      type: "object",
      properties: {{
        // Parameters defined by tool configuration
      }}
    }},
    handler: async (args: any) => {{
      console.log(`Tool {tool_name} called with:`, args);
      return {{ 
        content: [
          {{ 
            type: "text", 
            text: `Tool {tool_name} executed successfully with arguments: ${{JSON.stringify(args)}}` 
          }}
        ] 
      }};
    }}
  }}''')

        template = f'''#!/usr/bin/env node
/**
 * {service_name} - MCP服务
 * 
 * 描述: {description}
 * 创建时间: {datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()}
 */

import {{ Server }} from '@modelcontextprotocol/sdk/server/index.js';
import {{ StdioServerTransport }} from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  {{
    name: "{service_name}",
    version: "1.0.0"
  }},
  {{
    capabilities: {{
      tools: {{}}
    }}
  }}
);

const tools = [
{','.join(tools_code)}
];

server.setRequestHandler(ListToolsRequestSchema, async () => {{
  return {{
    tools: tools.map(t => ({{
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }}))
  }};
}});

server.setRequestHandler(CallToolRequestSchema, async (request) => {{
  const {{ name, arguments: args }} = request.params;
  const tool = tools.find(t => t.name === name);
  
  if (!tool) {{
    throw new Error(`Unknown tool: ${{name}}`);
  }}
  
  return await tool.handler(args);
}});

async function main() {{
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("{service_name} MCP server running on stdio");
}}

main().catch(console.error);
'''
        output_dir = output_dir or os.path.join(os.getcwd(), "mcp_services")
        os.makedirs(output_dir, exist_ok=True)
        
        file_name = f"{service_name.lower().replace('-', '_').replace(' ', '_')}.ts"
        file_path = os.path.join(output_dir, file_name)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(template)
        
        logger.info(f"Generated TypeScript MCP service: {file_path}")
        return file_path

    @staticmethod
    def generate_config(
        service_name: str,
        transport: str = "stdio",
        command: str = None,
        args: List[str] = None,
        env: Dict[str, str] = None,
        url: str = None
    ) -> Dict[str, Any]:
        config = {
            "name": service_name,
            "transport": transport,
            "enabled": True
        }

        if transport == "stdio":
            config["command"] = command or "python"
            config["args"] = args or [f"{service_name.lower().replace('-', '_')}.py"]
            config["env"] = env or {}
        elif transport in ["http", "websocket", "sse"]:
            config["url"] = url
            if not config["url"]:
                from app.core.config import settings
                config["url"] = settings.MCP_DEFAULT_URL

        return config


class MCPServiceBuilder:
    """MCP服务构建器。"""

    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir or os.path.join(os.getcwd(), "mcp_services")
        os.makedirs(self.output_dir, exist_ok=True)

    def create_service(
        self,
        name: str,
        description: str,
        tools: List[Dict[str, Any]],
        language: str = "python",
        transport: str = "stdio"
    ) -> Dict[str, Any]:
        if language == "python":
            file_path = MCPServiceTemplate.generate_python_service(
                name, description, tools, output_dir=self.output_dir
            )
        else:
            file_path = MCPServiceTemplate.generate_typescript_service(
                name, description, tools, output_dir=self.output_dir
            )

        config = MCPServiceTemplate.generate_config(
            name, transport,
            command="python" if language == "python" else "node",
            args=[os.path.basename(file_path)]
        )

        return {
            "file_path": file_path,
            "config": config
        }

    def create_tool_template(self, name: str, description: str, 
                            parameters: Dict[str, Any] = None) -> Dict[str, Any]:
        return {
            "name": name,
            "description": description,
            "parameters": parameters or {}
        }

    def list_templates(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "web_scraper",
                "name": "Web Scraper",
                "description": "网页抓取工具",
                "tools": [
                    {"name": "fetch_url", "description": "获取网页内容", 
                     "parameters": {"url": {"type": "string", "description": "网页URL"}}}
                ]
            },
            {
                "id": "file_manager",
                "name": "File Manager",
                "description": "文件管理工具",
                "tools": [
                    {"name": "read_file", "description": "读取文件内容",
                     "parameters": {"path": {"type": "string", "description": "文件路径"}}},
                    {"name": "write_file", "description": "写入文件内容",
                     "parameters": {"path": {"type": "string"}, "content": {"type": "string"}}}
                ]
            },
            {
                "id": "database_query",
                "name": "Database Query",
                "description": "数据库查询工具",
                "tools": [
                    {"name": "execute_query", "description": "执行SQL查询",
                     "parameters": {"sql": {"type": "string", "description": "SQL语句"}}}
                ]
            },
            {
                "id": "api_client",
                "name": "API Client",
                "description": "API调用工具",
                "tools": [
                    {"name": "http_get", "description": "HTTP GET请求",
                     "parameters": {"url": {"type": "string"}}},
                    {"name": "http_post", "description": "HTTP POST请求",
                     "parameters": {"url": {"type": "string"}, "body": {"type": "object"}}}
                ]
            }
        ]

    def create_from_template(self, template_id: str, custom_name: str = None,
                            language: str = "python") -> Dict[str, Any]:
        templates = self.list_templates()
        template = next((t for t in templates if t["id"] == template_id), None)
        
        if not template:
            raise ValueError(f"Template not found: {template_id}")

        return self.create_service(
            name=custom_name or template["name"],
            description=template["description"],
            tools=template["tools"],
            language=language
        )


mcp_service_builder = MCPServiceBuilder()
