export const FileOperation = {
  CREATED: 'created',
  MODIFIED: 'modified',
  DELETED: 'deleted',
} as const;

export type FileOperationType = typeof FileOperation[keyof typeof FileOperation];

export const ChangeStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  REVERTED: 'reverted',
} as const;

export type ChangeStatusType = typeof ChangeStatus[keyof typeof ChangeStatus];

export const FileContentType = {
  TEXT: 'text',
  BINARY: 'binary',
} as const;

export type FileContentTypeType = typeof FileContentType[keyof typeof FileContentType];
