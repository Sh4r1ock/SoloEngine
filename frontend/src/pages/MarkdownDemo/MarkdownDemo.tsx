import React, { useState } from 'react';
import { Layout, Typography, Switch, Card, Space, Divider, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import BeautifulMarkdownRenderer from '../../components/common/BeautifulMarkdownRenderer';

const { Title, Text } = Typography;
const { Content } = Layout;

const sampleMarkdown = `# ChatGPT 风格 Markdown 渲染 Demo

这是一个美观的 Markdown 渲染示例，展示了各种常见的 Markdown 元素。

## 标题层级

### 三级标题
#### 四级标题

## 文本样式

这是**粗体文本**，这是*斜体文本*，这是***粗斜体文本***，这是~~删除线文本~~。

## 列表

### 无序列表
- 项目 1
- 项目 2
  - 子项目 2.1
  - 子项目 2.2
- 项目 3

### 有序列表
1. 第一项
2. 第二项
   1. 子项 2.1
   2. 子项 2.2
3. 第三项

## 代码

### 行内代码
你可以使用 \`react-markdown\` 来渲染 Markdown。

### 代码块

\`\`\`javascript
// JavaScript 示例
function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return {
    message: \`Welcome, \${name}\`,
    timestamp: Date.now()
  };
}

// 调用函数
const result = greet('World');
console.log(result);
\`\`\`

\`\`\`python
# Python 示例
def greet(name):
    print(f"Hello, {name}!")
    return {
        "message": f"Welcome, {name}",
        "timestamp": __import__("time").time()
    }

# 调用函数
result = greet("World")
print(result)
\`\`\`

\`\`\`typescript
// TypeScript 示例
interface Greeting {
  message: string;
  timestamp: number;
}

function greet(name: string): Greeting {
  console.log(\`Hello, \${name}!\`);
  return {
    message: \`Welcome, \${name}\`,
    timestamp: Date.now()
  };
}

const result: Greeting = greet('World');
console.log(result);
\`\`\`

## 表格

| 功能 | 描述 | 状态 |
|------|------|------|
| Markdown 渲染 | 支持 GitHub 风格 Markdown | ✅ 完成 |
| 语法高亮 | 使用 Prism.js 高亮代码 | ✅ 完成 |
| 代码复制 | 一键复制代码到剪贴板 | ✅ 完成 |
| 暗色模式 | 支持亮色/暗色切换 | ✅ 完成 |
| 响应式设计 | 适配各种屏幕尺寸 | ✅ 完成 |

## 引用

> "代码是写给人看的，附带能在机器上运行。"
> 
> —— Harold Abelson

## 链接

访问 [GitHub](https://github.com) 查看更多项目，或查看 [React 文档](https://react.dev/)。

## 分隔线

---

## 任务列表

- [x] 完成项目分析
- [x] 安装依赖
- [x] 创建组件
- [ ] 测试功能
- [ ] 部署上线

## 数学公式（示例）

使用 LaTeX 语法可以编写数学公式：

$$
E = mc^2
$$

$$
\\frac{\\partial f}{\\partial x} = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}
$$

---

这就是一个完整的 Markdown 渲染示例！希望你喜欢这个美观的界面。
`;

const MarkdownDemo: React.FC = () => {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(false);

  return (
    <Layout style={{ 
      minHeight: '100vh',
      backgroundColor: darkMode ? '#111827' : '#f9fafb'
    }}>
      <Content style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center' 
          }}>
            <Button 
              icon={<ArrowLeftOutlined />} 
              onClick={() => navigate('/')}
            >
              返回首页
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Text style={{ color: darkMode ? '#e5e7eb' : '#374151' }}>
                暗色模式
              </Text>
              <Switch checked={darkMode} onChange={setDarkMode} />
            </div>
          </div>

          <Card 
            style={{ 
              backgroundColor: darkMode ? '#1f2937' : '#ffffff',
              borderColor: darkMode ? '#374151' : '#e5e7eb'
            }}
          >
            <Title level={2} style={{ 
              textAlign: 'center',
              color: darkMode ? '#f9fafb' : '#111827',
              marginBottom: '8px'
            }}>
              🎨 ChatGPT 风格 Markdown 渲染
            </Title>
            <Text style={{ 
              textAlign: 'center', 
              display: 'block',
              color: darkMode ? '#9ca3af' : '#6b7280'
            }}>
              美观、现代的 Markdown 渲染器，带有代码高亮和复制功能
            </Text>
          </Card>

          <Divider style={{ borderColor: darkMode ? '#374151' : '#e5e7eb' }} />

          <Card 
            style={{ 
              backgroundColor: darkMode ? '#1f2937' : '#ffffff',
              borderColor: darkMode ? '#374151' : '#e5e7eb'
            }}
            styles={{ body: { padding: '24px' } }}
          >
            <BeautifulMarkdownRenderer>
              {sampleMarkdown}
            </BeautifulMarkdownRenderer>
          </Card>

          <Card 
            style={{ 
              backgroundColor: darkMode ? '#1f2937' : '#ffffff',
              borderColor: darkMode ? '#374151' : '#e5e7eb'
            }}
          >
            <Title level={4} style={{ color: darkMode ? '#f9fafb' : '#111827' }}>
              特性说明
            </Title>
            <ul style={{ 
              color: darkMode ? '#d1d5db' : '#4b5563',
              paddingLeft: '20px',
              margin: 0
            }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>GitHub 风格 Markdown：</strong>支持表格、任务列表、删除线等 GFM 语法
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>语法高亮：</strong>使用 Prism.js 提供专业的代码高亮
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>一键复制：</strong>代码块带有复制按钮，方便复制代码
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>暗色模式：</strong>支持亮色/暗色主题切换
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>美观设计：</strong>现代化的 UI 设计，类似 ChatGPT 的体验
              </li>
              <li>
                <strong>响应式布局：</strong>完美适配各种屏幕尺寸
              </li>
            </ul>
          </Card>
        </Space>
      </Content>
    </Layout>
  );
};

export default MarkdownDemo;
