import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    // Native window controls live in the OS title bar, outside application content.
    titleBarStyle: 'default',
    title: '',
    backgroundColor: dark ? '#1B1D1A' : '#F8F7F3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  const publishWindowState=()=>{if(!win.isDestroyed())win.webContents.send('window:stateChanged',{fullScreen:win.isFullScreen(),platform:process.platform})}
  win.on('enter-full-screen',publishWindowState);win.on('leave-full-screen',publishWindowState);win.webContents.on('did-finish-load',publishWindowState)
  win.on('page-title-updated',event=>{event.preventDefault();win.setTitle('')})
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })

  // 开发期把渲染进程的错误转发到主进程 stdout，便于无头截图排查
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.error(`[renderer:${event.level}] ${event.message}`)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] 进程异常退出：', JSON.stringify(details))
  })
  win.webContents.on('preload-error', (_e, path, error) => {
    console.error('[preload] 加载失败', path, error)
  })

  // 外链一律交给系统浏览器，应用内不打开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止导航离开应用自身
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  // 开发期可用 JIAN_VIEW / JIAN_QUERY 指定初始视图与额外查询参数，便于无头截图
  const params = new URLSearchParams()
  if (process.env['JIAN_VIEW']) params.set('view', process.env['JIAN_VIEW'])
  if (process.env['JIAN_QUERY']) {
    for (const [k, v] of new URLSearchParams(process.env['JIAN_QUERY'])) params.set(k, v)
  }
  const qs = params.toString()

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(qs ? `${devUrl}?${qs}` : devUrl)
  } else {
    const query = Object.fromEntries(params.entries())
    void win.loadFile(
      join(__dirname, '../renderer/index.html'),
      Object.keys(query).length > 0 ? { query } : undefined
    )
  }

  return win
}

export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}
