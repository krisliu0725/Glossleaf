import { createElement, useMemo } from 'react';
const allowed = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'sub', 'sup']);
const forbidden = new Set(['script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math', 'form', 'input', 'button', 'video', 'audio', 'link', 'meta']);
export default function ImportedNote({ html, fallback }: {
    html?: string | null;
    fallback: string;
}): React.ReactElement {
    const contents = useMemo(() => {
        if (!html)
            return fallback;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const walk = (node: Node, key: string): React.ReactNode => {
            if (node.nodeType === Node.TEXT_NODE)
                return node.textContent;
            if (node.nodeType !== Node.ELEMENT_NODE)
                return null;
            const tag = (node as Element).tagName.toLowerCase();
            if (forbidden.has(tag))
                return null;
            const children = Array.from(node.childNodes).map((n, i) => walk(n, `${key}-${i}`));
            if (!allowed.has(tag))
                return children;
            // Attributes, links, CSS, event handlers and external resources are never copied.
            return createElement(tag, { key }, ...children);
        };
        return Array.from(doc.body.childNodes).map((n, i) => walk(n, String(i)));
    }, [html, fallback]);
    return <div className="imported-note">{contents}</div>;
}
