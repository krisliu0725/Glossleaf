import { ui } from '../i18n'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const stack: HTMLElement[] = []
const originalInert = new Map<HTMLElement, boolean>()
function isolate(): void {
    const top = stack.at(-1)
    for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (!originalInert.has(child)) originalInert.set(child, child.inert)
        child.inert = top ? child !== top : originalInert.get(child) ?? false
    }
    if (!top) originalInert.clear()
}

export default function Dialog({ title, onClose, children, footer, closeDisabled = false,className='' }: {
    className?:string
    title: string
    onClose: () => void
    children: React.ReactNode
    footer?: React.ReactNode
    closeDisabled?: boolean
}): React.ReactElement {
    const backdrop = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null)
    const latest = useRef({ onClose, closeDisabled }), titleId = useId()
    latest.current = { onClose, closeDisabled }
    useEffect(() => {
        const layer = backdrop.current!
        const previous = document.activeElement as HTMLElement | null
        stack.push(layer); isolate()
        const observer = new MutationObserver(isolate)
        observer.observe(document.body, { childList: true })
        const elements = (): HTMLElement[] => Array.from(root.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,a[href],[tabindex="0"]') ?? []).filter(element => !element.matches(':disabled') && element.getClientRects().length > 0 && element.tabIndex >= 0)
        ;(elements().find(el => el.matches('input:not([type=checkbox]),textarea')) ?? elements()[0] ?? root.current)?.focus()
        const key = (event: KeyboardEvent): void => {
            if (stack.at(-1) !== layer || event.defaultPrevented) return
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation()
                if (!latest.current.closeDisabled) latest.current.onClose()
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
                // A reader/library search must not steal focus from an open dialog.
                event.preventDefault(); event.stopPropagation()
            } else if (event.key === 'Tab') {
                const list = elements(), first = list[0], last = list.at(-1)
                if (!first) { event.preventDefault(); root.current?.focus() }
                else if (!root.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                    event.preventDefault(); (event.shiftKey ? last : first)?.focus()
                }
            }
        }
        const focus = (event: FocusEvent): void => {
            if (stack.at(-1) === layer && !layer.contains(event.target as Node)) (elements()[0] ?? root.current)?.focus()
        }
        document.addEventListener('keydown', key)
        document.addEventListener('focusin', focus)
        return () => {
            observer.disconnect(); document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus)
            stack.splice(stack.indexOf(layer), 1); isolate()
            if (previous?.isConnected && !previous.closest('[inert]')) previous.focus()
        }
    }, [])
    return createPortal(<div ref={backdrop} className="modal-backdrop"><div ref={root} tabIndex={-1} className={"modal m3-dialog "+className} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal__header"><h2 id={titleId}>{title}</h2><button type="button" className="btn" onClick={onClose} disabled={closeDisabled} aria-label={ui("关闭")}>{ui("关闭")}</button></div><div className="modal__body">{children}</div>{footer && <div className="modal__footer">{footer}</div>}</div></div>, document.body)
}
