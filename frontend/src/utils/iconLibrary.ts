// F6：Ant Design 预设图标唯一映射（Canvas/PropertyEditor 共用，不再各自实现）
// 用 createElement 避免 JSX 语法，保持本文件 .ts 扩展名
import { TeamOutlined, UserOutlined, ToolOutlined, SettingOutlined } from '@ant-design/icons';
import { createElement } from 'react';

export const ICON_LIBRARY = [
  '🤖', '💡', '📝', '📊', '📈', '📉', '📋', '📌', '🔍', '🔎',
  '💻', '🖥️', '⌨️', '🖱️', '💾', '💿', '📀', '📁', '📂', '🗂️',
  '🔄', '🔃', '⚡', '🌟', '✨', '🎯', '🎨', '🎭', '🎪', '🎬',
  '📚', '📖', '📕', '📗', '📘', '📙', '📓', '📒', '📃', '📜',
  '🔧', '🔨', '⚙️', '🛠️', '🔩', '⚒️', '⛏️', '🔪', '🗡️', '⚔️',
  '🛡️', '🔐', '🔑', '🗝️', '🔒', '🔓', '🔏',
  '🚀', '✈️', '🚁', '⛵', '🚢', '🚗', '🚙', '🚕', '🚌', '🚎',
  '🔥', '💧', '🌊', '❄️', '☃️', '☀️', '🌤️', '⛅', '🌥️', '🌦️',
  '🌈', '🌙', '⭐', '💫', '🌍', '🌎', '🌏', '🗺️',
  '🏠', '🏡', '🏢', '🏬', '🏭', '🏛️', '🕌', '🕍', '⛪', '🏟️',
  '🎓', '🎒', '📐', '📏', '✏️', '✒️', '🖊️', '🖋️', '🖌️', '🖍️',
  '🎵', '🎶', '🎹', '🎸', '🎻', '🎺', '🎷', '🎤', '🎧',
  '🏆', '🥇', '🥈', '🥉', '🎖️', '🏅', '🎗️', '🏵️',
  '🎲', '🎳', '🎮', '🎰', '🎱', '🔮', '🎴', '🃏',
  '❤️', '💛', '💚', '💙', '💜', '🧡', '🖤', '🤍', '💔', '💕',
  '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️',
  '🕉️', '🕎', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎',
  '♏', '♐', '♑', '♒', '♓', '🔯', '♠️',
  '♥️', '♦️', '♣️', '♟️', '♙', '♘', '♗', '♕', '♔', '♖',
  '⚪', '⚫', '🔴', '🔵', '🟡', '🟢', '🟣', '🟠', '🟤', '🔶',
  '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '▪️',
  '▫️', '◾', '◽', '◆', '◇', '○', '●', '◐', '◑', '◒',
  '◓', '◔', '◕', '◖', '◗', '◘', '◙', '◚', '◛', '◜',
  '◝', '◞', '◟', '◠', '◡', '◢', '◣', '◤', '◥', '◦',
  '◧', '◨', '◩', '◪', '◫', '◬', '◭', '◮', '◯', '◰',
  '◱', '◲', '◳', '◴', '◵', '◶', '◷', '◸', '◹', '◺',
  '◻', '◼', '◿',
  '🌧️', '🌨️', '🌩️', '🌪️', '🌫️', '🌬️', '🌚', '🌛',
  '🌜', '🌝', '🌞', '🌋', '🌌', '🌠', '🌡️',
  '🔆', '🔅',
];

export const DEFAULT_ICONS = {
  agenticFlow: '🤖',
  skills: '📁',
  mcp: '🔌',
};

export const getDefaultIcon = (type: 'agenticFlow' | 'skills' | 'mcp') => {
  return DEFAULT_ICONS[type];
};

export const getPresetIcon = (iconName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    'TeamOutlined': createElement(TeamOutlined),
    'UserOutlined': createElement(UserOutlined),
    'ToolOutlined': createElement(ToolOutlined),
    'SettingOutlined': createElement(SettingOutlined),
  };
  return iconMap[iconName] || createElement(SettingOutlined);
};
