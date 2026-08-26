/**
 * 简体中文 — the garden's canonical language. The taxonomy records are the
 * registry's own canonical strings, mapped once so the registry stays the
 * single place they are written.
 */
import { DOMAINS, KINDS, STATUSES } from '../../content/notes/_meta/taxonomy';
import type { FacetText, UIStrings } from './types';

const facet = <T extends { id: string; label: string; desc: string }, I extends T['id']>(
  defs: readonly T[],
): Record<I, FacetText> =>
  Object.fromEntries(defs.map((d) => [d.id, { label: d.label, desc: d.desc }])) as Record<I, FacetText>;

export const strings: UIStrings = {
  searchPlaceholder: '搜索这座园地…（Esc 关闭）',
  searchHint: '搜标题、小节与正文，本语言内检索。',
  searchEmpty: '没有匹配的笔记。',
  searchUnavailable: '搜索索引加载失败。',
  searchUnit: '篇',
  searchScopeAll: '全部',
  searchDialog: '站内搜索',
  searchInput: '搜索这座园地',
  searchResults: '搜索结果',
  searchButton: '搜索（⌘K）',

  languages: '语言',

  navNotes: '笔记',
  navPapers: '论文墙',

  breadcrumb: '面包屑',
  contents: '目录',
  chapterNav: '章节导航',
  prev: '← 上一章',
  next: '下一章 →',
  hub: '总览',
  overview: '总览',
  updated: '更新',
  backlinks: '反向链接',
  localGraph: '邻域 · local graph',
  lightbox: '图片查看器',
  close: '关闭',
  copied: '代码已复制到剪贴板',
  copyFailed: '复制失败，剪贴板不可用',
  theme: '切换浅色 / 深色主题',
  menu: '菜单',
  skip: '跳到正文',
  partLabel: (roman) => `第 ${roman} 部`,
  readingTime: (min) => `阅读约 ${min} 分钟`,
  footer: 'Yufeng Hub · 个人园地：笔记、论文与私密库',

  landingTitle: '个人园地',
  landingDesc: 'Yufeng Jin 的个人知识园地——笔记、论文墙与私密库，读过、想过、写下来。',

  speakLabel: '说人话 →',
  diffLabel: '相比前作 →',

  kinds: facet(KINDS),
  domains: facet(DOMAINS),
  statuses: facet(STATUSES),

  browse: {
    kicker: '园地',
    kickerSub: '读过、想过、写下来',
    title: 'Yufeng Hub',
    titleSub: '一座还在生长的个人知识园地',
    lede: (notes, domains) =>
      `笔记、论文与项目记录，以园地的形式生长——${notes} 篇笔记、${domains} 个方向，可按形式、方向和标签浏览`,
    sep: '。另有 ',
    stop: '。',
    papersLink: '论文墙',
    recent: '最近更新',
    recentSub: '最近改动的三篇',
    shelfCount: (n) => `${n} 篇以此为主 · 全部 →`,
    allNotes: '全部笔记 →',
    byKind: '按形式',
    byDomain: '按方向',
    byStatus: '按成熟度',
    byTag: '按标签',
    facetLede: (desc, n) => `${desc}——共 ${n} 篇。`,
    domainLede: (desc, n) => `${desc}——共 ${n} 篇，主方向或次方向。`,
    tagLede: (n) => `共 ${n} 篇。`,
    tagDesc: (tag, n) => `带 ${tag} 标签的笔记（${n} 篇）`,
    facetDesc: (desc, n) => `${desc}（${n} 篇）`,
    all: '全部笔记',
    allKicker: '一篇不落',
    allEntries: (n) => `共 ${n} 篇`,
    allDesc: (n) => `园地里的全部笔记（${n} 篇），最新的在前，可即时筛选。`,
    allLede: '最新的在前。下面的筛选项就地过滤；没有 JavaScript 时它们会跳到对应的分类页。',
    dimKind: '形式',
    dimDomain: '方向',
    dimStatus: '状态',
    dimTag: '标签',
    facetsAria: '浏览索引',
    facetAll: '全部 →',
    clear: '清除筛选',
    noMatch: '没有笔记同时满足所选条件。',
    allTags: '全部标签',
    chapters: (n) => `${n} 章`,
  },
};
