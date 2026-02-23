import React, { useState, useEffect } from 'react';
import { Tabs, Card, Input, Select, Tag, Button, Spin, Empty, Typography, Row, Col, Badge, Tooltip, message } from 'antd';
import {
  SearchOutlined,
  DownloadOutlined,
  StarOutlined,
  CheckCircleOutlined,
  AppstoreOutlined,
  ApiOutlined,
  FolderOutlined,
  CodeOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  ChromeOutlined,
  MessageOutlined,
  RobotOutlined,
  CloudOutlined,
  EditOutlined,
  ExperimentOutlined,
  SettingOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { marketplaceApi, MarketItem, MarketCategory, MarketData } from '../../services/marketplaceApi';

const { Text, Title, Paragraph } = Typography;
const { Search } = Input;

const iconMap: Record<string, React.ReactNode> = {
  folder: <FolderOutlined />,
  github: <ApiOutlined />,
  database: <DatabaseOutlined />,
  search: <SearchOutlined />,
  chrome: <ChromeOutlined />,
  slack: <MessageOutlined />,
  brain: <RobotOutlined />,
  cloud: <CloudOutlined />,
  global: <GlobalOutlined />,
  code: <CodeOutlined />,
  chart: <AppstoreOutlined />,
  spider: <GlobalOutlined />,
  'file-text': <EditOutlined />,
  api: <ApiOutlined />,
  cog: <SettingOutlined />,
  shield: <SafetyOutlined />,
  appstore: <AppstoreOutlined />,
  robot: <RobotOutlined />,
  message: <MessageOutlined />,
  edit: <EditOutlined />,
  'test-tube': <ExperimentOutlined />,
};

interface MarketCardProps {
  item: MarketItem;
  type: 'mcp' | 'skills';
  onInstall: (id: string) => void;
  installing: boolean;
}

const MarketCard: React.FC<MarketCardProps> = ({ item, type, onInstall, installing }) => {
  const handleInstall = () => {
    onInstall(item.id);
  };

  return (
    <Card
      hoverable
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--bg-300)',
        overflow: 'hidden',
        background: 'var(--bg-100)',
      }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            color: 'white',
            marginRight: '12px',
            flexShrink: 0,
          }}
        >
          {iconMap[item.icon] || <AppstoreOutlined />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Text strong style={{ fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </Text>
            {item.verified && (
              <Tooltip title="已验证">
                <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: '14px' }} />
              </Tooltip>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {item.author}
          </Text>
        </div>
      </div>

      <Paragraph
        ellipsis={{ rows: 2 }}
        style={{ fontSize: '13px', color: 'var(--text-200)', marginBottom: '12px', flex: 1 }}
      >
        {item.description}
      </Paragraph>

      <div style={{ marginBottom: '12px' }}>
        {item.tags.slice(0, 3).map((tag) => (
          <Tag
            key={tag}
            style={{
              marginBottom: '4px',
              borderRadius: '4px',
              fontSize: '11px',
              background: 'var(--bg-200)',
              border: 'none',
            }}
          >
            {tag}
          </Tag>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          paddingTop: '12px',
          borderTop: '1px solid var(--bg-200)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <StarOutlined style={{ color: 'var(--warning)', fontSize: '12px' }} />
            <Text style={{ fontSize: '12px', fontWeight: 500 }}>{item.rating.toFixed(1)}</Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <DownloadOutlined style={{ fontSize: '12px', color: 'var(--text-300)' }} />
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {(item.downloads / 1000).toFixed(1)}k
            </Text>
          </div>
          {item.skills_count && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {item.skills_count} 技能
            </Text>
          )}
        </div>
        <Button
          type="primary"
          size="small"
          icon={<DownloadOutlined />}
          onClick={handleInstall}
          loading={installing}
          style={{
            borderRadius: '6px',
            fontSize: '12px',
            height: '28px',
          }}
        >
          安装
        </Button>
      </div>
    </Card>
  );
};

const MarketplacePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'mcp' | 'skills'>('mcp');
  const [mcpData, setMcpData] = useState<MarketData | null>(null);
  const [skillsData, setSkillsData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('downloads');
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    fetchMarketData();
  }, [activeTab, selectedCategory, sortBy]);

  const fetchMarketData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'mcp') {
        const data = await marketplaceApi.getMCPMarket({
          category: selectedCategory,
          search: searchText,
          sort_by: sortBy,
        });
        setMcpData(data);
      } else {
        const data = await marketplaceApi.getSkillsMarket({
          category: selectedCategory,
          search: searchText,
          sort_by: sortBy,
        });
        setSkillsData(data);
      }
    } catch (error) {
      console.error('Failed to fetch market data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchText(value);
    setTimeout(() => fetchMarketData(), 300);
  };

  const handleInstall = async (itemId: string) => {
    setInstallingId(itemId);
    try {
      if (activeTab === 'mcp') {
        await marketplaceApi.installMCPItem(itemId);
      } else {
        await marketplaceApi.installSkillsItem(itemId);
      }
      message.success('安装成功！');
    } catch (error) {
      message.error('安装失败，请重试');
    } finally {
      setInstallingId(null);
    }
  };

  const currentData = activeTab === 'mcp' ? mcpData : skillsData;
  const categories = currentData?.categories || [];

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: '16px',
        }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              {activeTab === 'mcp' ? 'MCP 市场' : 'Skills 市场'}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              发现和安装{activeTab === 'mcp' ? 'MCP工具' : 'Skills技能包'}
            </Text>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Button
              type={activeTab === 'mcp' ? 'primary' : 'default'}
              icon={<ApiOutlined />}
              onClick={() => {
                setActiveTab('mcp');
                setSelectedCategory('all');
                setSearchText('');
              }}
            >
              MCP 市场
              {mcpData && (
                <Badge
                  count={mcpData.total}
                  style={{ backgroundColor: 'var(--primary-100)', marginLeft: 8 }}
                  showZero
                />
              )}
            </Button>
            <Button
              type={activeTab === 'skills' ? 'primary' : 'default'}
              icon={<ThunderboltOutlined />}
              onClick={() => {
                setActiveTab('skills');
                setSelectedCategory('all');
                setSearchText('');
              }}
            >
              Skills 市场
              {skillsData && (
                <Badge
                  count={skillsData.total}
                  style={{ backgroundColor: 'var(--accent-100)', marginLeft: 8 }}
                  showZero
                />
              )}
            </Button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '24px',
            flexWrap: 'wrap',
          }}
        >
          <Search
            placeholder="搜索..."
            allowClear
            onSearch={handleSearch}
            style={{ width: 300 }}
            prefix={<SearchOutlined />}
          />
          <Select
            value={selectedCategory}
            onChange={setSelectedCategory}
            style={{ width: 150 }}
            options={categories.map((cat) => ({
              value: cat.id,
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {iconMap[cat.icon]}
                  {cat.name}
                </span>
              ),
            }))}
          />
          <Select
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 150 }}
            options={[
              { value: 'downloads', label: '按下载量排序' },
              { value: 'rating', label: '按评分排序' },
              { value: 'name', label: '按名称排序' },
            ]}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <Spin size="large" />
          </div>
        ) : currentData && currentData.items.length > 0 ? (
          <Row gutter={[16, 16]}>
            {currentData.items.map((item) => (
              <Col key={item.id} xs={24} sm={12} md={8} lg={6}>
                <MarketCard
                  item={item}
                  type={activeTab}
                  onInstall={handleInstall}
                  installing={installingId === item.id}
                />
              </Col>
            ))}
          </Row>
        ) : (
          <Empty
            style={{ padding: '60px 20px' }}
            description={
              <span>
                暂无数据
                <br />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  请尝试其他搜索条件
                </Text>
              </span>
            }
          />
        )}
      </div>
    </div>
  );
};

export default MarketplacePage;
