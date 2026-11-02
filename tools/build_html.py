from pathlib import Path
import argparse,base64,re
root=Path(__file__).resolve().parent.parent/'static'
parser=argparse.ArgumentParser(description='Gerar o sistema Folha')
parser.add_argument('--output',type=Path,default=root.parent/'docs/index.html')
parser.add_argument('--cloud',action='store_true',help='Login e dados compartilhados via Netlify/Supabase')
args=parser.parse_args()
html=(root/'index.html').read_text()
css=(root/'style.css').read_text()
app=(root/'app.js').read_text()
adapter=r'''
let browserDatabase;
function localDatabase(){
 if(!browserDatabase) browserDatabase=new Promise((resolve,reject)=>{
  const opening=indexedDB.open('folha-protocolos-offline',1);
  opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('protocols',{keyPath:'id',autoIncrement:true});db.createObjectStore('files',{keyPath:'id'});};
  opening.onsuccess=()=>resolve(opening.result);
  opening.onerror=()=>reject(new Error('O navegador não permitiu salvar os dados. Use uma janela normal e habilite o armazenamento local.'));
 });
 return browserDatabase;
}
async function localStore(store,mode,action){
 const db=await localDatabase();return new Promise((resolve,reject)=>{
  const transaction=db.transaction(store,mode);let result;
  transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(new Error('Não foi possível salvar. Verifique o espaço disponível no navegador.'));
  action(transaction.objectStore(store),value=>result=value);
 });
}
async function request(url,options={}){
 if(url==='/api/protocols'&&!options.method)return localStore('protocols','readonly',(store,done)=>{store.getAll().onsuccess=e=>done(e.target.result.reverse());});
 if(url==='/api/protocols'){
  const row=JSON.parse(options.body);for(const field of ['name','company','role','period','received_by'])if(!String(row[field]||'').trim())throw new Error('Preencha os campos obrigatórios.');
  row.created_at=new Date().toISOString();
  return localStore('protocols','readwrite',(store,done)=>{const addition=store.add(row);addition.onsuccess=()=>{row.id=addition.result;row.number=`PRO-${new Date().getFullYear()}-${String(row.id).padStart(5,'0')}`;store.put(row);done(row);};});
 }
 if(url==='/api/extract'){
  const file=options.body.get('file');if(!file||file.size>20*1024*1024)throw new Error('Envie um PDF de até 20 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Selecione um arquivo PDF válido.');
  let doc;try{doc=await pdfjsLib.getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:true}).promise;}catch{throw new Error('Não foi possível ler o PDF. Verifique se está protegido ou corrompido.');}
  let pages=[];
  try{
   for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
    const page=await doc.getPage(pageNumber);const content=await page.getTextContent();const groups=[];
    for(const item of content.items){if(!item.str)continue;const y=item.transform[5];let group=groups.find(g=>Math.abs(g.y-y)<3);if(!group){group={y,items:[]};groups.push(group);}group.items.push({x:item.transform[4],text:item.str});}
    groups.sort((a,b)=>b.y-a.y);pages.push(groups.map(g=>g.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join('  ')));
    if(options.onProgress)options.onProgress(pageNumber,doc.numPages);
   }
  }finally{await doc.destroy();}
  const labels='Empresa|CNPJ|Colaborador|Matrícula|CPF|PIS|Cliente|Cargo|Escala|Período|Posto';
  const entries=[];
  for(const [index,lines] of pages.entries()){
  const values={};
  const pattern=new RegExp('('+labels+'):\\s*(.*?)(?=\\s+(?:'+labels+'):|$)','g');
  for(const line of lines){for(const match of line.matchAll(pattern)){if(!values[match[1]])values[match[1]]=match[2].trim();}}
  const fields={name:values.Colaborador||'',company:values.Empresa||'',role:values.Cargo||'',registration:values['Matrícula']||'',period:values['Período']||''};
  if(Object.values(fields).some(Boolean)){
   const key=JSON.stringify([fields.name,fields.company,fields.registration,fields.period]);
   const existing=entries.find(e=>e.key===key);
   if(existing){existing.pages.push(index+1);for(const k of Object.keys(fields))if(!existing.fields[k])existing.fields[k]=fields[k];}
   else entries.push({key,fields,pages:[index+1]});
  }
  }
  if(!entries.length)entries.push({fields:{name:'',company:'',role:'',registration:'',period:''},pages:pages.map((_,i)=>i+1)});
  const file_id=crypto.randomUUID().replaceAll('-','');
  await localStore('files','readwrite',(store,done)=>{store.put({id:file_id,blob:file,name:file.name});done(true);});
  return {entries:entries.map(entry=>({...entry,file_id})),file_id,pageCount:pages.length};
 }
 throw new Error('Operação indisponível.');
}
document.addEventListener('click',async event=>{
 const link=event.target.closest('.attachment-link');if(!link)return;
 event.preventDefault();const id=link.getAttribute('href').split('/').pop();
 try{const stored=await localStore('files','readonly',(store,done)=>{store.get(id).onsuccess=e=>done(e.target.result);});if(!stored)throw new Error('Anexo não encontrado neste navegador.');
 const url=URL.createObjectURL(stored.blob);const a=document.createElement('a');a.href=url;a.download=stored.name||'folha.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){toast(error.message);}
});
'''
if args.cloud:
    # Reuse PDF parsing, but require authenticated storage and server-side records.
    extraction=adapter[adapter.index(" if(url==='/api/extract'){"):adapter.index("\n throw new Error('Operação indisponível.');")]
    extraction=extraction.replace("const file_id=crypto.randomUUID().replaceAll('-','');", "const ticket=await cloudRequest('/api/uploads',{method:'POST',body:JSON.stringify({size:file.size})}); const file_id=ticket.file_id;")
    extraction=extraction.replace("await localStore('files','readwrite',(store,done)=>{store.put({id:file_id,blob:file,name:file.name});done(true);});", "const sent=await fetch(ticket.url,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file}); if(!sent.ok)throw new Error('Não foi possível guardar o PDF. Tente novamente.');")
    adapter="async function request(url,options={}){\n"+extraction+"\n return cloudRequest(url,options);\n}\n"
app=re.sub(r'async function request\(url, options\) \{[^\n]+\}',lambda m:adapter,app,count=1)
app=app.replace('↗ Abrir folha PDF anexada','↓ Baixar folha PDF anexada')
start=app.index("$('#pdf').addEventListener('change'")
end=app.index("form.addEventListener('submit'",start)
app=app[:start]+app[end:]
if args.cloud:
    app=app[:app.rindex('refresh().catch')]
app+='\n'+(root/'batch.js').read_text()
html=html.replace('id="pdf" type="file"','id="pdf" type="file" multiple')
html=html.replace('Importar cartão ponto em PDF','Importar um ou vários PDFs')
html=html.replace('Até 20 MB · dados extraídos para conferência','Até 20 MB por PDF · selecione vários arquivos')
html=html.replace('Importar folha PDF','Importar PDFs')
html=html.replace('Importar primeira folha','Importar folhas')
html=html.replace('Imprime o cartão ponto','Importe os cartões ponto')
html=html.replace('</body>',(root/'batch.html').read_text()+'</body>')
css+='\n'+(root/'batch.css').read_text()
if args.cloud:
    html=html.replace('<body>','<body class="auth-pending">')
    html=html.replace('</body>',(root/'auth.html').read_text()+'</body>')
    old='<div class="user"><span class="user-avatar">DP</span><span>Área administrativa<small>Controle de documentos</small></span></div>'
    new='<div class="user"><span class="user-avatar" id="current-user-avatar"></span><span><span id="current-user-name"></span><small id="current-user-role"></small></span></div><div class="account-actions"><button class="text-button" id="users-open" hidden>Usuários</button><button class="text-button" id="password-open">Minha senha</button><button class="text-button" id="logout">Sair</button></div>'
    html=html.replace(old,new)
    html=html.replace('Armazenamento local','Dados da equipe').replace('Seus registros neste ambiente','Acesso com conta autorizada')
    app=app.replace("form.reset(); fileId=''", "form.reset(); form.elements.received_by.value=currentUser?.name||''; fileId=''")
    app=app.replace("$('#batch-responsible').value=''", "$('#batch-responsible').value=currentUser?.name||''")
    app+='\n'+(root/'auth.js').read_text()
    css+='\n'+(root/'auth.css').read_text()
html=html.replace('<link rel="stylesheet" href="/style.css">','<style>'+css+'</style>')
html=html.replace('<script src="/app.js" defer></script>','')
html=html.replace('href="/"','href="#"')
html=html.replace('Seus registros neste ambiente','Salvo somente neste navegador')
html=html.replace('Controle de documentos','Versão HTML · offline')
html=html.replace('Feito para simplificar o departamento pessoal.', 'Folhas e protocolos compartilhados com sua equipe.' if args.cloud else 'Dados salvos neste navegador. Exporte o CSV para guardar uma cópia dos registros.')
lib=(root.parent/'tools/vendor/pdf.min.js').read_text()
worker=base64.b64encode((root.parent/'tools/vendor/pdf.worker.min.js').read_bytes()).decode()
bootstrap="pdfjsLib.GlobalWorkerOptions.workerSrc=URL.createObjectURL(new Blob([Uint8Array.from(atob('"+worker+"'),c=>c.charCodeAt(0))],{type:'text/javascript'}));"
def script(text):return '<script>'+text.replace('</script','<\\/script')+'</script>'
html=html.replace('</body>',script(lib)+script(bootstrap)+script(app)+'</body>')
output=args.output
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(html,encoding='utf-8')
print('HTML gerado:',output,'—',output.stat().st_size,'bytes')
