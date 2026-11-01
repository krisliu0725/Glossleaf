import type { IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { getMainWindow } from './window'

/**
 * 只接受主窗口发来的调用。
 * DESIGN.md §9.3 / §15.2：敏感方法同时校验调用方窗口、frame 与来源，而不只校验参数。
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  if (event.sender !== win.webContents) return false
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  const url = frame.url
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  try {
    if (devUrl) return new URL(url).origin === new URL(devUrl).origin
    return fileURLToPath(new URL(url)) === join(__dirname, '../renderer/index.html')
  } catch { return false }
}
