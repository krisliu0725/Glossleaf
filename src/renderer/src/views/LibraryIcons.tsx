/** 文库侧栏图标：16px 线性，1.3 描边，与宋体标题的中宫相称。 */

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'sidebar__icon',
  'aria-hidden': true
}

export function IconAll(): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M2.5 5.5h11v7h-11z" />
      <path d="M4 5.5V3.5h8v2M6.5 8.5h3" />
    </svg>
  )
}

export function IconRecent(): React.ReactElement {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

export function IconCollection(): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M2.4 5.2h4.1l1 1.4h6.1v6.2H2.4z" />
      <path d="M2.4 5.2V3.6h4.3l1 1.6" />
    </svg>
  )
}

export function IconTag(): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M8.2 2.6H13v4.8l-5.6 5.6-4.8-4.8z" />
      <circle cx="10.6" cy="5" r="0.9" />
    </svg>
  )
}

export function IconInbox(): React.ReactElement {
  return (
    <svg {...base}>
      <path d="M2.5 9.5h3l1 1.6h3l1-1.6h3v3.4h-11z" />
      <path d="M8 2.6v5.2M5.8 5.6L8 7.8l2.2-2.2" />
    </svg>
  )
}

export function IconArchive(): React.ReactElement {
  return (
    <svg {...base}>
      <rect x="2.5" y="3.2" width="11" height="2.6" rx="0.6" />
      <path d="M3.4 5.8v7h9.2v-7M6.4 8.4h3.2" />
    </svg>
  )
}
