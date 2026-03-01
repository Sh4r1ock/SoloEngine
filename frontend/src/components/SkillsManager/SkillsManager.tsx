/**
 * @file SkillsManager.tsx
 * @description Skills管理器主组件 - Skills包管理核心组件
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Button, Space, Modal, message, Empty, Spin, Input, Select } from 'antd';
import {
  PlusOutlined,
  UploadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import SkillsPackageList from './SkillsPackageList';
import SkillsCreateModal from './SkillsCreateModal';
import SkillsImportDialog from './SkillsImportDialog';

const { Title, Text } = Typography;
const { Search } = Input;
const { TextArea } = Input;

const SkillsManager: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<SkillsPackage[]>([]);
  const [filteredPackages, setFilteredPackages] = useState<SkillsPackage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editInfoModalVisible, setEditInfoModalVisible] = useState(false);
  const [editingPackage, setEditingPackage] = useState<SkillsPackage | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);

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
    setEditInfoModalVisible(true);
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

  useEffect(() => {
    let result = packages;

    if (statusFilter !== 'all') {
      result = result.filter(pkg =>
        statusFilter === 'active' ? pkg.is_active : !pkg.is_active
      );
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
  }, [searchQuery, statusFilter, packages]);

  const handleViewDetail = (pkg: SkillsPackage) => {
    const url = `/skills-editor/${pkg.id}`;
    window.open(url, '_blank', 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no');
  };

  useEffect(() => {
    loadPackages();
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Skills 技能包</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理可复用的技能模块
          </Text>
        </div>
        <Space>
          <Search
            placeholder="搜索 Skills 包..."
            style={{ width: 250 }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '已启用', value: 'active' },
              { label: '已停用', value: 'inactive' },
            ]}
          />
          <Button
            icon={<UploadOutlined />}
            onClick={() => setImportModalVisible(true)}
          >
            导入 Skills
          </Button>
          <Button
            icon={<PlusOutlined />}
            type="primary"
            onClick={() => setCreateModalVisible(true)}
          >
            创建 Skills
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {loading && packages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <Spin size="large" />
        </div>
      ) : filteredPackages.length === 0 ? (
        <Empty
          style={{ padding: '60px 20px' }}
          description={
            <span>
              {searchQuery ? '没有找到匹配的 Skills 包' : '暂无 Skills 包'}
              <br />
              {!searchQuery && (
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
          <Input
            value={editTags.join(', ')}
            onChange={(e) => setEditTags(e.target.value.split(',').map(t => t.trim()).filter(t => t))}
            placeholder="输入标签，用逗号分隔"
          />
        </div>
      </Modal>
    </div>
  );
};

export default SkillsManager;
