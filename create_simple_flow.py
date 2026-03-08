import requests
import json

API_BASE = "http://localhost:8000/api/v1"

def login():
    response = requests.post(f"{API_BASE}/auth/login", json={
        "username": "testuser",
        "password": "test123456"
    })
    data = response.json()
    return data["data"]["access_token"]

def create_simple_flow(token):
    canvas_data = {
        "nodes": [
            {
                "id": "simple_agent",
                "type": "agent",
                "position": {"x": 500, "y": 200},
                "data": {
                    "name": "助手",
                    "desc": "一个简单的助手",
                    "agentType": "executor",
                    "system_prompt": "你是一个友好的助手。请用简洁的语言回答用户的问题。",
                    "user_prompt": "",
                    "assistant_prompt": "",
                    "model_config": {
                        "provider": "deepseek",
                        "model": "deepseek-chat",
                        "api_key": "sk-eead4e31663d42e4ad09584dc4346779",
                        "base_url": "https://api.deepseek.com"
                    },
                    "skills": [],
                    "tools": [],
                    "memory": False
                }
            }
        ],
        "edges": []
    }
    
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(f"{API_BASE}/agentic-flows", 
        headers=headers,
        json={
            "name": "Simple Test Flow",
            "description": "简单测试流程",
            "canvas_data": canvas_data
        }
    )
    print(f"Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    return response.json()

if __name__ == "__main__":
    token = login()
    print(f"Token: {token[:50]}...")
    
    result = create_simple_flow(token)
    print(f"\nCreated Flow ID: {result['data']['id']}")
