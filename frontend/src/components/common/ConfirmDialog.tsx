import React, { useState, useCallback } from 'react';
import { Modal } from 'antd';
import { ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  content: React.ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onOk: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  content,
  okText = '确认',
  cancelText = '取消',
  danger = false,
  onOk,
  onCancel,
  loading: externalLoading,
}) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = externalLoading !== undefined ? externalLoading : internalLoading;

  const handleOk = useCallback(async () => {
    try {
      if (externalLoading === undefined) {
        setInternalLoading(true);
      }
      await onOk();
      onCancel();
    } catch {
    } finally {
      if (externalLoading === undefined) {
        setInternalLoading(false);
      }
    }
  }, [onOk, onCancel, externalLoading]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      closable={false}
      centered
      width={420}
      className="sc-confirm-dialog"
      maskClosable={!loading}
      destroyOnHidden
    >
      <div className="sc-confirm-dialog-header">
        <div className="sc-confirm-dialog-icon">
          {danger ? (
            <ExclamationCircleOutlined style={{ fontSize: 22, color: '#faad14' }} />
          ) : (
            <InfoCircleOutlined style={{ fontSize: 22, color: 'var(--primary-100)' }} />
          )}
        </div>
        <span className="sc-confirm-dialog-title">{title}</span>
      </div>
      <div className="sc-confirm-dialog-body">
        {typeof content === 'string' ? (
          <p className="sc-confirm-dialog-text">{content}</p>
        ) : (
          content
        )}
      </div>
      <div className="sc-confirm-dialog-footer">
        <button
          className="sc-confirm-cancel-btn"
          onClick={onCancel}
          disabled={loading}
        >
          {cancelText}
        </button>
        <button
          className={danger ? 'sc-confirm-danger-btn' : 'sc-confirm-primary-btn'}
          onClick={handleOk}
          disabled={loading}
        >
          {loading && <span className="sc-confirm-btn-spinner" />}
          {okText}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
