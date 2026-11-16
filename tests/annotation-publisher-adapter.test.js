import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
it('fails closed with setup instructions when no annotation checkout is configured',()=>{
 const env={...process.env};delete env.LIBRETEXTS_SOCIAL_ANNOTATION_ROOT;
 const r=spawnSync(process.execPath,[resolve('scripts/stage-annotations.mjs')],{env,encoding:'utf8'});
 expect(r.status).not.toBe(0);expect(r.stderr).toContain('Set LIBRETEXTS_SOCIAL_ANNOTATION_ROOT');
});
it('delegates to the explicitly configured checkout and preserves publisher arguments',()=>{
 const root=mkdtempSync(join(tmpdir(),'annotation checkout '));
 try{
  mkdirSync(join(root,'scripts'));const out=join(root,'observed.json');
  writeFileSync(join(root,'scripts/stage-annotations.mjs'),'import{writeFileSync}from"node:fs";writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));');
  const r=spawnSync(process.execPath,[resolve('scripts/stage-annotations.mjs'),out,'--stage','a stage','--catalog','a catalog'],{env:{...process.env,LIBRETEXTS_SOCIAL_ANNOTATION_ROOT:root},encoding:'utf8'});
  expect(r.status,r.stderr).toBe(0);expect(JSON.parse(readFileSync(out,'utf8'))).toEqual(['--stage','a stage','--catalog','a catalog']);
 }finally{rmSync(root,{recursive:true,force:true});}
});
