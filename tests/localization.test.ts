import test from 'node:test'
import assert from 'node:assert/strict'
import { localize, uiCatalog } from '../src/shared/localization'
import { buildExport } from '../src/main/m4/exports'

test('English catalog preserves every interpolation slot and has no untranslated Chinese UI labels',()=>{
 for(const [key,value]of Object.entries(uiCatalog)){
  const slots=(s:string):string[]=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort()
  assert.deepEqual(slots(value),slots(key),key)
  if(key!=='中')assert.equal(/[\u3400-\u9fff]/.test(value),false,key)
 }
})
test('count-aware English copy handles one, zero and plural without rewriting user text',()=>{
 assert.equal(localize('{0} 个附件','en',[1]),'1 attachment')
 assert.equal(localize('{0} 个附件','en',[0]),'0 attachments')
 assert.equal(localize('已导入 {0} 个文件{1}','en',[2,'']),'Imported 2 files')
 const title='术语表 / 1 documents'
 assert.equal(localize('选择导出 {0}','en',[title]),'Select '+title+' for export')
})
test('language switching re-renders stored status values and keeps embedded source titles intact',()=>{
 const english=localize('已定位至第 {0} 页','en',[7])
 assert.equal(localize(english,'zh'),'已定位至第 7 页')
 assert.equal(localize('已定位至第 7 页','en'),'Moved to page 7')
 const warning=localize('「{0}」未记录日期。','en',['术语表'])
 assert.equal(warning,'“术语表” has no recorded date.')
 assert.equal(localize(warning,'zh'),'「术语表」未记录日期。')
})
test('structured validation errors become readable localized messages while unknown provider details remain intact',()=>{
 assert.equal(localize(JSON.stringify([{code:'custom',message:'作者姓名不能为空',path:['creators']}]),'en'),'Enter a contributor name')
 assert.equal(localize('Provider detail: RESOURCE_EXHAUSTED','en'),'Provider detail: RESOURCE_EXHAUSTED')
})
test('English reading exports adapt headings while preserving source metadata, quotes and notes',()=>{
 const item={id:'fixture',title:'术语表',creators:'测试作者',date:'2026',language:'zh',fields:{},creatorsList:[],type:'book'}
 const row={item,annotations:[{id:'a',documentVersionId:'doc',type:'excerpt',quote:'原文不要翻译',output:'译文不要改写',comment:'笔记保留',anchorsJson:JSON.stringify([{documentVersionId:'doc',pageIndex:0,rects:[[1,1,10,10]],exact:'原文不要翻译'}]),createdAt:'2026-10-29'}]}
 const result=buildExport([row] as never,'markdown','en')
 assert.ok(result.content.startsWith('# Glossleaf · Excerpts'))
 for(const text of ['术语表','测试作者','原文不要翻译','译文不要改写','笔记保留','Page 1','Comment:','Document ID:'])assert.ok(result.content.includes(text),text)
 assert.ok(result.warnings.every(w=>!w.includes('未记录')))
 assert.ok(buildExport([row] as never,'markdown','zh').content.startsWith('# 笺 · 阅读撷英'))
})
