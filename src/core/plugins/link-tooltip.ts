/**
 * 链接 Tooltip 插件
 *
 * 鼠标悬停在链接上时显示 tooltip，提示链接地址和快捷键
 * Ctrl/Cmd + 左击用默认浏览器打开链接
 * 拦截所有链接的默认跳转行为
 */

import { Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

/** 从 DOM 元素向上查找最近的 <a> 标签 */
function findLinkElement(target: HTMLElement, root: HTMLElement): HTMLAnchorElement | null {
  let el: HTMLElement | null = target;
  while (el && el !== root) {
    if (el.tagName === "A" && el.getAttribute("href")) {
      return el as HTMLAnchorElement;
    }
    el = el.parentElement;
  }
  return null;
}

/** 用默认浏览器打开链接 */
function openLinkExternal(href: string) {
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.openExternal) {
    electronAPI.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export function createLinkTooltipPlugin(): Plugin {
  let tooltip: HTMLElement | null = null;
  let currentLink: HTMLAnchorElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let editorView: EditorView | null = null;

  function getContainer(): HTMLElement {
    return editorView?.dom.parentElement || document.body;
  }

  function ensureTooltip(): HTMLElement {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "milkup-link-tooltip";
      const container = getContainer();
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      container.appendChild(tooltip);
    }
    return tooltip;
  }

  function showTooltip(linkEl: HTMLAnchorElement, href: string) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (currentLink === linkEl && tooltip?.style.display === "block") return;

    const tip = ensureTooltip();
    const displayHref = href.length > 60 ? href.slice(0, 57) + "..." : href;
    tip.textContent = `${displayHref}  ${modKey}+左击访问`;
    tip.style.display = "block";

    const linkRect = linkEl.getBoundingClientRect();
    const container = getContainer();
    const containerRect = container.getBoundingClientRect();

    let left = linkRect.left - containerRect.left;
    const top = linkRect.bottom - containerRect.top + 4;

    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;

    requestAnimationFrame(() => {
      if (!tooltip) return;
      const tipRect = tooltip.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      if (tipRect.right > cr.right - 8) {
        left = cr.right - cr.left - tipRect.width - 8;
        tooltip.style.left = `${Math.max(0, left)}px`;
      }
    });

    currentLink = linkEl;
  }

  function hideTooltipDelayed() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (tooltip) tooltip.style.display = "none";
      currentLink = null;
      hideTimer = null;
    }, 150);
  }

  function hideTooltipImmediate() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (tooltip) tooltip.style.display = "none";
    currentLink = null;
  }

  function destroyTooltip() {
    hideTooltipImmediate();
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  // ---- 事件处理 ----

  /** mousemove：检测鼠标是否在链接上，显示/隐藏 tooltip */
  function onMouseMove(e: MouseEvent) {
    if (!editorView) return;
    const target = e.target as HTMLElement;
    const linkEl = findLinkElement(target, editorView.dom);

    if (linkEl) {
      const href = linkEl.getAttribute("href") || "";
      if (href) {
        showTooltip(linkEl, href);
        return;
      }
    }

    // 鼠标不在链接上
    if (currentLink) {
      hideTooltipDelayed();
    }
  }

  /** mouseleave：鼠标离开编辑器区域时隐藏 tooltip */
  function onMouseLeave() {
    hideTooltipDelayed();
  }

  /**
   * click（capture 阶段）：
   * - 拦截所有 <a> 标签的默认跳转
   * - Ctrl/Cmd+左击时用默认浏览器打开
   */
  function onClickCapture(e: MouseEvent) {
    if (!editorView) return;
    const target = e.target as HTMLElement;
    const linkEl = findLinkElement(target, editorView.dom);
    if (!linkEl) return;

    const href = linkEl.getAttribute("href") || "";
    if (!href) return;

    // 始终阻止 <a> 标签的默认跳转行为
    e.preventDefault();

    // Ctrl/Cmd + 左击：用默认浏览器打开
    const modPressed = isMac ? e.metaKey : e.ctrlKey;
    if (modPressed) {
      openLinkExternal(href);
      e.stopPropagation();
    }
  }

  function onScroll() {
    hideTooltipImmediate();
  }

  return new Plugin({
    view(view) {
      editorView = view;
      const dom = view.dom;

      dom.addEventListener("mousemove", onMouseMove);
      dom.addEventListener("mouseleave", onMouseLeave);
      // capture 阶段拦截，确保在 Electron 导航之前阻止
      dom.addEventListener("click", onClickCapture, true);

      const scrollParent = dom.closest(".scrollView") || dom.parentElement;
      scrollParent?.addEventListener("scroll", onScroll, { passive: true });

      return {
        destroy() {
          dom.removeEventListener("mousemove", onMouseMove);
          dom.removeEventListener("mouseleave", onMouseLeave);
          dom.removeEventListener("click", onClickCapture, true);
          scrollParent?.removeEventListener("scroll", onScroll);
          destroyTooltip();
          editorView = null;
        },
      };
    },
  });
}
