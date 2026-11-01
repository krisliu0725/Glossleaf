import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ServiceRequest, ServiceResponse } from '../shared/ipc'

/**
 * 主进程侧的唯一切口：所有数据操作都通过这里转发给数据服务进程。
 * 主进程自己不开数据库连接（DESIGN.md §9.2）。
 */

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let child: UtilityProcess | null = null
let stopping = false
let bootedResolve: (() => void) | null = null
let bootedReject: ((e: Error) => void) | null = null
let booted: Promise<void> | null = null
const pending = new Map<string, Pending>()

function onMessage(message: unknown): void {
  const res = message as ServiceResponse
  if (!res || typeof res.id !== 'string') return

  if (res.id === 'boot') {
    bootedResolve?.()
    bootedResolve = null
    bootedReject = null
    return
  }

  const entry = pending.get(res.id)
  if (!entry) return
  pending.delete(res.id)
  clearTimeout(entry.timer)
  if (res.ok) entry.resolve(res.data)
  else entry.reject(new Error(`${res.error?.code ?? 'SERVICE_ERROR'}: ${res.error?.message ?? ''}`))
}

function rejectAll(reason: string): void {
  for (const [id, entry] of pending) {
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
  }
}

function ensureChild(): UtilityProcess {
  if (stopping) throw new Error('应用正在退出，数据服务已停止接受新请求')
  if (child) return child

  booted = new Promise<void>((resolve, reject) => {
    bootedResolve = resolve
    bootedReject = reject
  })

  const proc = utilityProcess.fork(join(__dirname, 'data-service.js'), [], {
    serviceName: 'jian-data-service',
    stdio: 'pipe'
  })

  proc.on('message', onMessage)
  proc.on('exit', (code) => {
    child = null
    bootedReject?.(new Error(`数据服务进程退出，code=${code}`))
    rejectAll(`数据服务进程已退出（code=${code}）`)
  })
  proc.stderr?.on('data', (buf: Buffer) => {
    console.error('[data-service]', buf.toString().trim())
  })

  child = proc
  return proc
}

export async function startDataService(libraryDir: string, appVersion: string): Promise<void> {
  stopping = false
  ensureChild()
  await Promise.race([
    booted ?? Promise.resolve(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('数据服务启动超时')), 15_000))
  ])
  // 用 call 而不是裸 postMessage：init 失败必须抛出来，不能被静默吞掉
  await call('init', { libraryDir, appVersion }, 20_000)
  await call('health', {}, 15_000)
}

export function call<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 60_000
): Promise<T> {
  const proc = ensureChild()
  const id = randomUUID()

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`数据服务调用超时：${method}`))
    }, timeoutMs)

    pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
      timer
    })

    proc.postMessage({ id, method, params } satisfies ServiceRequest)
  })
}

export async function stopDataService(): Promise<void> {
  // 先请数据服务自己关闭连接（触发 WAL checkpoint），再结束进程
  try {
    await call('shutdown', {}, 3000)
  } catch {
    /* 进程可能已经不在了，忽略 */
  }
  stopping = true
  rejectAll('应用正在退出')
  child?.kill()
  child = null
}
