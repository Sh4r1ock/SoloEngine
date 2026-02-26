#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    from main import mcp
    mcp.run(transport="stdio")
