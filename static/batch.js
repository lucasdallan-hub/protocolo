let batchEntries = [], batchBusy = false;
const batchLabels = {name:'Nome do colaborador *',company:'Empresa *',role:'Função / cargo *',registration:'Matrícula',period:'Período da folha *'};
function batchCanClose(){return !batchBusy;}
function closeBatch(){if(batchCanClose())$('#batch').close();}
$('#batch-close').addEventListener('click',closeBatch);
$('#batch-cancel').addEventListener('click',closeBatch);
$('#batch').addEventListener('cancel',event=>{if(batchBusy)event.preventDefault();});
function setBatchBusy(value){
  batchBusy=value;uploading=value;
  $('#batch-save').disabled=value;$('#batch-close').disabled=value;$('#batch-cancel').disabled=value;
  $('#batch-responsible').disabled=value;
}
function appendBatchEntry(entry){
  const index=batchEntries.push(entry)-1;
  const card=document.createElement('article');card.className='batch-card';card.dataset.index=index;
  card.innerHTML=`<div class="batch-card-head"><label><input type="checkbox" class="batch-check" checked aria-label="Incluir esta folha"><strong>${escapeHTML(entry.filename)}</strong></label><small>Página(s): ${entry.pages.join(', ')}</small></div><div class="form-grid">${Object.entries(batchLabels).map(([key,label])=>`<label class="${key==='name'||key==='company'||key==='period'?'full':''}">${label}<input data-field="${key}" maxlength="300" ${key!=='registration'?'required':''} value="${escapeHTML(entry.fields[key])}"></label>`).join('')}</div><p class="batch-card-status" role="status">${Object.entries(entry.fields).some(([key,value])=>key!=='registration'&&!value)?'Complete os campos que não foram identificados.':'Dados extraídos. Confira antes de registrar.'}</p>`;
  card.querySelector('.batch-check').addEventListener('change',event=>{card.querySelectorAll('[data-field]').forEach(input=>input.disabled=!event.target.checked);});
  $('#batch-items').append(card);
}
$('#pdf').addEventListener('change',async event=>{
  const files=Array.from(event.target.files||[]);if(!files.length)return;
  $('#editor').close();batchEntries=[];$('#batch-items').replaceChildren();$('#batch-error').textContent='';$('#batch-responsible').value='';
  $('#batch').showModal();setBatchBusy(true);$('#batch-progress').max=files.length;$('#batch-progress').value=0;
  let successes=0,failures=0,pages=0;
  try{
    for(const [index,file] of files.entries()){
      $('#batch-status').textContent=`Lendo arquivo ${index+1} de ${files.length}: ${file.name}`;
      try{
        const body=new FormData();body.append('file',file);
        const result=await request('/api/extract',{method:'POST',body,onProgress:(page,total)=>{$('#batch-status').textContent=`Arquivo ${index+1}/${files.length} · página ${page}/${total} · ${file.name}`;}});
        result.entries.forEach(entry=>appendBatchEntry({...entry,filename:file.name}));
        successes++;pages+=result.pageCount;
      }catch(error){
        failures++;const card=document.createElement('article');card.className='batch-card batch-card-error';
        card.innerHTML=`<strong>${escapeHTML(file.name)}</strong><p class="error">${escapeHTML(error.message)}</p><p>Os outros arquivos continuam sendo processados. Reenvie este PDF em uma nova importação após corrigir o problema.</p>`;$('#batch-items').append(card);
      }
      $('#batch-progress').value=index+1;
    }
    $('#batch-status').textContent=`Leitura concluída: ${successes} PDF(s), ${pages} página(s), ${batchEntries.length} folha(s) para conferir${failures?`; ${failures} arquivo(s) com erro`:''}.`;
  }finally{
    setBatchBusy(false);$('#batch-save').disabled=!batchEntries.length;event.target.value='';
  }
});
$('#batch-form').addEventListener('submit',async event=>{
  event.preventDefault();if(batchBusy)return;
  const selected=Array.from($('#batch-items').querySelectorAll('[data-index]')).filter(card=>!card.dataset.saved&&card.querySelector('.batch-check').checked);
  if(!selected.length){$('#batch-error').textContent='Selecione ao menos uma folha ainda não registrada.';return;}
  const responsible=$('#batch-responsible').value.trim();if(!responsible){$('#batch-error').textContent='Informe quem recebeu as folhas.';return;}
  $('#batch-error').textContent='';setBatchBusy(true);let saved=0,failed=0;
  // Freeze selection and edits while the batch is being committed.
  $('#batch-items').querySelectorAll('input').forEach(input=>input.disabled=true);
  try{
    for(const [index,card] of selected.entries()){
      const entry=batchEntries[Number(card.dataset.index)];const fields={};card.querySelectorAll('[data-field]').forEach(input=>fields[input.dataset.field]=input.value.trim());
      $('#batch-status').textContent=`Registrando ${index+1} de ${selected.length}…`;
      try{
        const row=await request('/api/protocols',{method:'POST',body:JSON.stringify({...fields,received_by:responsible,file_id:entry.file_id,notes:`Importação em lote: ${entry.filename} · páginas ${entry.pages.join(', ')}.`})});
        card.dataset.saved='true';card.classList.add('batch-saved');card.querySelector('.batch-card-status').textContent=`Registrado: ${row.number}`;saved++;
      }catch(error){failed++;card.querySelector('.batch-card-status').textContent=error.message;}
    }
    $('#search').value='';$('#company-filter').value='';$('#date-filter').value='';
    try{await refresh();}catch{toast('Registros salvos. Recarregue para atualizar o histórico.');}
    $('#batch-status').textContent=`${saved} protocolo(s) registrado(s)${failed?`; ${failed} falha(s). Corrija e tente novamente somente os pendentes`:'. Os registros já estão no histórico.'}`;
    toast(`${saved} protocolo(s) registrado(s).`);
  }finally{
    setBatchBusy(false);
    $('#batch-items').querySelectorAll('[data-index]').forEach(card=>{const check=card.querySelector('.batch-check');check.disabled=!!card.dataset.saved;card.querySelectorAll('[data-field]').forEach(input=>input.disabled=!!card.dataset.saved||!check.checked);});
    $('#batch-save').disabled=!Array.from($('#batch-items').querySelectorAll('[data-index]')).some(card=>!card.dataset.saved);
  }
});
