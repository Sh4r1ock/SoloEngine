import React from 'react';
import { Layout, Typography, Card } from 'antd';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import BeautifulMarkdownRenderer from './BeautifulMarkdownRenderer';

const { Title, Text } = Typography;

const FileDisplayDemo: React.FC = () => {
  const demoPythonCode = `# 这是一个Python示例文件
def greet(name):
    """问候函数"""
    print(f"Hello, {name}!")
    
    return f"欢迎, {name}"

# 主程序
if __name__ == "__main__":
    names = ["Alice", "Bob", "Charlie"]
    for name in names:
        greet(name)
`;

  const demoMarkdown = `# Markdown 演示文档

## 二级标题

这是一段普通文本。

### 代码示例

\`\`\`python
print("Hello World")
\`\`\`

### 列表

- 项目一
- 项目二
- 项目三

### 表格

| 名称 | 年龄 | 城市 |
|------|------|------|
| 张三 | 25 | 北京 |
| 李四 | 30 | 上海 |
`;

  const demoJSON = `{
  "name": "SoloEngine",
  "version": "1.0.0",
  "description": "AI驱动的开发引擎",
  "features": [
    "代码生成",
    "自动修复",
    "智能调试"
  ],
  "config": {
    "port": 8990,
    "debug": true
  }
}
`;

  const demoJavaScript = `// JavaScript/TypeScript 示例
import React, { useState } from 'react';

const Counter = () => {
  const [count, setCount] = useState(0);
  
  const increment = () => {
    setCount(prev => prev + 1);
  };
  
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={increment}>点击</button>
    </div>
  );
};

export default Counter;
`;

  const demoHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>示例页面</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f0f0f0;
        }
        .container {
            padding: 20px;
            background: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>欢迎使用 SoloEngine</h1>
        <p>这是一个HTML示例文件。</p>
    </div>
</body>
</html>
`;

  const demoCSS = `/* CSS 样式示例 */
:root {
  --primary-color: #3b82f6;
  --secondary-color: #6366f1;
  --bg-dark: #1e1e1e;
  --text-light: #ffffff;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', sans-serif;
  background: var(--bg-dark);
  color: var(--text-light);
}

.button {
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: transform 0.2s;
}

.button:hover {
  transform: translateY(-2px);
}
`;

  return (
    <Layout style={{ minHeight: '100vh', background: '#0f172a', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <Title level={2} style={{ color: '#fff', marginBottom: '24px' }}>
          📄 文件类型展示演示
        </Title>
        
        <div style={{ display: 'grid', gap: '24px' }}>
          
          <Card 
            title=".py 文件：Python 语法高亮显示" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ 
              background: 'var(--bg-200, #1e1e1e)',
              borderRadius: 8,
              padding: 16,
              border: '1px solid #334155',
              overflow: 'auto'
            }}>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language="python"
                PreTag="div"
                customStyle={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: 'transparent'
                }}
              >
                {demoPythonCode}
              </SyntaxHighlighter>
            </div>
          </Card>
          
          <Card 
            title=".md 文件：美观的 Markdown 渲染" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ 
              background: 'var(--bg-200, #1e1e1e)',
              borderRadius: 8,
              padding: 16,
              border: '1px solid #334155',
              overflow: 'auto'
            }}>
              <BeautifulMarkdownRenderer>
                {demoMarkdown}
              </BeautifulMarkdownRenderer>
            </div>
          </Card>
          
          <Card 
            title=".json 文件：JSON 语法高亮" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ 
              background: 'var(--bg-200, #1e1e1e)',
              borderRadius: 8,
              padding: 16,
              border: '1px solid #334155',
              overflow: 'auto'
            }}>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language="json"
                PreTag="div"
                customStyle={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: 'transparent'
                }}
              >
                {demoJSON}
              </SyntaxHighlighter>
            </div>
          </Card>
          
          <Card 
            title=".js/.jsx/.ts/.tsx：对应语法高亮" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ 
              background: 'var(--bg-200, #1e1e1e)',
              borderRadius: 8,
              padding: 16,
              border: '1px solid #334155',
              overflow: 'auto'
            }}>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language="typescript"
                PreTag="div"
                customStyle={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: 'transparent'
                }}
              >
                {demoJavaScript}
              </SyntaxHighlighter>
            </div>
          </Card>
          
          <Card 
            title=".html/.css：对应语法高亮" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <Text style={{ color: '#94a3b8', display: 'block', marginBottom: '8px' }}>HTML:</Text>
                <div style={{ 
                  background: 'var(--bg-200, #1e1e1e)',
                  borderRadius: 8,
                  padding: 16,
                  border: '1px solid #334155',
                  overflow: 'auto'
                }}>
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language="html"
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.5,
                      background: 'transparent'
                    }}
                  >
                    {demoHTML}
                  </SyntaxHighlighter>
                </div>
              </div>
              <div>
                <Text style={{ color: '#94a3b8', display: 'block', marginBottom: '8px' }}>CSS:</Text>
                <div style={{ 
                  background: 'var(--bg-200, #1e1e1e)',
                  borderRadius: 8,
                  padding: 16,
                  border: '1px solid #334155',
                  overflow: 'auto'
                }}>
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language="css"
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.5,
                      background: 'transparent'
                    }}
                  >
                    {demoCSS}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          </Card>
          
          <Card 
            title="Office/PDF/图片：显示文件类型提示" 
            style={{ background: '#1e293b', border: '1px solid #334155' }}
            headStyle={{ color: '#fff', borderBottom: '1px solid #334155' }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ 
                background: 'var(--bg-200, #1e1e1e)',
                borderRadius: 8,
                padding: 24,
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}>
                <div style={{ fontSize: 48 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>document.docx</div>
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  文件类型: .docx<br/>
                  此文件类型需要专门的查看器
                </div>
              </div>
              
              <div style={{ 
                background: 'var(--bg-200, #1e1e1e)',
                borderRadius: 8,
                padding: 24,
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}>
                <div style={{ fontSize: 48 }}>📑</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>report.pdf</div>
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  文件类型: .pdf<br/>
                  此文件类型需要专门的查看器
                </div>
              </div>
              
              <div style={{ 
                background: 'var(--bg-200, #1e1e1e)',
                borderRadius: 8,
                padding: 24,
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}>
                <div style={{ fontSize: 48 }}>🖼️</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>screenshot.png</div>
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  文件类型: .png<br/>
                  此文件类型需要专门的查看器
                </div>
              </div>
              
              <div style={{ 
                background: 'var(--bg-200, #1e1e1e)',
                borderRadius: 8,
                padding: 24,
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12
              }}>
                <div style={{ fontSize: 48 }}>📊</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>data.xlsx</div>
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  文件类型: .xlsx<br/>
                  此文件类型需要专门的查看器
                </div>
              </div>
            </div>
          </Card>
          
        </div>
      </div>
    </Layout>
  );
};

export default FileDisplayDemo;
