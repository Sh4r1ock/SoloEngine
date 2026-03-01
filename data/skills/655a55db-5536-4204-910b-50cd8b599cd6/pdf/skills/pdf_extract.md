---
name: pdf_extract
description: 从PDF中提取文本内容
---

# PDF文本提取

这个技能用于从PDF文件中提取文本内容。

## 参数

- `file_path`: PDF文件路径
- `pages`: 要提取的页码列表（可选，默认全部）

## 示例

```python
from skills.pdf_extract import extract_text

text = extract_text("document.pdf", pages=[1, 2, 3])
```
