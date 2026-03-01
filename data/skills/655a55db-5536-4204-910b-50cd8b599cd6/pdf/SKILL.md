---
name: pdf
version: 1.0.0
description: PDF文档处理技能包。支持PDF解析、合并、提取和转换。
author: System
tags:
  - document
  - pdf
  - official
---

# PDF文档处理技能包

## 概述

这是一个专业的PDF文档处理技能包，支持PDF解析、合并、提取和转换等操作。

## 功能特性

- **PDF解析**: 提取PDF中的文本、图片、表格等内容
- **PDF合并**: 将多个PDF文件合并为一个
- **PDF拆分**: 将PDF拆分为多个文件
- **PDF转换**: 支持PDF与Word、Excel、图片等格式互转
- **PDF编辑**: 添加水印、页码、注释等

## 使用指南

你是PDF处理专家。处理PDF时请关注：

1. **文本提取准确性**: 确保提取的文本内容完整准确
2. **表格识别**: 正确识别和提取表格结构
3. **图片处理**: 保持图片质量和分辨率
4. **元数据管理**: 保留或修改PDF元数据
5. **格式转换质量**: 确保转换后格式正确

## 依赖库

- PyPDF2: PDF基础操作
- pdfplumber: PDF文本提取
- reportlab: PDF生成
- pdf2image: PDF转图片

## 示例用法

```python
# 提取PDF文本
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```
