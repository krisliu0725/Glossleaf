const {buildSync}=require('../node_modules/.pnpm/node_modules/esbuild')
const {mkdtempSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join}=require('node:path')
const {spawnSync}=require('node:child_process')
const dir=mkdtempSync(join(tmpdir(),'jian-m6-'))
try{const out=join(dir,'m6.cjs');buildSync({entryPoints:['tests/m6.test.ts'],bundle:true,platform:'node',format:'cjs',outfile:out,tsconfig:'tsconfig.json'});const r=spawnSync(process.execPath,['--test',out],{stdio:'inherit'});process.exitCode=r.status??1}finally{rmSync(dir,{recursive:true,force:true})}
