export const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#install', label: 'Install' },
] as const;

export const TABS = [
  {
    id: 'compare',
    label: 'Compare',
    title: 'Every page, before and after',
    body: 'Run redline compare on any two commits. The report lists pages that look broken, changed, new or removed, with the files they came from.',
  },
  {
    id: 'overlay',
    label: 'Overlay',
    title: 'Changed elements, outlined',
    body: 'Pin a baseline commit. Redline outlines each rendered element whose source changed. Click one to read the diff.',
  },
  {
    id: 'history',
    label: 'History',
    title: 'Open any commit, running',
    body: 'Each commit builds in its own git worktree and opens read-only in an iframe. Your working tree is never touched.',
  },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const CAPABILITIES = ['Compare', 'Overlay', 'History', 'Report'] as const;
