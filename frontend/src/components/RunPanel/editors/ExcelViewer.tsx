import React, { useEffect, useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Table, Tabs, Spin, Empty, Button } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FileTab } from '../types';
import { useEditorInstanceManager, useEditorCleanup } from './index';

interface ExcelViewerProps {
  instanceId: string;
  tab: FileTab;
}

const ExcelViewer: React.FC<ExcelViewerProps> = ({ instanceId, tab }) => {
  const { addDataRef, removeDataRef, cleanup } = useEditorInstanceManager(instanceId);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parseContent = useCallback((content: string): ArrayBuffer | null => {
    if (!content) return null;

    try {
      if (content.startsWith('data:')) {
        const base64 = content.split(',')[1];
        if (!base64) return null;
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }
      
      if (/^[A-Za-z0-9+/=]+$/.test(content)) {
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }
      
      const encoder = new TextEncoder();
      return encoder.encode(content).buffer;
    } catch (err) {
      console.error('Failed to parse Excel content:', err);
      return null;
    }
  }, []);

  const loadWorkbook = useCallback(async (content: string) => {
    setLoading(true);
    setError(null);
    
    if (!content) {
      setError('文件内容为空');
      setLoading(false);
      return;
    }
    
    try {
      const arrayBuffer = parseContent(content);
      
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        setError('无法解析文件内容');
        setLoading(false);
        return;
      }
      
      addDataRef(arrayBuffer);
      
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      
      removeDataRef(arrayBuffer);
      
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setError('Excel文件中没有工作表');
        setLoading(false);
        return;
      }
      
      setWorkbook(wb);
      setActiveSheet(wb.SheetNames[0]);
      setLoading(false);
    } catch (err: any) {
      console.error('Excel parse error:', err);
      setError(err.message || 'Excel解析失败');
      setLoading(false);
    }
  }, [addDataRef, removeDataRef, parseContent]);

  useEffect(() => {
    if (tab.content) {
      loadWorkbook(tab.content);
    } else {
      setLoading(false);
      setError('无文件内容');
    }
  }, [tab.content, loadWorkbook]);

  const { columns, data } = useMemo(() => {
    if (!workbook || !activeSheet) return { columns: [], data: [] };
    
    const sheet = workbook.Sheets[activeSheet];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
    
    if (jsonData.length === 0) return { columns: [], data: [] };
    
    const headers = jsonData[0];
    const cols: ColumnsType<any> = headers.map((h: any, i: number) => ({
      title: h?.toString() || `列${i + 1}`,
      dataIndex: `col_${i}`,
      key: `col_${i}`,
      ellipsis: true,
      width: 150,
    }));
    
    const rows = jsonData.slice(1).map((row, i) => {
      const rowData: Record<string, any> = { key: i };
      row.forEach((cell, j) => {
        rowData[`col_${j}`] = cell?.toString() || '';
      });
      return rowData;
    });
    
    return { columns: cols, data: rows };
  }, [workbook, activeSheet]);

  const handleDownload = useCallback(() => {
    if (!tab.content) return;
    
    const link = document.createElement('a');
    if (tab.content.startsWith('data:')) {
      link.href = tab.content;
    } else {
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${tab.content}`;
    }
    link.download = tab.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [tab]);

  useEditorCleanup(instanceId, useCallback(() => {
    setWorkbook(null);
    setActiveSheet('');
    cleanup();
  }, [cleanup]));

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载Excel文档..." />
      </div>
    );
  }

  if (error || !workbook) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
        <Empty
          description={
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--text-200)', marginBottom: 8 }}>无法预览此Excel文档</p>
              <p style={{ color: 'var(--text-300)', fontSize: 12 }}>{error || '未知错误'}</p>
            </div>
          }
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <Button 
              type="primary" 
              icon={<ReloadOutlined />}
              onClick={() => loadWorkbook(tab.content)}
            >
              重新加载
            </Button>
            <Button 
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载文件
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  const sheetTabs = workbook.SheetNames.map(name => ({
    key: name,
    label: name,
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-100)' }}>
      <Tabs
        activeKey={activeSheet}
        onChange={setActiveSheet}
        items={sheetTabs}
        style={{ padding: '0 12px', marginBottom: 0 }}
        size="small"
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
        <Table 
          columns={columns} 
          dataSource={data} 
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          size="small"
          scroll={{ x: 'max-content', y: 'calc(100vh - 250px)' }}
        />
      </div>
    </div>
  );
};

export default ExcelViewer;
