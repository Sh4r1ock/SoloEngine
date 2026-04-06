import React from 'react';
import { message } from 'antd';
import { skillsApi, SkillsPackage } from '../../services/skillsApi';
import UnifiedCard from '../common/UnifiedCard';
import { getDefaultIcon } from '../../utils/iconLibrary';

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

  const handleIconChange = async (pkg: SkillsPackage, icon: string) => {
    try {
      await skillsApi.updatePackage(pkg.id, { icon });
      message.success('图标已更新');
      onRefresh?.();
    } catch (error) {
      message.error('更新图标失败');
    }
  };

  return (
    <div
      className="cards-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '12px',
      }}
    >
      {packages.map((pkg) => (
        <UnifiedCard
          key={pkg.id}
          id={pkg.id}
          name={pkg.name}
          description={pkg.description || pkg.metadata?.description}
          icon={pkg.icon || getDefaultIcon('skills')}
          tags={pkg.tags || pkg.metadata?.tags || []}
          isActive={pkg.is_active}
          isSystem={pkg.is_system}
          showSwitch={true}
          onSwitchChange={(checked: boolean) => handleToggleActive(pkg, checked)}
          onIconChange={(icon: string) => handleIconChange(pkg, icon)}
          meta1={{ label: '版本', value: `v${pkg.metadata?.version || pkg.pkg_version || '1.0.0'}` }}
          meta2={{ label: '作者', value: pkg.metadata?.author || pkg.author || '未知' }}
          updatedAt={pkg.updated_at}
          onClick={() => onViewDetail(pkg)}
          onView={() => onViewDetail(pkg)}
          onEdit={() => onEditInfo?.(pkg)}
          onDelete={() => onDelete(pkg)}
          deleteConfirmText="确定要删除此Skills包吗？"
        />
      ))}
    </div>
  );
};

export default SkillsPackageList;
