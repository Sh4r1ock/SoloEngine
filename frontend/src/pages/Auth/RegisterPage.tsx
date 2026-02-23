/**
 * @file RegisterPage.tsx
 * @description 注册页面 - 用户注册功能独立页面
 * @author SoloEngine Team
 * @date 2026-02-19
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, Space, message, Layout } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, UserAddOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';

const { Title, Text } = Typography;
const { Content } = Layout;

const RegisterPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { register, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/mainmenu', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (values: { username: string; email: string; password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const success = await register(values.username, values.email, values.password);
      if (success) {
        message.success('注册成功，请登录');
        navigate('/login', { replace: true });
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
          width: 420,
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
              <UserAddOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <Title level={3} style={{ margin: 0, marginBottom: 4, color: 'var(--text-primary)' }}>
              创建账号
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>加入 SoloEngine</Text>
          </Space>

          <Form
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
            style={{ marginTop: 28 }}
          >
            <Form.Item
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 3, message: '用户名至少3个字符' },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="用户名"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="email"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址' },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="邮箱"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少6个字符' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="密码"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              rules={[{ required: true, message: '请确认密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--text-400)' }} />}
                placeholder="确认密码"
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
                注册
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">
                已有账号？
                <Button type="link" onClick={() => navigate('/login')} style={{ padding: '0 4px' }}>
                  立即登录
                </Button>
              </Text>
            </div>
          </Form>
        </div>
      </Content>
    </Layout>
  );
};

export default RegisterPage;
