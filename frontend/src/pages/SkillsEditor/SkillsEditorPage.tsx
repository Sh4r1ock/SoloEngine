/**
 * @file SkillsEditorPage.tsx
 * @description Skills编辑页面 - 左资源管理器，右侧文档编辑
 * @author SoloEngine Team
 * @date 2026-02-23
 */
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Layout, Tree, Input, Button, message, Modal, Empty, Typography, Popconfirm, Spin } from 'antd';
import {
  FileOutlined,
  FolderOutlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  FolderAddOutlined,
  FileAddOutlined,
} from '@ant-design/icons';
import { skillsApi } from '../../services/skillsApi';

const { Sider, Content } = Layout;
const { TextArea } = Input;
const { Title, Text } = Typography;

interface FileNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  children?: FileNode[];
  content?: string;
  description?: string;
}

const FILE_TEMPLATES: Record<string, { content: string; description: string }> = {
  'SKILL.md': {
    content: `---
name: skill-name
version: 1.0.0
description: 在此描述这个Skills包的功能和用途
author: 作者名称
tags:
  - tag1
  - tag2
---

# Skills 包说明

## 概述
简要描述这个Skills包的功能和用途。

## 使用场景
- 场景1：描述
- 场景2：描述

## 最佳实践
1. 实践建议1
2. 实践建议2

## 示例
提供一些使用示例...
`,
    description: 'Skills包的核心说明文件，定义技能的元数据、描述和使用指南',
  },
  'skills/': {
    content: `# Skills 脚本目录

此目录用于存放技能的具体实现脚本。

## 建议的文件结构
- \`main.py\`: 主入口脚本
- \`utils.py\`: 工具函数
- \`helpers.py\`: 辅助函数
`,
    description: '存放技能实现脚本的目录',
  },
  'templates/': {
    content: `# 模板文件目录

此目录用于存放模板文件，`,
    description: '存放模板文件的目录',
  },
  'resources/': {
    content: `# 资源文件目录

此目录用于存放资源文件（如配置文件、数据文件等）
`,
    description: '存放资源文件的目录',
  },
};

const SkillsEditorPage: React.FC = () => {
  const { packageId } = useParams<{ packageId: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packageInfo, setPackageInfo] = useState<any>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [newItemModalVisible, setNewItemModalVisible] = useState(false);
  const [newItemType, setNewItemType] = useState<'file' | 'folder'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const loadPackageInfo = async () => {
    if (!packageId) return;
    setLoading(true);
    try {
      const response = await skillsApi.getPackage(packageId);
      if (response.code === 200) {
        setPackageInfo(response.data);
        initDefaultFileTree();
      }
    } catch (error) {
      message.error('加载Skills包信息失败');
    } finally {
      setLoading(false);
    }
  };

  const initDefaultFileTree = () => {
    const defaultTree: FileNode[] = [
      {
        key: 'SKILL.md',
        title: 'SKILL.md',
        isLeaf: true,
        content: FILE_TEMPLATES['SKILL.md'].content,
        description: FILE_TEMPLATES['SKILL.md'].description,
      },
      {
        key: 'skills',
        title: 'skills/',
        isLeaf: false,
        children: [
          { key: 'skills/main.py', title: 'main.py', isLeaf: true, content: '# 主入口脚本\n\n# 在此编写主要的技能逻辑', description: '主入口脚本' },
          { key: 'skills/utils.py', title: 'utils.py', isLeaf: true, content: '# 工具函数\n\n# 在此编写工具函数', description: '工具函数' },
        ],
        description: FILE_TEMPLATES['skills/'].description,
      },
      {
        key: 'templates',
        title: 'templates/',
        isLeaf: false,
        children: [],
        description: FILE_TEMPLATES['templates/'].description,
      },
      {
        key: 'resources',
        title: 'resources/',
        isLeaf: false,
        children: [],
        description: FILE_TEMPLATES['resources/'].description,
      },
    ];
    setFileTree(defaultTree);
  };

  const handleFileSelect = (selectedKeys: React.Key[]) => {
    if (selectedKeys.length > 0) {
      const key = selectedKeys[0] as string;
      setSelectedFile(key);
      const node = findNodeByKey(fileTree, key);
      if (node && node.isLeaf) {
        setFileContent(node.content || '');
      } else {
        setFileContent('');
      }
      setHasUnsavedChanges(false);
    }
  };

  const findNodeByKey = (nodes: FileNode[], key: string): FileNode | null => {
    for (const node of nodes) {
      if (node.key === key) return node;
      if (node.children) {
        const found = findNodeByKey(node.children, key);
        if (found) return found;
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!selectedFile) {
      message.warning('请先选择一个文件');
      return;
    }
    setSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      message.success('文件已保存');
      setHasUnsavedChanges(false);
    } catch (error) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateItem = () => {
    if (!newItemName.trim()) {
      message.warning('请输入名称');
      return;
    }
    message.success(`${newItemType === 'folder' ? '文件夹' : '文件'} "${newItemName}" 已创建`);
    setNewItemModalVisible(false);
    setNewItemName('');
  };

  const handleDeleteItem = () => {
    if (!selectedFile) {
      message.warning('请先选择要删除的项目');
      return;
    }
    const isSkillMd = selectedFile === 'SKILL.md';
    
    Modal.confirm({
      title: isSkillMd ? '删除核心文件' : '删除项目',
      content: isSkillMd 
        ? 'SKILL.md 是Skills包的核心文件，删除后可能影响Skills包的功能。确定要删除吗？'
        : '确定要删除此项目吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        message.success('已删除');
        setSelectedFile(null);
        setFileContent('');
      },
    });
  };

  const handleContentChange = (newContent: string) => {
    setFileContent(newContent);
    setHasUnsavedChanges(true);
  };

  useEffect(() => {
    loadPackageInfo();
  }, [packageId]);

  const renderTreeNodes = (nodes: FileNode[]): any[] => {
    return nodes.map(node => ({
      key: node.key,
      title: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {node.isLeaf ? (
            node.key.endsWith('.md') ? <FileMarkdownOutlined style={{ color: '#1890ff' }} /> : <FileTextOutlined />
          ) : (
            <FolderOutlined style={{ color: '#faad14' }} />
          )}
          <span>{node.title}</span>
        </span>
      ),
      isLeaf: node.isLeaf,
      children: node.children ? renderTreeNodes(node.children) : undefined,
    }));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ height: '100vh', background: '#fff' }}>
      <div style={{
        height: 48,
        borderBottom: '1px solid var(--border-color-light)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        background: 'var(--bg-100)',
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => window.close()}
        >
          关闭窗口
        </Button>
        <div style={{ flex: 1 }}>
          <Title level={5} style={{ margin: 0 }}>
            {packageInfo?.name || 'Skills 编辑器'}
          </Title>
        </div>
        <Button
          icon={<SaveOutlined />}
          type="primary"
          onClick={handleSave}
          loading={saving}
          disabled={!selectedFile || !hasUnsavedChanges}
        >
          {hasUnsavedChanges ? '保存' : '已保存'}
        </Button>
      </div>
      
      <Layout>
        <Sider
          width={260}
          style={{
            background: 'var(--bg-200)',
            borderRight: '1px solid var(--border-color-light)',
          }}
        >
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color-light)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13 }}>资源管理器</Text>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  size="small"
                  type="text"
                  icon={<FileAddOutlined />}
                  onClick={() => { setNewItemType('file'); setNewItemModalVisible(true); }}
                  title="新建文件"
                />
                <Button
                  size="small"
                  type="text"
                  icon={<FolderAddOutlined />}
                  onClick={() => { setNewItemType('folder'); setNewItemModalVisible(true); }}
                  title="新建文件夹"
                />
              </div>
            </div>
          </div>
          
          <div style={{ padding: '8px' }}>
            <Tree
              showLine
              selectedKeys={selectedFile ? [selectedFile] : []}
              onSelect={handleFileSelect}
              treeData={renderTreeNodes(fileTree)}
              style={{ background: 'transparent', fontSize: 13 }}
            />
          </div>
          
          {selectedFile && (
            <div style={{ padding: '8px', borderTop: '1px solid var(--border-color-light)' }}>
              <Popconfirm
                title={
                  selectedFile === 'SKILL.md' 
                    ? 'SKILL.md 是核心文件，不建议删除'
                    : '确定要删除此项目吗？'
                }
                onConfirm={handleDeleteItem}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  block
                >
                  删除选中项
                </Button>
              </Popconfirm>
            </div>
          )}
        </Sider>
        
        <Content style={{ display: 'flex', flexDirection: 'column' }}>
          {selectedFile ? (
            <>
              <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-color-light)',
                background: 'var(--bg-200)',
              }}>
                <Text style={{ fontSize: 13 }}>
                  <FileOutlined style={{ marginRight: 8 }} />
                  {selectedFile}
                </Text>
              </div>
              {selectedFile === 'SKILL.md' || selectedFile.endsWith('.md') ? (
                <TextArea
                  value={fileContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 0,
                    fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
                    fontSize: 14,
                    lineHeight: 1.6,
                    padding: 16,
                    resize: 'none',
                    backgroundColor: '#fff',
                    color: '#333',
                  }}
                  placeholder="在此输入Markdown内容..."
                />
              ) : (
                <TextArea
                  value={fileContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 0,
                    fontFamily: '"Fira Code", "JetBrains Mono", "Consolas", monospace',
                    fontSize: 14,
                    lineHeight: 1.6,
                    padding: 16,
                    resize: 'none',
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                  }}
                  placeholder="在此输入代码..."
                />
              )}
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              color: 'var(--text-200)',
            }}>
              <FileMarkdownOutlined style={{ fontSize: 64, marginBottom: 16, color: 'var(--bg-300)' }} />
              <Text type="secondary">从左侧选择文件开始编辑</Text>
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                点击文件可以查看和编辑内容
              </Text>
            </div>
          )}
        </Content>
      </Layout>

      <Modal
        title={newItemType === 'folder' ? '新建文件夹' : '新建文件'}
        open={newItemModalVisible}
        onOk={handleCreateItem}
        onCancel={() => {
          setNewItemModalVisible(false);
          setNewItemName('');
        }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder={newItemType === 'folder' ? '文件夹名称' : '文件名称（如：example.py）'}
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onPressEnter={handleCreateItem}
          autoFocus
        />
      </Modal>
    </Layout>
  );
};

export default SkillsEditorPage;
