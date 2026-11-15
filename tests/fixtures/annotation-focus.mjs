
const {mountAnnotations}=await import('/_assets/reader/annotations.mjs');
const quote=document.querySelector('main p').textContent;
const manifest={schema:'social-reading-page-v1',normalization:'js-whitespace-v1',book:'fixture',page:'fixture',revision:'r1',blocks:[{block:'p-0',quote}]};
const stamp=document.createElement('script');stamp.id='sr-page-context';stamp.type='application/json';stamp.textContent=JSON.stringify(manifest);document.body.append(stamp);
const author='Alexandra Longname with several family names';
const anchor={...manifest,block:'p-0',quote,selector:{start:0,end:quote.length,quote}};
const fixture=[{id:'t1',author:'alice',name:author,text:'Which evidence supports cooperation here? Compare the examples before drawing a conclusion.',anchor,replies:[{id:'r1',author:'bob',name:'Sam Rivera',text:'I would start with the shared goals. '+ 'A longer reply keeps the explanation attached to its author. '.repeat(5)},{id:'r2',author:'instructor',name:'Morgan Chen',text:'Try linking that observation to the passage.'}]}];
const params=new URLSearchParams(location.search);
if(params.has('orphan'))fixture[0].orphan=true;
if(params.has('name-only')){
 delete fixture[0].author;
 delete fixture[0].replies[0].author;
 fixture[0].replies[0].name=author;
}
window.syntheticCommands=0;
const client={command:async()=>{window.syntheticCommands++;throw Error('Synthetic lost acknowledgment');},receipt:async()=>{throw Error('Synthetic receipt unavailable');},session:async()=>({id:'alice',name:author}),threads:async()=>new URLSearchParams(location.search).has('empty')?[]:fixture};
mountAnnotations({client});document.querySelector('#sr-entry').click();
