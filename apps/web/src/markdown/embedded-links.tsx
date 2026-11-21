import React, { useState, type ReactNode } from 'react';
import {
  classifyLink,
  extractLocalPath,
  getLinkActionLabel,
  getLinkIconName,
  type LinkType,
} from '@workspacetree/markdown';
import { WorkspaceIcon } from '../WorkspaceIcon.js';

/**
 * 轻量独立 Toast 浮动提示
 */
export function showToast(message: string, duration = 2500): void {
  if (typeof document === 'undefined') return;
  let container = document.getElementById('wst-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'wst-toast-container';
    container.className = 'wst-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'wst-toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => {
      toast.remove();
      if (container && container.children.length === 0) {
        container.remove();
      }
    }, 250);
  }, duration);
}

/**
 * 统一执行链接打开逻辑（网页打开 / 协议唤起 / 系统默认程序打开 / 路径安全复制）
 */
export async function openEmbeddedLink(href: string, type?: LinkType): Promise<void> {
  if (!href) return;
  const linkType = type || classifyLink(href);
  const isWeb = linkType === 'url' || /^(https?:|\/\/)/i.test(href);

  // 1. 网页链接：新标签页安全打开
  if (isWeb) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }

  // 2. 特殊 App 协议直接唤起（如 obsidian://, vscode://, mailto: 等）
  if (/^[a-zA-Z0-9_-]+:\/\//i.test(href) && !href.startsWith('file://')) {
    window.location.href = href;
    return;
  }

  // 3. 本地文件与文件夹路径
  const localPath = extractLocalPath(href);

  // 自动复制本地路径到系统剪贴板（Win+R 或资源管理器地址栏中可即时粘贴）
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(localPath).catch(() => {});
  }

  // 4. 若处于本地开发服务环境（localhost / 127.0.0.1），请求本地开发服务以操作系统默认工具打开
  let openedLocally = false;
  try {
    const isLocalHost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '0.0.0.0');

    if (isLocalHost) {
      const resp = await fetch(`/__open_in_system?path=${encodeURIComponent(localPath)}`);
      if (resp.ok) {
        const data = (await resp.json()) as { ok?: boolean; error?: string; opened?: string };
        if (data.ok) {
          openedLocally = true;
          const targetName = localPath.split(/[/\\]/).filter(Boolean).pop() || localPath;
          if (linkType === 'folder') {
            showToast(`📁 已在文件管理器中打开文件夹: ${targetName}`);
          } else {
            showToast(`🚀 已用系统默认程序打开: ${targetName}`);
          }
          return;
        }
      }
    }
  } catch {
    // 静态部署环境无后台服务，静默降级为复制路径
  }

  // 5. 静态部署环境（如 GitHub Pages）或未在本地找到实体文件的安全降级提示
  if (!openedLocally) {
    if (linkType === 'folder') {
      showToast(`📁 已复制文件夹路径到剪贴板: ${localPath}`);
    } else {
      showToast(`📄 已复制文档路径到剪贴板: ${localPath}`);
    }
  }
}

export interface EmbeddedLinkProps {
  href?: string;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function EmbeddedLink({ href = '', title, children, className = '' }: EmbeddedLinkProps) {
  const [copied, setCopied] = useState(false);
  const type = classifyLink(href);
  const iconName = getLinkIconName(type);
  const isWeb = type === 'url' || /^(https?:|\/\/)/i.test(href);
  const actionTooltip = title || getLinkActionLabel(type, href);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textToCopy = type === 'folder' || type === 'md' ? extractLocalPath(href) : href;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        showToast(`📋 已复制路径到剪贴板: ${textToCopy}`);
        setTimeout(() => setCopied(false), 2000);
      } else {
        showToast(`⚠️ 当前环境不支持自动复制`);
      }
    } catch {
      showToast(`⚠️ 复制失败，请手动选择复制`);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 阻止冒泡，避免 ReactFlow 画布误触发节点拖动、选中或双击进入编辑
    e.preventDefault();
    e.stopPropagation();
    openEmbeddedLink(href, type);
  };

  return (
    <a
      href={href}
      className={`wst-embedded-link is-${type} nodrag nopan ${className}`}
      target={isWeb ? '_blank' : undefined}
      rel={isWeb ? 'noopener noreferrer' : undefined}
      title={actionTooltip}
      onClick={handleClick}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="wst-link-icon" aria-hidden="true">
        <WorkspaceIcon name={iconName} size={13} />
      </span>
      <span className="wst-link-text">{children}</span>
      <button
        type="button"
        tabIndex={-1}
        className={`wst-link-copy-btn ${copied ? 'is-copied' : ''}`}
        title={copied ? '已复制' : '复制链接/路径'}
        onClick={handleCopy}
      >
        <WorkspaceIcon name={copied ? 'check' : 'copy'} size={11} />
      </button>
    </a>
  );
}
