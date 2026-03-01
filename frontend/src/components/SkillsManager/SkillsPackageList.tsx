import React from 'react';
import { Row, Col, message } from 'antd';
import { FolderOpenOutlined, EditOutlined } from '@ant-design/icons';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import UnifiedCard from '../common/UnifiedCard';

interface SkillsPackageListProps {
  packages: SkillsPackage[];
  onDelete: (pkg: SkillsPackage) => void;
  onViewDetail: (pkg: SkillsPackage) => void;
  onRefresh?: () => void;
  onEditInfo?: (pkg: SkillsPackage) => void;
}

const SkillsPackageList: React.FC<SkillsPackageListProps> = ({
  packages,
  onDelete,
  onViewDetail,
  onRefresh,
  onEditInfo,
}) => {
  const handleToggleActive = async (pkg: SkillsPackage, checked: boolean) => {
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
            showSwitch={true}
            onSwitchChange={(checked) => handleToggleActive(pkg, checked)}
            meta1={{ label: '版本', value: `v${pkg.metadata?.version || pkg.pkg_version || '1.0.0'}` }}
            meta2={{ label: '作者', value: pkg.metadata?.author || pkg.author || '未知' }}
            updatedAt={pkg.updated_at}
            onClick={() => onViewDetail(pkg)}
            onView={() => onViewDetail(pkg)}
            onEdit={() => onEditInfo?.(pkg)}
            onDelete={() => onDelete(pkg)}
            deleteConfirmText="确定要删除此Skills包吗？"
          />
        </Col>
      ))}
    </Row>
  );
};

export default SkillsPackageList;
