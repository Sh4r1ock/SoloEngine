/**
 * @file skillsApi.ts
 * @description Skills API服务 - Skills包管理接口封装
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 提供Skills包管理相关的接口调用
 * - 获取Skills列表、安装/卸载/更新Skill、获取Skill详情
 * 
 * 使用场景：
 * - Skills包的创建、导入和管理
 * - Skills包的激活和停用
 * 
 * 注意事项：
 * - Skills包需要正确配置元数据
 * - 支持导入外部Skills包文件
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
  instructions?: string;
  folder_path?: string;
  is_active: boolean;
  is_public?: boolean;
  is_default?: boolean;
  source?: string;
  lock_version?: number;
  created_at: string;
  updated_at: string;
  metadata?: {
    name: string;
    version: string;
    description: string;
    author: string;
    tags: string[];
    instructions: string;
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

  async searchPackages(query: string, tags?: string[]) {
    return api.post('/skills/search', { query, tags });
  }

  async getSkillContent(packageId: string, skillName: string) {
    return api.get(`/skills/packages/${packageId}/skills/${skillName}`);
  }

  async generatePrompt(packageId: string, context?: Record<string, any>) {
    return api.post('/skills/prompt', { package_id: packageId, context });
  }

  async exportPackage(packageId: string) {
    return api.get(`/skills/packages/${packageId}/export`);
  }

  async initDefaultSkills() {
    return api.post('/skills/init-defaults');
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
