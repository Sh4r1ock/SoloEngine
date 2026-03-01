---
name: pdf_merge
description: 合并多个PDF文件
---

# PDF合并

这个技能用于将多个PDF文件合并为一个。

## 参数

- `file_paths`: PDF文件路径列表
- `output_path`: 输出文件路径

## 示例

```python
from skills.pdf_merge import merge_pdfs

merge_pdfs(["file1.pdf", "file2.pdf"], "merged.pdf")
```
