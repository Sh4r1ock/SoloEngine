/**
 * @file LoginPage.tsx
 * @description 登录页面 - 用户登录功能独立页面
 * @author SoloEngine Team
 * @date 2026-02-19
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
      navigate('/mainmenu', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const success = await login(values.username, values.password);
      if (success) {
        message.success('登录成功');
        navigate('/mainmenu', { replace: true });
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
            <div style={{
              width: 56,
              height: 56,
              background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}>
              <LoginOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <Title level={3} style={{ margin: 0, marginBottom: 4, color: 'var(--text-primary)' }}>
              欢迎回来
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>登录 SoloEngine</Text>
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
