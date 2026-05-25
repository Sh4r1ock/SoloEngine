/**
 * SoloEngine : Skills API服务模块
 *
 * @file skillsApi.ts
 * @description Skills API服务 - Skills包管理接口封装
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 获取Skills列表
 *     - 安装Skill包
 *     - 卸载Skill包
 *     - 更新Skill包
 *     - 获取Skill详情
 *     - 导入/导出Skills包
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { skillsApi } from './skillsApi'
 *     - const packages = await skillsApi.getPackages()
 *
 * 使用场景：
 *     - Skills包的创建、导入和管理
 *     - Skills包的激活和停用
 *
 * 注意事项：
 *     - Skills包需要正确配置元数据
 *     - 支持导入外部Skills包文件
 */
import { api } from './api';

/**
 * Skills包接口
 */
export interface SkillsPackage {
  id: string;
  user_id?: string;
  name: string;
  version?: string;
  pkg_version?: string;
  description?: string;
  author?: string;
  tags?: string[];
  folder_path?: string;
  is_active: boolean;
  is_public?: boolean;
  is_system?: boolean;
  source?: string;
  lock_version?: number;
  icon?: string;
  created_at: string;
  updated_at: string;
  metadata?: {
    name: string;
    version: string;
    description: string;
    author: string;
    tags: string[];
  };
  skills?: Array<{
    path: string;
    name: string;
    type: string;
    content?: string;
  }>;
}

export interface CreatePackageRequest {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  icon?: string;
}

class SkillsApi {
  async getPackages() {
    return api.get('/skills/packages');
  }

  async getPackage(packageId: string) {
    return api.get(`/skills/packages/${packageId}`);
  }

  async createPackage(data: {
    name: string;
    description?: string;
    author?: string;
    tags?: string[];
    pkg_version?: string;
  }) {
    return api.post('/skills/packages', { ...data, pkg_version: data.pkg_version || '1.0.0' });
  }

  async updatePackage(packageId: string, data: Partial<SkillsPackage>) {
    return api.put(`/skills/packages/${packageId}`, data);
  }

  async deletePackage(packageId: string) {
    return api.delete(`/skills/packages/${packageId}`);
  }

  async activatePackage(packageId: string) {
    return api.post(`/skills/packages/${packageId}/activate`);
  }

  async deactivatePackage(packageId: string) {
    return api.post(`/skills/packages/${packageId}/deactivate`);
  }

  async importPackage(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/skills/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async parseImportPackage(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/skills/import/parse', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async cleanupTempFile(tempId: string) {
    const formData = new FormData();
    formData.append('temp_id', tempId);
    return api.post('/skills/import/cleanup', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async importPackageWithForm(data: {
    tempId: string;
    name: string;
    description: string;
    author: string;
    tags: string[];
  }) {
    const formData = new FormData();
    formData.append('temp_id', data.tempId);
    formData.append('name', data.name);
    formData.append('description', data.description);
    formData.append('author', data.author);
    formData.append('tags', JSON.stringify(data.tags));
    return api.post('/skills/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }

  async searchPackages(query: string, tags?: string[]) {
    return api.post('/skills/search', { query, tags });
  }

  async getSkillContent(packageId: string, skillName: string) {
    return api.get(`/skills/packages/${packageId}/skills/${skillName}`);
  }

  async exportPackage(packageId: string) {
    return api.get(`/skills/packages/${packageId}/export`);
  }

  async getPackageFiles(packageId: string) {
    return api.get(`/skills/packages/${packageId}/files`);
  }

  async getFileContent(packageId: string, filePath: string) {
    return api.get(`/skills/packages/${packageId}/files/content?file_path=${encodeURIComponent(filePath)}`);
  }

  async saveFile(packageId: string, filePath: string, content: string) {
    return api.post(`/skills/packages/${packageId}/files/save`, { file_path: filePath, content });
  }

  async createFileOrFolder(packageId: string, filePath: string, isDirectory: boolean) {
    return api.post(`/skills/packages/${packageId}/files/create`, { file_path: filePath, is_directory: isDirectory });
  }

  async deleteFileOrFolder(packageId: string, filePath: string) {
    return api.post(`/skills/packages/${packageId}/files/delete`, { file_path: filePath });
  }
}

export const skillsApi = new SkillsApi();
