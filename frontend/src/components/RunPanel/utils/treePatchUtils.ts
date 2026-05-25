import { FileTreeNode } from '../FileExplorer';

export function insertTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
  isDirectory: boolean
): FileTreeNode[] {
  const parts = targetPath.split('/');
  return _insert(nodes, parts, targetPath, isDirectory);
}

function _insert(
  nodes: FileTreeNode[],
  remaining: string[],
  fullPath: string,
  isDirectory: boolean,
): FileTreeNode[] {
  if (remaining.length === 0) return nodes;

  if (remaining.length === 1) {
    const name = remaining[0];
    if (nodes.some((n) => n.key === fullPath)) return nodes;
    const newNode: FileTreeNode = {
      key: fullPath,
      title: name,
      isLeaf: !isDirectory,
      children: isDirectory ? [] : undefined,
    };
    return [...nodes, newNode];
  }

  const current = remaining[0];
  return nodes.map((node) => {
    if (node.key === current || node.title === current) {
      return {
        ...node,
        children: _insert(node.children || [], remaining.slice(1), fullPath, isDirectory),
      };
    }
    return node;
  });
}

export function removeTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
): FileTreeNode[] {
  const parts = targetPath.split('/');
  return _remove(nodes, parts);
}

function _remove(nodes: FileTreeNode[], remaining: string[]): FileTreeNode[] {
  if (remaining.length === 0) return nodes;
  if (remaining.length === 1) {
    const name = remaining[0];
    return nodes.filter((n) => n.key !== name && n.title !== name);
  }
  const current = remaining[0];
  return nodes.map((node) => {
    if (node.key === current || node.title === current) {
      return { ...node, children: _remove(node.children || [], remaining.slice(1)) };
    }
    return node;
  });
}

export function moveTreeNode(
  nodes: FileTreeNode[],
  srcPath: string,
  destPath: string,
  isDirectory: boolean,
): FileTreeNode[] {
  return insertTreeNode(removeTreeNode(nodes, srcPath), destPath, isDirectory);
}