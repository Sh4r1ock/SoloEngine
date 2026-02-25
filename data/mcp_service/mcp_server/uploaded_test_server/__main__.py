#!/usr/bin/env python3
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    from main import *
    if 'serve' in dir():
        asyncio.run(serve())
    elif 'mcp' in dir():
        mcp.run(transport="stdio")
