import { ui } from '../i18n'
import { useEffect, useState } from 'react';
import type { GlossaryEntry } from '@shared/m3';
import Dialog from './Dialog';
export default function GlossaryDialog({ itemId, initial, onClose }: {
    itemId: string | null;
    initial?: {
        source: string;
        target: string;
    };
    onClose: () => void;
}): React.ReactElement {
    const [terms, setTerms] = useState<GlossaryEntry[]>([]), [source, setSource] = useState(initial?.source ?? ''), [target, setTarget] = useState(initial?.target ?? ''), [scoped, setScoped] = useState(false), [editing, setEditing] = useState<string | undefined>(), [error, setError] = useState('');
    async function load(): Promise<void> { const r = await window.jian.m3.glossary(itemId); if (r.ok)
        setTerms(r.data);
    else
        setError(r.error.message); }
    useEffect(() => { void load(); }, [itemId]);
    return <Dialog title={ui("术语表")} onClose={onClose}><form className="m3-form" onSubmit={e => { e.preventDefault(); void (async () => { const r = await window.jian.m3.saveTerm({ id: editing, source, target, itemId: scoped ? itemId : null }); if (r.ok) {
        setSource('');
        setTarget('');
        setEditing(undefined);
        setError(ui("术语已保存；现有译文保留，重译后生效"));
        await load();
    }
    else
        setError(r.error.message); })(); }}>
  <label>{ui("原文")}<input value={source} maxLength={200} required onChange={e => setSource(e.target.value)}/></label><label>{ui("译法")}<input value={target} maxLength={500} required onChange={e => setTarget(e.target.value)}/></label>
  {itemId && <label className="m3-checkbox"><input type="checkbox" checked={scoped} onChange={e => setScoped(e.target.checked)}/>{ui("仅用于当前文献（优先于文库术语）")}</label>}
  <button className="btn btn--primary" type="submit">{ui("加入术语")}</button></form><p role="status">{ui(error)}</p>
  <div className="term-list">{terms.length ? terms.map(t => <div key={t.id}><span>{t.source} → {t.target}<small>{t.scope === 'item' ? ui("当前文献") : ui("文库")}</small></span><button type="button" className="btn" onClick={() => { setEditing(t.id); setSource(t.source); setTarget(t.target); setScoped(t.scope === 'item'); }}>{ui("编辑")}</button><button type="button" className="btn" onClick={() => void window.jian.m3.deleteTerm(t.id).then(r => { if (!r.ok)
        setError(r.error.message);
    else
        void load(); })}>{ui("移除")}</button></div>) : <p className="m3-muted">{ui("保存常用术语，让同一概念保持一致译法。")}</p>}</div>
 </Dialog>;
}
