/**
 * @file useListPage.ts
 * @description F5：列表页骨架唯一实现（搜索 + 标签过滤 + 标签集合）
 * - filterByQueryAndTags：通用搜索/标签过滤（MCPManager / SkillsManager / AgenticFlowList 共用）
 * - useListPage：列表页通用状态（searchQuery / selectedTags / allTags / filteredItems）
 */
import { useState } from 'react';

export interface ListPageItem {
  name: string;
  description?: string | null;
  tags?: string[];
}

export function filterByQueryAndTags<T extends ListPageItem>(
  items: T[],
  searchQuery: string,
  selectedTags: string[],
  getTags: (item: T) => string[],
): T[] {
  let result = items;

  if (selectedTags.length > 0) {
    result = result.filter(item => {
      const itemTags = getTags(item);
      return selectedTags.some(tag => itemTags.includes(tag));
    });
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    result = result.filter(item => {
      const matchesName = item.name.toLowerCase().includes(query);
      const matchesDesc = item.description?.toLowerCase().includes(query);
      const matchesTags = item.tags?.some(tag => tag.toLowerCase().includes(query));
      return matchesName || matchesDesc || matchesTags;
    });
  }

  return result;
}

export function useListPage<T extends ListPageItem>(
  items: T[],
  getTags: (item: T) => string[],
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      }
      return [...prev, tag];
    });
  };

  const allTags = Array.from(new Set(items.flatMap(getTags))).sort();
  const filteredItems = filterByQueryAndTags(items, searchQuery, selectedTags, getTags);

  return { searchQuery, setSearchQuery, selectedTags, handleTagToggle, allTags, filteredItems };
}
