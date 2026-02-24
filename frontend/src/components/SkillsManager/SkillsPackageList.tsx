import React from 'react';
import { Row, Col, message, Popconfirm } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import UnifiedCard from '../common/UnifiedCard';

interface SkillsPackageListProps {
  packages: SkillsPackage[];
  onDelete: (pkg: SkillsPackage) => void;
  onViewDetail: (pkg: SkillsPackage) => void;
  onRefresh?: () => void;
  onEdit?: (pkg: SkillsPackage) => void;
}

const SkillsPackageList: React.FC<SkillsPackageListProps> = ({
  packages,
  onDelete,
  onViewDetail,
  onRefresh,
  onEdit,
}) => {
  const handleToggleActive = async (pkg: SkillsPackage, checked: boolean) => {
    if (pkg.is_default) {
      message.warning('默认 Skills 包无法切换状态');
      return;
    }
    try {
      if (checked) {
        await skillsApi.activatePackage(pkg.id);
        message.success('Skills 包已激活');
      } else {
        await skillsApi.deactivatePackage(pkg.id);
        message.success('Skills 包已停用');
      }
      onRefresh?.();
    } catch (error) {
      message.error('操作失败：' + String(error));
    }
  };

  return (
    <Row gutter={[16, 16]}>
      {packages.map((pkg) => (
        <Col xs={24} sm={12} md={8} lg={6} key={pkg.id}>
          <UnifiedCard
            name={pkg.name}
            description={pkg.description || pkg.metadata?.description}
            icon={<FolderOpenOutlined />}
            tags={pkg.tags || pkg.metadata?.tags || []}
            isActive={pkg.is_active}
            isDefault={pkg.is_default}
            showSwitch={!pkg.is_default}
            onSwitchChange={(checked) => handleToggleActive(pkg, checked)}
            meta1={{ label: '版本', value: `v${pkg.metadata?.version || pkg.pkg_version || '1.0.0'}` }}
            meta2={{ label: '作者', value: pkg.metadata?.author || pkg.author || '未知' }}
            updatedAt={pkg.updated_at}
            onClick={() => !pkg.is_default && (onEdit ? onEdit(pkg) : onViewDetail(pkg))}
            onView={() => onViewDetail(pkg)}
            onDelete={pkg.is_default ? undefined : () => onDelete(pkg)}
            deleteConfirmText="确定要删除此Skills包吗？"
          />
        </Col>
      ))}
    </Row>
  );
};

export default SkillsPackageList;
