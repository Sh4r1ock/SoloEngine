/**
 * SoloEngine : 打包API服务模块
 *
 * @file packageApi.ts
 * @description 打包API服务 - 项目打包相关接口封装
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 项目打包功能
 *     - 包管理功能
 *     - 包下载
 *     - 部署准备
 *     - 包配置管理
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { packageApi } from './packageApi'
 *     - const result = await packageApi.createPackage(projectId, config)
 *
 * 使用场景：
 *     - 项目打包发布
 *     - 包管理
 *     - 部署准备
 */
import { api } from './api';

/**
 * 包配置
 */
export interface PackageConfig {
  project_name: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  entry_point?: string;
  runtime?: string;
  dependencies?: string[];
  environment_vars?: Record<string, string>;
}

/**
 * 包信息
 */
export interface PackageInfo {
  name: string;
  path: string;
  size_bytes: number;
  created_at: string;
  files_count?: number;
  files?: string[];
}

/**
 * 打包结果
 */
export interface PackageResult {
  success: boolean;
  name: string;
  path: string;
  size_bytes: number;
  files_count: number;
  message: string;
}

/**
 * 打包API类
 */
class PackageApi {
  /**
   * 创建包
   */
  async createPackage(config: PackageConfig): Promise<PackageResult> {
    const response = await api.post('/package/create', config);
    return response.data;
  }

  /**
   * 列出所有包
   */
  async listPackages(): Promise<PackageInfo[]> {
    const response = await api.get('/package/list');
    return response.data;
  }

  /**
   * 获取包信息
   */
  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const response = await api.get(`/package/${packageName}`);
    return response.data;
  }

  /**
   * 下载包
   */
  async downloadPackage(packageName: string): Promise<Blob> {
    const response = await api.get(`/package/${packageName}/download`, {
      responseType: 'blob',
    });
    return response as unknown as Blob;
  }

  /**
   * 删除包
   */
  async deletePackage(packageName: string): Promise<void> {
    await api.delete(`/package/${packageName}`);
  }

  /**
   * 下载并保存包
   */
  async downloadAndSavePackage(packageName: string): Promise<void> {
    const blob = await this.downloadPackage(packageName);
    
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${packageName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  /**
   * 获取包大小（格式化）
   */
  formatPackageSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }
}

export const packageApi = new PackageApi();
