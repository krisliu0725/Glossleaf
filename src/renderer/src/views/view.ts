export type View = 'probe' | 'dashboard' | 'library' | 'reader'

/**
 * 导航只保留「键」，文案由 i18n 提供。
 * 文库是主页面排第一，个人（含统计）放最后。
 */
export const VIEWS: Array<{ id: View; key: 'dashboard' | 'library' | 'reader' }> = [
  { id: 'library', key: 'library' },
  { id: 'reader', key: 'reader' },
  { id: 'dashboard', key: 'dashboard' }
]
