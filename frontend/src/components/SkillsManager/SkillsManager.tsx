import React, { useEffect, useState } from 'react';
import { Typography, Modal, message, Empty, Spin, Input, Tag } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import SkillsPackageList from './SkillsPackageList';
import SkillsCreateModal from './SkillsCreateModal';
import SkillsImportDialog from './SkillsImportDialog';
import PageHeader from '../common/PageHeader';
import { getDefaultIcon } from '../../utils/iconLibrary';

const { Text } = Typography;
const { TextArea } = Input;

const SkillsManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<SkillsPackage[]>([]);
  const [filteredPackages, setFilteredPackages] = useState<SkillsPackage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editInfoModalVisible, setEditInfoModalVisible] = useState(false);
  const [editingPackage, setEditingPackage] = useState<SkillsPackage | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editInputTagValue, setEditInputTagValue] = useState('');

  const loadPackages = async () => {
    setLoading(true);
    try {
      const response = await skillsApi.getPackages();
      if (response.code === 200) {
        const pkgs = response.data || [];
        setPackages(pkgs);
        setFilteredPackages(pkgs.map((pkg: any) => ({
          ...pkg,
          metadata: {
            name: pkg.name,
            version: pkg.version || '1.0.0',
            description: pkg.description || '',
            author: pkg.author || '',
            tags: pkg.tags || [],
            instructions: pkg.instructions || '',
          },
        })));
      }
    } catch (error) {
      message.error('加载 Skills 包列表失败：' + String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (pkg: SkillsPackage) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 Skills 包 "${pkg.name}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await skillsApi.deletePackage(pkg.id);
          message.success('Skills 包已删除');
          loadPackages();
        } catch (error) {
          message.error('删除 Skills 包失败：' + String(error));
        }
      },
    });
  };

  const handleRefresh = () => {
    loadPackages();
  };

  const handleEditInfo = (pkg: SkillsPackage) => {
    setEditingPackage(pkg);
    setEditName(pkg.name || '');
    setEditDescription(pkg.description || '');
    setEditTags(pkg.tags || []);
    setEditInputTagValue('');
    setEditInfoModalVisible(true);
  };

  const handleEditTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditInputTagValue(e.target.value);
  };

  const handleEditTagInputConfirm = () => {
    if (editInputTagValue && !editTags.includes(editInputTagValue)) {
      setEditTags([...editTags, editInputTagValue]);
    }
    setEditInputTagValue('');
  };

  const handleEditTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditTagInputConfirm();
    }
  };

  const handleEditTagRemove = (removedTag: string) => {
    setEditTags(editTags.filter(tag => tag !== removedTag));
  };

  const handleSaveEditInfo = async () => {
    if (!editingPackage || !editName.trim()) {
      message.warning('包名称不能为空');
      return;
    }
    
    try {
      const res = await skillsApi.updatePackage(editingPackage.id, {
        name: editName,
        description: editDescription,
        tags: editTags,
      });
      
      if (res.code === 200) {
        message.success('基本信息已更新');
        setEditInfoModalVisible(false);
        setEditingPackage(null);
        loadPackages();
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || '更新失败';
      message.error(errorMsg);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  const handleViewDetail = (pkg: SkillsPackage) => {
    const url = `/skills-editor/${pkg.id}`;
    window.open(url, '_blank', 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no');
  };

  const allTags = Array.from(new Set(
    packages.flatMap(pkg => [
      ...(pkg.is_system ? ['system'] : []),
      ...(pkg.tags || []),
    ])
  )).sort();

  useEffect(() => {
    let result = packages;

    if (selectedTags.length > 0) {
      result = result.filter(pkg => {
        const pkgTags = [
          ...(pkg.is_system ? ['system'] : []),
          ...(pkg.tags || []),
        ];
        return selectedTags.some(tag => pkgTags.includes(tag));
      });
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(pkg => {
        const matchesName = pkg.name.toLowerCase().includes(query);
        const matchesDesc = pkg.description?.toLowerCase().includes(query);
        const matchesTags = pkg.tags?.some(tag =>
          tag.toLowerCase().includes(query)
        );
        return matchesName || matchesDesc || matchesTags;
      });
    }

    setFilteredPackages(result);
  }, [searchQuery, selectedTags, packages]);

  useEffect(() => {
    loadPackages();
  }, []);

  return (
    <div style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', minHeight: '100vh' }}>
      <PageHeader
        icon={<FolderOpenOutlined />}
        title="Skills 技能包"
        subtitle="管理可复用的AI技能模块"
        searchPlaceholder="搜索 Skills 包..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        selectedTags={selectedTags}
        onTagToggle={handleTagToggle}
        secondaryButtons={[
          {
            text: '导入 Skills',
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            ),
            onClick: () => setImportModalVisible(true),
          },
        ]}
        primaryButton={{
          text: '创建 Skills',
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          ),
          onClick: () => setCreateModalVisible(true),
        }}
        showRefresh={true}
        onRefresh={handleRefresh}
        refreshLoading={loading}
      />

      {loading && packages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : filteredPackages.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              {searchQuery || selectedTags.length > 0 ? '没有找到匹配的 Skills 包' : '暂无 Skills 包'}
              <br />
              {!searchQuery && selectedTags.length === 0 && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  点击上方"创建 Skills"按钮创建您的第一个技能包
                </Text>
              )}
            </span>
          }
        />
      ) : (
        <SkillsPackageList
          packages={filteredPackages}
          onDelete={handleDelete}
          onViewDetail={handleViewDetail}
          onRefresh={handleRefresh}
          onEditInfo={handleEditInfo}
        />
      )}

      <SkillsCreateModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onSave={() => {
          setCreateModalVisible(false);
          loadPackages();
        }}
      />

      <SkillsImportDialog
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        onImport={() => {
          setImportModalVisible(false);
          loadPackages();
        }}
      />

      <Modal
        title="编辑基本信息"
        open={editInfoModalVisible}
        onOk={handleSaveEditInfo}
        onCancel={() => {
          setEditInfoModalVisible(false);
          setEditingPackage(null);
        }}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>包名称:</label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="请输入包名称"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>描述:</label>
          <TextArea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="请输入描述"
            rows={3}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>作者:</label>
          <Input
            value={editingPackage?.author || ''}
            disabled
            placeholder="作者信息"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>作者信息不可修改</Text>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>标签:</label>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              alignItems: 'center',
              padding: '1px 11px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              minHeight: 30,
              backgroundColor: '#fff',
              fontSize: 14,
              transition: 'all 0.2s',
              cursor: 'text',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#4096ff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#d9d9d9';
            }}
            onClick={(e) => {
              const input = e.currentTarget.querySelector('input');
              if (input) {
                input.focus();
              }
            }}
          >
            {editTags.map((tag, index) => (
              <Tag
                key={tag}
                closable
                onClose={(e) => {
                  e.stopPropagation();
                  handleEditTagRemove(tag);
                }}
                color={index < 2 ? 'blue' : 'default'}
                style={{
                  margin: 0,
                  padding: '0 7px',
                  fontSize: 14,
                  lineHeight: '20px',
                  borderRadius: 4,
                }}
              >
                {tag}
              </Tag>
            ))}
            <Input
              type="text"
              style={{
                width: editTags.length === 0 ? 120 : 80,
                border: 'none',
                backgroundColor: 'transparent',
                boxShadow: 'none',
                padding: 0,
                fontSize: 14,
                lineHeight: '20px',
              }}
              placeholder={editTags.length === 0 ? "按回车添加标签" : ""}
              value={editInputTagValue}
              onChange={handleEditTagInputChange}
              onBlur={handleEditTagInputConfirm}
              onKeyDown={handleEditTagInputKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SkillsManager;
