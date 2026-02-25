# -*- coding: utf-8 -*-
"""
天气工具模块 - 使用 Open-Meteo API 获取真实天气数据

@file weather.py
@description 天气查询工具 - 使用 Open-Meteo 免费API
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 使用 Open-Meteo API 获取真实天气数据
- 支持多个城市查询
- 无需API密钥

使用场景：
- ToolkitExecutor 工具注册
- ReActAgent 工具调用
"""

import httpx
from typing import Dict, Any, Optional
from .toolkit_executor import ToolResponse


CITY_COORDINATES = {
    "北京": {"lat": 39.9042, "lon": 116.4074},
    "上海": {"lat": 31.2304, "lon": 121.4737},
    "广州": {"lat": 23.1291, "lon": 113.2644},
    "深圳": {"lat": 22.5431, "lon": 114.0579},
    "杭州": {"lat": 30.2741, "lon": 120.1551},
    "成都": {"lat": 30.5728, "lon": 104.0668},
    "武汉": {"lat": 30.5928, "lon": 114.3055},
    "西安": {"lat": 34.3416, "lon": 108.9398},
    "南京": {"lat": 32.0603, "lon": 118.7969},
    "重庆": {"lat": 29.4316, "lon": 106.9123},
    "天津": {"lat": 39.0842, "lon": 117.2009},
    "苏州": {"lat": 31.2989, "lon": 120.5853},
}

WEATHER_CODE_DESC = {
    0: "晴朗", 1: "大部晴朗", 2: "局部多云", 3: "阴天",
    45: "雾", 48: "霜雾", 
    51: "小雨", 53: "中雨", 55: "大雨",
    61: "小雨", 63: "中雨", 65: "大雨", 
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪",
    77: "雪粒",
    80: "阵雨", 81: "中阵雨", 82: "大阵雨",
    85: "小阵雪", 86: "大阵雪",
    95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹"
}


async def get_weather(city: str) -> ToolResponse:
    """
    获取指定城市的天气信息（真实API调用）
    
    使用 Open-Meteo 免费API，无需API密钥。
    
    Args:
        city: 城市名称（支持：北京、上海、广州、深圳、杭州、成都、武汉、西安、南京、重庆、天津、苏州）
    
    Returns:
        ToolResponse: 包含天气信息的响应
    
    Example:
        >>> result = await get_weather("北京")
        >>> print(result.content)
        【天气查询结果】北京：晴朗，温度 15.2°C，湿度 45%，风速 12.5 km/h
    """
    if city not in CITY_COORDINATES:
        supported_cities = list(CITY_COORDINATES.keys())
        return ToolResponse(
            content=f"城市 '{city}' 不在支持列表中。支持的城市：{supported_cities}",
            success=False,
            error_message=f"Unsupported city: {city}"
        )
    
    coords = CITY_COORDINATES[city]
    
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": coords["lat"],
                    "longitude": coords["lon"],
                    "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                    "timezone": "auto"
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                current = data.get("current", {})
                temp = current.get("temperature_2m", "N/A")
                humidity = current.get("relative_humidity_2m", "N/A")
                weather_code = current.get("weather_code", 0)
                wind_speed = current.get("wind_speed_10m", "N/A")
                
                weather_desc = WEATHER_CODE_DESC.get(weather_code, f"天气代码{weather_code}")
                
                result_text = (
                    f"【天气查询结果】{city}：{weather_desc}，"
                    f"温度 {temp}°C，湿度 {humidity}%，风速 {wind_speed} km/h"
                )
                
                return ToolResponse(content=result_text)
            else:
                return ToolResponse(
                    content=f"天气API请求失败：HTTP {response.status_code}",
                    success=False,
                    error_message=f"HTTP {response.status_code}"
                )
        except Exception as e:
            return ToolResponse(
                content=f"天气查询出错：{str(e)}",
                success=False,
                error_message=str(e)
            )


def get_weather_tool_spec() -> Dict[str, Any]:
    """
    获取天气工具的规范定义
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到 ToolkitExecutor
    """
    return {
        "name": "get_weather",
        "function": get_weather,
        "description": "获取指定城市的天气信息。使用Open-Meteo API获取实时天气数据。",
        "parameters": {
            "city": {
                "type": "string",
                "required": True,
                "description": "城市名称（支持：北京、上海、广州、深圳、杭州、成都、武汉、西安、南京、重庆、天津、苏州）"
            }
        }
    }
