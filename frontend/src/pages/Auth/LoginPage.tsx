/**
 * SoloEngine : 登录页面组件
 *
 * @file LoginPage.tsx
 * @description 登录页面 - 用户登录功能独立页面
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本组件提供以下核心功能：
 *     - 用户登录表单
 * *     - 登录状态验证
 *     - 登录成功后跳转
 *     - 错误消息提示
 *
 * 依赖:
 *     - react: React核心库
 *     - react-router-dom: 路由管理
 *     - antd: Ant Design组件
 *     - @ant-design/icons: Ant Design图标
 *     - ../../store/authStore: 认证状态管理
 *
 * 使用示例:
 *     - <Route path="/login" element={<LoginPage />} />
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, Space, message, Layout } from 'antd';
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';

const { Title, Text } = Typography;
const { Content } = Layout;

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/main', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result.success) {
        message.success('登录成功');
        navigate('/main', { replace: true });
      } else {
        message.error(result.error || '登录失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ 
      minHeight: '100vh', 
      background: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Content style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        width: '100%',
        padding: '24px',
      }}>
        <div style={{
          width: 400,
          padding: '48px 40px',
          borderRadius: 16,
          boxShadow: 'var(--shadow-xl)',
          background: 'var(--bg-100)',
        }}>
          <Space direction="vertical" style={{ width: '100%' }} align="center">
            <img
              src="/SoloEngine-clear.png"
              alt="SoloEngine"
              style={{
                width: 200,
                height: 80,
                backgroundColor: 'white',
                borderRadius: 12,
                padding: 8,
                objectFit: 'contain',
                marginBottom: 4,
              }}
            />
            <Title level={3} style={{ margin: 0, marginBottom: 4, color: 'var(--text-primary)' }}>
              欢迎回来
            </Title>
          </Space>

          <Form
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
            style={{ marginTop: 28 }}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="用户名"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="密码"
                size="large"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                style={{ height: 44 }}
              >
                登录
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">
                没有账号？
                <Button type="link" onClick={() => navigate('/register')} style={{ padding: '0 4px' }}>
                  立即注册
                </Button>
              </Text>
            </div>
          </Form>
        </div>
      </Content>
    </Layout>
  );
};

export default LoginPage;
