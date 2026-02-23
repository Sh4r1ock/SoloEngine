/**
 * @file exportApi.ts
 * @description 导出/导入API服务 - 项目导出导入相关接口封装
 * @author SoloEngine Team
 * @date 2026-02-20
 * 
 * 功能描述：
 * - 提供项目导出功能
 * - 提供项目导入功能
 * - 支持多种导出格式
 * 
 * 使用场景：
 * - 项目备份
 * - 项目迁移
 * - 项目分享
 * 
 * 状态: ✅ 完整实现
 */
import { api } from './api';

/**
 * 导出格式
 */
export interface ExportFormat {
  name: string;
  description: string;
  extension: string;
}

/**
 * 导出选项
 */
export interface ExportOptions {
  format?: 'json' | 'zip';
  include_history?: boolean;
  include_skills?: boolean;
  include_mcp_config?: boolean;
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean;
  project_name: string;
  nodes_count: number;
  edges_count: number;
  message: string;
}

/**
 * 导出元数据
 */
export interface ExportMetadata {
  project_name: string;
  version: string;
  exported_at: string;
  exported_by?: string;
  soloengine_version: string;
}

/**
 * 导出/导入API类
 */
class ExportApi {
  /**
   * 导出项目
   */
  async exportProject(
    projectName: string,
    options: ExportOptions = {}
  ): Promise<Blob> {
    const {
      format = 'json',
      include_history = false,
      include_skills = true,
      include_mcp_config = true,
    } = options;

    const response = await api.post(`/export/project/${projectName}`, null, {
      params: {
        format,
        include_history,
        include_skills,
        include_mcp_config,
      },
      responseType: 'blob',
    });

    return response as unknown as Blob;
  }

  /**
   * 导入项目
   */
  async importProject(file: File): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/export/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  }

  /**
   * 获取支持的导出格式
   */
  async getExportFormats(): Promise<ExportFormat[]> {
    const response = await api.get('/export/formats');
    return response.data.formats;
  }

  /**
   * 下载导出的项目
   */
  async downloadExportedProject(
    projectName: string,
    options: ExportOptions = {}
  ): Promise<void> {
    const blob = await this.exportProject(projectName, options);
    const format = options.format || 'json';
    
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName}.${format === 'zip' ? 'zip' : 'json'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  /**
   * 从URL导入项目
   */
  async importProjectFromUrl(url: string, projectName?: string): Promise<ImportResult> {
    const response = await fetch(url);
    const blob = await response.blob();
    
    const filename = projectName || url.split('/').pop() || 'imported_project.json';
    const file = new File([blob], filename, { type: 'application/json' });
    
    return this.importProject(file);
  }
}

export const exportApi = new ExportApi();
