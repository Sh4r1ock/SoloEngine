/**
 * @file marketplaceApi.ts
 * @description 开放市场API服务 - MCP和Skills市场接口封装
 * @author SoloEngine Team
 * @date 2026-02-19
 */

import { api } from './api';

export interface MarketItem {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  verified: boolean;
  icon: string;
  version?: string;
  skills_count?: number;
  transport?: string;
  command?: string;
  args?: string[];
  env_required?: string[];
}

export interface MarketCategory {
  id: string;
  name: string;
  icon: string;
}

export interface MarketData {
  items: MarketItem[];
  categories: MarketCategory[];
  total: number;
}

class MarketplaceApi {
  async getMCPMarket(params?: {
    category?: string;
    search?: string;
    sort_by?: string;
  }): Promise<MarketData> {
    const response = await api.get('/marketplace/mcp', { params });
    return response.data;
  }

  async getMCPItem(itemId: string): Promise<MarketItem> {
    const response = await api.get(`/marketplace/mcp/${itemId}`);
    return response.data;
  }

  async getSkillsMarket(params?: {
    category?: string;
    search?: string;
    sort_by?: string;
  }): Promise<MarketData> {
    const response = await api.get('/marketplace/skills', { params });
    return response.data;
  }

  async getSkillsItem(itemId: string): Promise<MarketItem> {
    const response = await api.get(`/marketplace/skills/${itemId}`);
    return response.data;
  }

  async installMCPItem(itemId: string): Promise<{ id: string; name: string; installed: boolean }> {
    const response = await api.post(`/marketplace/mcp/${itemId}/install`);
    return response.data;
  }

  async installSkillsItem(itemId: string): Promise<{ id: string; name: string; installed: boolean }> {
    const response = await api.post(`/marketplace/skills/${itemId}/install`);
    return response.data;
  }

  async getFeaturedItems(): Promise<{ mcp: MarketItem[]; skills: MarketItem[] }> {
    const response = await api.get('/marketplace/featured');
    return response.data;
  }

  async getMarketStats(): Promise<{
    mcp: { total_items: number; total_downloads: number; categories_count: number };
    skills: { total_items: number; total_downloads: number; categories_count: number };
  }> {
    const response = await api.get('/marketplace/stats');
    return response.data;
  }
}

export const marketplaceApi = new MarketplaceApi();
