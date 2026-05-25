import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, App, Space, Typography, Card, Button, Form, Input, Tag } from 'antd';
import { InboxOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { skillsApi } from '../../services/skillsApi';

const { Text } = Typography;

interface SkillsImportDialogProps {
  visible: boolean;
  onClose: () => void;
  onImport: () => void;
}

interface ParsedMetadata {
  name?: string;
  description?: string;
  author?: string;
  tags?: string[];
  temp_file_id?: string;
}

const SkillsImportDialog: React.FC<SkillsImportDialogProps> = ({ visible, onClose, onImport }) => {
  const { message } = App.useApp();
  const [step, setStep] = useState<'upload' | 'form'>('upload');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [tempFileId, setTempFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [form] = Form.useForm();
  const [tags, setTags] = useState<string[]>([]);
  const [inputTagValue, setInputTagValue] = useState('');
  const [selectedType, setSelectedType] = useState<'zip' | 'folder'>('zip');
  // 文件选择器打开状态
  const [isOpeningDialog, setIsOpeningDialog] = useState(false);

  // 清理临时文件
  const cleanupTempFile = useCallback(async (tempId: string) => {
    try {
      await skillsApi.cleanupTempFile(tempId);
    } catch (error) {
      console.error('Cleanup temp file failed:', error);
    }
  }, []);

  // 重置状态
  const resetState = useCallback(() => {
    setStep('upload');
    setUploadedFile(null);
    setTempFileId(null);
    setUploading(false);
    setImporting(false);
    form.resetFields();
    setTags([]);
    setInputTagValue('');
    setIsOpeningDialog(false);
  }, [form]);

  // Modal关闭时清理
  const handleClose = useCallback(() => {
    if (tempFileId) {
      cleanupTempFile(tempFileId);
    }
    resetState();
    onClose();
  }, [tempFileId, cleanupTempFile, resetState, onClose]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (tempFileId) {
        cleanupTempFile(tempFileId);
      }
    };
  }, [tempFileId, cleanupTempFile]);

  // 处理文件上传和解析
  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const response = await skillsApi.parseImportPackage(file);
      if (response.code === 200) {
        const metadata: ParsedMetadata = response.data;
        setUploadedFile(file);
        setTempFileId(metadata.temp_file_id || null);

        // 自动填入表单（只填入空字段）
        const currentValues = form.getFieldsValue();

        if (!currentValues.name && metadata.name) {
          form.setFieldValue('name', metadata.name);
        }
        if (!currentValues.description && metadata.description) {
          form.setFieldValue('description', metadata.description);
        }
        if (!currentValues.author && metadata.author) {
          form.setFieldValue('author', metadata.author);
        }

        // 标签合并
        if (metadata.tags && metadata.tags.length > 0) {
          const newTags = [...new Set([...tags, ...metadata.tags])];
          setTags(newTags);
        }

        // 切换到表单步骤
        setStep('form');
        message.success('文件解析成功，请确认信息');
      } else {
        message.error('解析失败：' + response.message);
      }
    } catch (error) {
      message.error('解析失败：' + String(error));
    } finally {
      setUploading(false);
    }
  }, [form, tags]);

  // 处理ZIP文件选择 - 使用静态input
  const handleZipSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (file.name.endsWith('.zip')) {
      await handleUpload(file);
    } else {
      message.error('请选择 ZIP 文件');
    }
    // 重置input以便下次选择同一文件
    e.target.value = '';
  }, [handleUpload]);

  // 处理文件夹选择 - 使用静态input
  const handleFolderSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      e.target.value = '';
      return;
    }

    try {
      setUploading(true);
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 获取根文件夹名称
      const rootFolder = files[0].webkitRelativePath.split('/')[0];

      // 添加文件到ZIP
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = file.webkitRelativePath;
        const content = await file.arrayBuffer();
        zip.file(relativePath, content);
      }

      // 生成ZIP文件
      const zipContent = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([zipContent], `${rootFolder}.zip`, { type: 'application/zip' });

      await handleUpload(zipFile);
    } catch (error) {
      message.error('文件夹打包失败：' + String(error));
    } finally {
      setUploading(false);
      // 重置input以便下次选择同一文件夹
      e.target.value = '';
    }
  }, [handleUpload]);

  // 处理点击选择 - 动态创建input元素以避免预创建带来的性能问题
  const handleClickSelect = useCallback(() => {
    setIsOpeningDialog(true);

    // 使用setTimeout让UI有时间更新，显示加载状态
    setTimeout(() => {
      // 动态创建input元素
      const input = document.createElement('input');
      input.type = 'file';
      input.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;width:1px;height:1px;pointer-events:none;';

      if (selectedType === 'folder') {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.multiple = true;
      } else {
        input.accept = '.zip';
      }

      // 标记是否已经处理了文件选择（避免focus事件重复处理）
      let isFileSelected = false;

      input.onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          isFileSelected = true;
          if (selectedType === 'zip') {
            await handleZipSelect(e as unknown as React.ChangeEvent<HTMLInputElement>);
          } else {
            await handleFolderSelect(e as unknown as React.ChangeEvent<HTMLInputElement>);
          }
        }
        // 清理DOM
        if (input.parentNode) {
          document.body.removeChild(input);
        }
        setIsOpeningDialog(false);
        window.removeEventListener('focus', handleWindowFocus);
      };

      // 处理用户取消选择的情况
      const handleWindowFocus = () => {
        setTimeout(() => {
          // 如果已经选择了文件，不要重复处理
          if (isFileSelected) {
            return;
          }
          if (input.parentNode) {
            document.body.removeChild(input);
          }
          setIsOpeningDialog(false);
          window.removeEventListener('focus', handleWindowFocus);
        }, 300);
      };
      window.addEventListener('focus', handleWindowFocus);

      // 添加到DOM并触发点击
      document.body.appendChild(input);

      // 使用requestAnimationFrame确保DOM更新完成后再触发点击
      requestAnimationFrame(() => {
        input.click();
      });
    }, 100); // 100ms延迟确保UI更新和浏览器主线程空闲
  }, [selectedType, handleZipSelect, handleFolderSelect]);

  // 处理拖拽上传
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const item = items[0];
    const entry = item.webkitGetAsEntry?.() || (item as any).getAsEntry?.();

    if (!entry) {
      // 普通文件拖拽
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.zip')) {
          await handleUpload(file);
        } else {
          message.error('请上传 ZIP 文件或文件夹');
        }
      }
      return;
    }

    if (entry.isFile && entry.name.endsWith('.zip')) {
      // ZIP文件
      const file = item.getAsFile();
      if (file) {
        await handleUpload(file);
      }
    } else if (entry.isDirectory) {
      // 文件夹 - 遍历并打包为ZIP
      try {
        setUploading(true);
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        const traverseDirectory = async (dirEntry: any, path: string = '') => {
          const dirReader = dirEntry.createReader();
          const entries: any[] = await new Promise((resolve) => {
            dirReader.readEntries((results: any[]) => resolve(results));
          });

          for (const entry of entries) {
            const entryPath = path ? `${path}/${entry.name}` : entry.name;
            if (entry.isFile) {
              const file = await new Promise<File>((resolve) => {
                entry.file((f: File) => resolve(f));
              });
              const content = await file.arrayBuffer();
              zip.file(entryPath, content);
            } else if (entry.isDirectory) {
              await traverseDirectory(entry, entryPath);
            }
          }
        };

        await traverseDirectory(entry);

        // 生成 ZIP 文件
        const zipContent = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipContent], `${entry.name}.zip`, { type: 'application/zip' });

        await handleUpload(zipFile);
      } catch (error) {
        message.error('文件夹处理失败：' + String(error));
      } finally {
        setUploading(false);
      }
    }
  }, [handleUpload]);

  // 重新选择文件
  const handleReselect = useCallback(() => {
    if (tempFileId) {
      cleanupTempFile(tempFileId);
    }
    setStep('upload');
    setUploadedFile(null);
    setTempFileId(null);
    form.resetFields();
    setTags([]);
  }, [tempFileId, cleanupTempFile, form]);

  // 处理导入
  const handleImport = useCallback(async () => {
    try {
      const values = await form.validateFields();
      if (!tempFileId) {
        message.error('临时文件不存在，请重新上传');
        return;
      }

      setImporting(true);
      const response = await skillsApi.importPackageWithForm({
        tempId: tempFileId,
        name: values.name,
        description: values.description || '',
        author: values.author || '',
        tags: tags,
      });

      if (response.code === 200) {
        message.success('Skills 包导入成功！');
        onImport();
        handleClose();
      } else {
        message.error('导入失败：' + response.message);
      }
    } catch (error) {
      if (error instanceof Error) {
        message.error('导入失败：' + error.message);
      }
    } finally {
      setImporting(false);
    }
  }, [tempFileId, form, tags, onImport, handleClose]);

  // 添加标签
  const handleAddTag = useCallback(() => {
    if (inputTagValue && !tags.includes(inputTagValue)) {
      setTags([...tags, inputTagValue]);
      setInputTagValue('');
    }
  }, [inputTagValue, tags]);

  // 移除标签
  const handleRemoveTag = useCallback((removedTag: string) => {
    setTags(tags.filter(tag => tag !== removedTag));
  }, [tags]);

  return (
    <Modal
      title="导入 Skills 包"
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {step === 'upload' && (
          <>
            {/* 支持的格式 - 带边框，可点击选择 */}
            <Card size="small" styles={{ body: { padding: '12px 16px' } }} style={{ marginBottom: 0 }}>
              <Text strong style={{ fontSize: 14 }}>支持的格式</Text>
              <div style={{ marginTop: 8 }}>
                {/* ZIP文件 - 可点击选择 */}
                <div
                  onClick={() => setSelectedType('zip')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 4,
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: selectedType === 'zip' ? '#e6f7ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedType !== 'zip') {
                      e.currentTarget.style.background = '#f5f5f5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedType !== 'zip') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ fontSize: 16, marginRight: 8 }}>📦</span>
                  <Text strong style={{ fontSize: 14 }}>ZIP 文件</Text>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    .zip 格式的 Skills 包压缩文件
                  </Text>
                </div>

                {/* 文件夹 - 可点击选择 */}
                <div
                  onClick={() => setSelectedType('folder')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: selectedType === 'folder' ? '#e6f7ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedType !== 'folder') {
                      e.currentTarget.style.background = '#f5f5f5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedType !== 'folder') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ fontSize: 16, marginRight: 8 }}>📁</span>
                  <Text strong style={{ fontSize: 14 }}>文件夹</Text>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    包含 SKILL.md 的文件夹结构
                  </Text>
                </div>
              </div>
            </Card>

            {/* 拖拽/点击区域 - 使用动态创建的input元素 */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={!isOpeningDialog ? handleClickSelect : undefined}
              style={{
                border: '2px dashed #d9d9d9',
                borderRadius: 8,
                padding: '48px 0',
                textAlign: 'center',
                background: '#fafafa',
                cursor: isOpeningDialog ? 'wait' : 'pointer',
                transition: 'border-color 0.3s, background 0.3s',
                marginTop: 0,
              }}
              onMouseEnter={(e) => {
                if (!isOpeningDialog) {
                  e.currentTarget.style.borderColor = '#1890ff';
                  e.currentTarget.style.background = '#e6f7ff';
                }
              }}
              onMouseLeave={(e) => {
                if (!isOpeningDialog) {
                  e.currentTarget.style.borderColor = '#d9d9d9';
                  e.currentTarget.style.background = '#fafafa';
                }
              }}
            >
              {isOpeningDialog ? (
                <>
                  <InboxOutlined style={{ fontSize: 56, color: '#1890ff' }} />
                  <div style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 16 }}>
                      正在打开文件选择器...
                    </Text>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      请稍候
                    </Text>
                  </div>
                </>
              ) : (
                <>
                  <InboxOutlined style={{ fontSize: 56, color: '#1890ff' }} />
                  <div style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 16 }}>
                      点击或拖拽{selectedType === 'zip' ? '文件' : '文件夹'}到此处
                    </Text>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      支持 {selectedType === 'zip' ? 'ZIP 文件' : '文件夹'}
                    </Text>
                  </div>
                </>
              )}
            </div>

            {/* 提示 */}
            <Card size="small" style={{ background: '#f5f5f5' }} styles={{ body: { padding: 12 } }}>
              <Text style={{ fontSize: 12 }}>
                💡 提示：Skills 包应该包含 SKILL.md 文件和 skills/、common/ 等标准目录结构。
              </Text>
            </Card>

            {/* 取消按钮 */}
            <div style={{ textAlign: 'right' }}>
              <Button onClick={handleClose}>取消</Button>
            </div>
          </>
        )}

        {step === 'form' && (
          <>
            {/* 已选择文件信息 */}
            <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <Space>
                <Text strong>已选择：</Text>
                <Text>{uploadedFile?.name}</Text>
                <Button size="small" onClick={handleReselect}>重新选择</Button>
              </Space>
            </div>

            {/* 表单 */}
            <Form
              form={form}
              layout="vertical"
              autoComplete="off"
            >
              <Form.Item
                label="包名称"
                name="name"
                rules={[{ required: true, message: '请输入包名称' }]}
              >
                <Input placeholder="例如: coding-assistant" />
              </Form.Item>

              <Form.Item
                label="描述"
                name="description"
              >
                <Input.TextArea
                  rows={3}
                  placeholder="描述这个 Skills 包的功能..."
                />
              </Form.Item>

              <Form.Item
                label="作者"
                name="author"
              >
                <Input placeholder="作者名称" />
              </Form.Item>

              <Form.Item label="标签">
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    alignItems: 'center',
                    padding: '1px 11px',
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    minHeight: 30,
                    backgroundColor: '#fff',
                    fontSize: 14,
                    transition: 'all 0.2s',
                    cursor: 'text',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#4096ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#d9d9d9';
                  }}
                  onClick={(e) => {
                    const input = e.currentTarget.querySelector('input');
                    if (input) {
                      input.focus();
                    }
                  }}
                >
                  {tags.map((tag, index) => (
                    <Tag
                      key={tag}
                      closable
                      onClose={(e) => {
                        e.stopPropagation();
                        handleRemoveTag(tag);
                      }}
                      style={{
                        margin: 0,
                        padding: '0 7px',
                        fontSize: 14,
                        lineHeight: '20px',
                        borderRadius: 4,
                        backgroundColor: tag === 'system' ? 'var(--primary-300)' : undefined,
                        border: tag === 'system' ? '1px solid var(--primary-100)' : undefined,
                        color: tag === 'system' ? 'var(--primary-100)' : undefined,
                      }}
                    >
                      {tag}
                    </Tag>
                  ))}
                  <Input
                    type="text"
                    style={{
                      width: tags.length === 0 ? 120 : 80,
                      border: 'none',
                      backgroundColor: 'transparent',
                      boxShadow: 'none',
                      padding: 0,
                      fontSize: 14,
                      lineHeight: '20px',
                    }}
                    placeholder={tags.length === 0 ? "按回车添加标签" : ""}
                    value={inputTagValue}
                    onChange={(e) => setInputTagValue(e.target.value)}
                    onBlur={handleAddTag}
                    onPressEnter={handleAddTag}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </Form.Item>
            </Form>

            {/* 按钮 */}
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={handleClose}>取消</Button>
                <Button
                  type="primary"
                  onClick={handleImport}
                  loading={importing}
                >
                  导入
                </Button>
              </Space>
            </div>
          </>
        )}
      </Space>
    </Modal>
  );
};

export default SkillsImportDialog;
