/**
 * @file SkillsManager.tsx
 * @description Skills管理器主组件 - Skills包管理核心组件
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Button, Space, Modal, message, Empty, Spin, Input } from 'antd';
import {
  PlusOutlined,
  UploadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import SkillsPackageList from './SkillsPackageList';
import SkillsCreateModal from './SkillsCreateModal';
import SkillsPackageDetail from './SkillsPackageDetail';
import SkillsImportDialog from './SkillsImportDialog';

const { Title, Text } = Typography;
const { Search } = Input;

const SkillsManager: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<SkillsPackage[]>([]);
  const [filteredPackages, setFilteredPackages] = useState<SkillsPackage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<SkillsPackage | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

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

  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredPackages(
        packages.filter(pkg => {
          const matchesName = pkg.name.toLowerCase().includes(query);
          const matchesDesc = pkg.description?.toLowerCase().includes(query);
          const matchesTags = pkg.tags?.some(tag =>
            tag.toLowerCase().includes(query)
          );
          return matchesName || matchesDesc || matchesTags;
        })
      );
    } else {
      setFilteredPackages(packages);
    }
  }, [searchQuery, packages]);

  const handleViewDetail = (pkg: SkillsPackage) => {
    setSelectedPackage(pkg);
    setDetailModalVisible(true);
  };

  const handleEdit = (pkg: SkillsPackage) => {
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
            style={{ width: 300 }}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            allowClear
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
          onEdit={handleEdit}
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

      {selectedPackage && (
        <SkillsPackageDetail
          visible={detailModalVisible}
          package={selectedPackage}
          onClose={() => {
            setDetailModalVisible(false);
            setSelectedPackage(null);
          }}
        />
      )}
    </div>
  );
};

export default SkillsManager;
