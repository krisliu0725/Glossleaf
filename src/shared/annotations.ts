import type {Annotation,PdfAnchor,TranslationResult} from './m3'
export const PALETTES=[
 {id:'porcelain',zh:'宋瓷',en:'Song Porcelain',description:'釉色温润，清淡而分明。',names:['天青','缃黄','胭脂','豆绿','花青','赭红'],english:['Celadon','Amber','Rose','Bean Green','Indigo','Clay'],colors:['#549C9A','#DEA85B','#BC6368','#939F71','#6B7EAA','#9E887F']},
 {id:'dunhuang',zh:'敦煌',en:'Dunhuang',description:'取意壁画中的矿物色。',names:['丹砂','石青','石绿','土黄','绛紫','赭石'],english:['Cinnabar','Azurite','Malachite','Ochre','Plum','Sienna'],colors:['#CC5F5B','#6A869B','#739A77','#BCA047','#8C6F91','#B38B72']},
 {id:'woodland',zh:'山林',en:'Woodland',description:'山色与草木，沉静自然。',names:['松绿','苔黄','枫赭','山岚','紫藤','枯木'],english:['Pine','Moss','Maple','Mist','Wisteria','Driftwood'],colors:['#5A8A73','#ADB66F','#BE745C','#6C8AA0','#AC8AA4','#BBA890']},
 {id:'silk',zh:'绢本',en:'Silk',description:'柔和轻盈，如绢上设色。',names:['胭脂','花青','藤黄','竹青','藕荷','赭粉'],english:['Rose','Blue','Gamboge','Bamboo','Lotus','Terracotta'],colors:['#C66882','#5F93A9','#D8B469','#7D9670','#9A8EA8','#B1785C']},
 {id:'autumn',zh:'秋山',en:'Autumn Hills',description:'秋叶与远山，温暖有层次。',names:['柿红','桂黄','茶绿','远山','烟紫','栗褐'],english:['Persimmon','Osmanthus','Tea','Distant Blue','Mauve','Chestnut'],colors:['#CA6B4D','#D1AA55','#819767','#5A7A91','#A57591','#897461']},
 {id:'study',zh:'书斋',en:'Study',description:'纸墨之间的古雅色调。',names:['朱砂','青玉','米黄','青灰','檀褐','雾紫'],english:['Vermilion','Jade','Parchment','Slate','Sandalwood','Lilac'],colors:['#BC6665','#708C7D','#BCA75F','#6B8FB6','#8F7461','#A68FAF']},
 {id:'moonlight',zh:'月夜',en:'Moonlight',description:'月下低饱和的冷暖相映。',names:['黛蓝','月紫','晓青','琥珀','烟霞','苍青'],english:['Night Blue','Moon Violet','Sage','Amber','Dusk','Sea Glass'],colors:['#7C87A7','#A981AB','#A6B192','#D6AC75','#AA7D73','#6B9CA4']}
]as const
export type PaletteId=typeof PALETTES[number]['id']
export interface PaletteSettings{paletteId:PaletteId;opacity:number;recentSlot:number}
export const DEFAULT_PALETTE:PaletteSettings={paletteId:'porcelain',opacity:.4,recentSlot:1}
export const palette=(id:string)=>PALETTES.find(p=>p.id===id)??PALETTES[0]
export interface AnnotationDraft{markStyle?:'highlight'|'underline';translation?:TranslationResult;documentVersionId:string;type:'highlight'|'excerpt'|'note';anchors:PdfAnchor[];quote:string;comment:string;color?:string;paletteId?:string;slot?:number|null;highlightId?:string|null;id?:string;revision?:number}
export function annotationDraft(a:Annotation):AnnotationDraft{return {markStyle:a.markStyle,id:a.id,documentVersionId:a.documentVersionId,type:a.type as AnnotationDraft['type'],quote:a.quote,comment:a.comment,anchors:a.anchors,color:a.color,paletteId:a.paletteId,slot:a.slot,highlightId:a.highlightId,revision:a.revision}}
export function orderAnnotations(a:Annotation,b:Annotation):number{const x=a.anchors[0],y=b.anchors[0];return (x?.pageIndex??0)-(y?.pageIndex??0)||(x?.orderKey??-(x?.rects[0]?.[3]??0))-(y?.orderKey??-(y?.rects[0]?.[3]??0))||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)}
export function containsAnchors(outer:PdfAnchor[],inner:PdfAnchor[]):boolean{return inner.length>0&&inner.every(a=>a.kind!=='point'&&a.rects.every(r=>outer.some(b=>a.pageIndex===b.pageIndex&&b.rects.some(c=>c[0]<=r[0]+1&&c[1]<=r[1]+1&&c[2]>=r[2]-1&&c[3]>=r[3]-1))))}
export function stackAnnotations(a:Annotation,b:Annotation):number{return a.createdAt.localeCompare(b.createdAt)||(a.stackOrder??0)-(b.stackOrder??0)}
export function groupMarkers<T extends {top:number}>(items:T[],distance=24):T[][]{const groups:T[][]=[];for(const item of [...items].sort((a,b)=>a.top-b.top)){const last=groups.at(-1);if(last&&item.top-last[0].top<distance)last.push(item);else groups.push([item])}return groups}
export function projectAnnotations(rows:Annotation[],filter:'all'|'excerpts'|'notes'='all'){
 const highlights=rows.filter(a=>a.type==='highlight'||a.type==='excerpt'),notes=rows.filter(a=>a.type==='note'),parents=new Set(highlights.map(a=>a.id));
 const base=filter==='notes'?notes:filter==='excerpts'?highlights:[...highlights,...notes.filter(a=>!a.highlightId||!parents.has(a.highlightId))];
 return base.sort(orderAnnotations).map(annotation=>({annotation,notes:annotation.type==='note'?[]:notes.filter(n=>n.highlightId===annotation.id)}))
}
export function notesMarkdown(title:string,meta:string,rows:Annotation[],english=false,options:{labels?:string[];includeQuotes?:boolean}={}):string{
 const label=(a:Annotation)=>{const p=palette(a.paletteId??'');return a.paletteId==='zotero'?'Zotero · '+a.color:a.slot?(english?p.en:p.zh)+' · '+(english?'Slot ':'槽 ')+a.slot+' '+(english?p.english:p.names)[a.slot-1]:(english?'Original colour':'原色')+' '+a.color}
 const lines=['# '+title,meta,(english?'Exported ':'导出于 ')+new Date().toLocaleDateString('sv-SE')+' · 笺 Glossleaf',''];let page=-1
 for(const {annotation:a,notes} of projectAnnotations(rows)){const n=a.anchors[0]?.pageIndex??0;if(n!==page){page=n;lines.push('## '+(english?'Page ':'第 ')+(options.labels?.[n]??a.anchors[0]?.pageLabel??String(n+1))+(english?'':' 页')+(options.labels?.[n]&&options.labels[n]!==String(n+1)?' (PDF '+(n+1)+')':''),'')};if(a.quote&&options.includeQuotes!==false)lines.push(...a.quote.split('\n').map(s=>'> '+s),'');if(a.translation)lines.push(...a.translation.split('\n').map(s=>'> '+s),'');for(const note of a.type==='note'?[a]:notes)if(note.comment)lines.push('**'+(english?'Note:':'批：')+'** '+note.comment,'');if(a.type!=='note')lines.push('`'+label(a)+'`','')}
 return lines.join('\n')
}
