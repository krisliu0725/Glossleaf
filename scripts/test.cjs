const {buildSync}=require('../node_modules/.pnpm/node_modules/esbuild')
const {mkdtempSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join}=require('node:path')
const {spawnSync}=require('node:child_process')
const dir=mkdtempSync(join(tmpdir(),'jian-tests-'))
try{const out=join(dir,'m3.cjs');buildSync({entryPoints:['tests/index.ts'],bundle:true,platform:'node',format:'cjs',outfile:out,tsconfig:'tsconfig.json',loader:{'.csl':'text','.xml':'text'}});const r=spawnSync(process.execPath,['--test',out],{stdio:'inherit'});process.exitCode=r.status??1}finally{rmSync(dir,{recursive:true,force:true})}
