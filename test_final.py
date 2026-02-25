# -*- coding: utf-8 -*-
"""完整验证：编译、数据库存储、工具调用"""

import requests
import os
import json
import tempfile

BASE_URL = "http://localhost:8993/api/v1/mcp"

def main():
    print("\n" + "=" * 60)
    print("完整验证：编译 → 数据库存储 → 工具调用")
    print("=" * 60)
    
    # 1. 上传并编译
    print("\n【步骤1】上传 Python 文件并编译")
    
    python_code = '''# -*- coding: utf-8 -*-
def calculate(a: int, b: int):
    """计算两个数的和与差"""
    return {
        "sum": a + b,
        "difference": a - b,
        "product": a * b
    }
'''
    
    tools = [
        {
            "function_name": "calculate",
            "description": "计算两个整数的和、差、积",
            "parameters": [
                {"name": "a", "type": "integer", "description": "第一个整数", "required": True},
                {"name": "b", "type": "integer", "description": "第二个整数", "required": True}
            ]
        }
    ]
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(python_code)
        temp_path = f.name
    
    try:
        with open(temp_path, 'rb') as f:
            files = {'file': ('calc.py', f, 'text/x-python')}
            data = {
                'name': 'calc_server',
                'description': '计算器 MCP Server',
                'tools': json.dumps(tools)
            }
            resp = requests.post(f"{BASE_URL}/servers/upload/python", files=files, data=data)
        
        result = resp.json()
        if result.get("code") != 200:
            print(f"❌ 编译失败: {result}")
            return
        
        server_id = result.get("data", {}).get("id")
        print(f"✅ 编译成功! server_id: {server_id}")
        
    finally:
        os.unlink(temp_path)
    
    # 2. 检查数据库存储
    print("\n【步骤2】检查数据库存储")
    resp = requests.get(f"{BASE_URL}/servers/{server_id}")
    result = resp.json()
    
    if result.get("code") == 200:
        server = result.get("data", {})
        print(f"   id: {server.get('id')}")
        print(f"   name: {server.get('name')}")
        print(f"   transport: {server.get('transport')}")
        print(f"   storage_path: {server.get('storage_path')}")
        print(f"   description: {server.get('description')}")
        print(f"   command: {server.get('command')}")
        print(f"   args: {server.get('args')}")
        print(f"   tools: {json.dumps(server.get('tools'), ensure_ascii=False, indent=6)}")
        
        # 验证 tools 是否存储
        if server.get('tools'):
            print(f"\n   ✅ tools 字段已正确存储!")
        else:
            print(f"\n   ❌ tools 字段为空!")
            return
    else:
        print(f"❌ 获取服务器信息失败")
        return
    
    # 3. 连接并调用
    print("\n【步骤3】连接并调用工具")
    resp = requests.post(f"{BASE_URL}/servers/{server_id}/connect")
    if resp.json().get("code") != 200:
        print(f"❌ 连接失败")
        return
    print(f"✅ 连接成功!")
    
    # 4. 调用工具
    print("\n【步骤4】调用 calculate_tool(100, 25)")
    resp = requests.post(
        f"{BASE_URL}/servers/{server_id}/tools/calculate_tool/call",
        json={"arguments": {"a": 100, "b": 25}}
    )
    result = resp.json()
    
    if result.get("code") == 200:
        data = result.get("data", {})
        if data.get("success"):
            content = data.get("content", [])
            if content:
                text = content[0].get("text", "")
                parsed = json.loads(text)
                print(f"   ✅ 调用成功!")
                print(f"   结果: sum={parsed['sum']}, difference={parsed['difference']}, product={parsed['product']}")
                
                # 验证
                assert parsed["sum"] == 125
                assert parsed["difference"] == 75
                assert parsed["product"] == 2500
                print(f"   ✅ 结果验证通过!")
        else:
            print(f"   ❌ 调用失败")
            return
    else:
        print(f"   ❌ 请求失败")
        return
    
    # 5. 清理
    print("\n【步骤5】清理测试数据")
    requests.post(f"{BASE_URL}/servers/{server_id}/disconnect")
    requests.delete(f"{BASE_URL}/servers/{server_id}")
    print(f"   ✅ 已删除服务器")
    
    print("\n" + "=" * 60)
    print("✅ 全部验证通过!")
    print("=" * 60)

if __name__ == "__main__":
    main()
