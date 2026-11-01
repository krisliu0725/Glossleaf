import {test} from 'node:test'
import assert from 'node:assert/strict'
import {COLOR_SCHEME_IDS,COLOR_SCHEMES,colorScheme} from '../src/shared/appearance'
const luminance=(hex:string)=>{const a=hex.slice(1).match(/../g)!.map(v=>{const n=parseInt(v,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
const contrast=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test('every application palette keeps readable text and semantic accents on all its paper surfaces',()=>{
 assert.deepEqual(COLOR_SCHEMES.map(s=>s.id),[...COLOR_SCHEME_IDS]);assert.equal(new Set(COLOR_SCHEMES.map(s=>s.light.paper)).size,6)
 for(const s of COLOR_SCHEMES)for(const mode of ['light','dark']as const){const c=s[mode];for(const text of ['ink','secondary','muted','accent','teal','ochre']as const)for(const background of ['paper','raised','inset']as const)assert.ok(contrast(c[text],c[background])>=4.5,`${s.id} ${mode} ${text} / ${background}: ${contrast(c[text],c[background])}`)}
})
test('unknown and legacy palette settings fall back to paper; supported schemes retain their identity',()=>{assert.equal(colorScheme(undefined).id,'paper');assert.equal(colorScheme('invalid').id,'paper');for(const id of COLOR_SCHEME_IDS)assert.equal(colorScheme(id).id,id)})

import {readablePdf} from '../src/shared/reader-support'
test('reading chooses a ready PDF even when an EPUB is the first attachment',()=>{
 const epub={contentType:'application/epub+zip',activeVersionId:'epub'},pdf={contentType:'application/pdf',activeVersionId:'pdf'}
 assert.equal([epub,pdf].find(readablePdf)?.activeVersionId,'pdf');assert.equal(readablePdf(epub),false);assert.equal(readablePdf({...pdf,activeVersionId:null}),false)
})
