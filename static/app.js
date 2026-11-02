const $ = (selector) => document.querySelector(selector);
let records = [], fileId = '', uploading = false, currentDetail = null;
const form = $('#protocol-form');
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Intl.DateTimeFormat('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
const dateTime = value => new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]).join('');
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').hidden=true,4500); }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Falha na solicitação.'); return body; }
function filtered() {
  const search = $('#search').value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return records.filter(row => {
    const text = [row.name,row.company,row.number,row.role,row.registration].join(' ').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const received = new Date(row.created_at);
    const month = `${received.getFullYear()}-${String(received.getMonth()+1).padStart(2,'0')}`;
    return text.includes(search) && (!$('#company-filter').value || row.company === $('#company-filter').value) && (!$('#date-filter').value || month === $('#date-filter').value);
  });
}
function render() {
  const rows = filtered();
  $('#rows').innerHTML = rows.map(row=>`<tr><td><button class="protocol-link" data-detail="${row.id}">${escapeHTML(row.number)}</button><small>Período: ${escapeHTML(row.period)}</small></td><td><div class="employee"><span class="avatar">${escapeHTML(initials(row.name))}</span><div><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.role)}</small></div></div></td><td><span class="company-name">${escapeHTML(row.company)}</span></td><td>${date(row.created_at)}<small>por ${escapeHTML(row.received_by)}</small></td><td><span class="badge"><span>●</span> Recebido</span></td><td><button class="row-action" data-detail="${row.id}" aria-label="Ver protocolo ${escapeHTML(row.number)}">↗</button></td></tr>`).join('');
  $('#empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('#empty h3').textContent = records.length ? 'Nenhum resultado encontrado.' : 'Um lugar para cada folha.';
    $('#empty p').textContent = records.length ? 'Tente outro nome, empresa ou mês de recebimento.' : 'Importe seu primeiro cartão ponto ou registre um protocolo manualmente.';
    $('#empty-import').hidden = records.length > 0;
  }
  $('#list-count').textContent = records.length;
  $('#shown-count').textContent = `Exibindo ${rows.length} de ${records.length} protocolo${records.length === 1 ? '' : 's'}`;
  $('#clear-filters').hidden = !($('#search').value || $('#company-filter').value || $('#date-filter').value);
}
async function refresh() {
  records = await request('/api/protocols');
  const now = new Date();
  $('#total').textContent=records.length;
  $('#nav-count').textContent=records.length;
  $('#month').textContent=records.filter(row=> {const d=new Date(row.created_at); return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();}).length;
  $('#month-label').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(now);
  const companies=[...new Set(records.map(r=>r.company))].sort();
  $('#companies').textContent=companies.length;
  const selected=$('#company-filter').value;
  $('#company-filter').innerHTML='<option value="">Todas as empresas</option>'+companies.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  $('#company-filter').value=selected;
  render();
}
function openEditor(importFile=false) {
  if (uploading) return;
  form.reset(); fileId=''; $('#extract-status').textContent=''; $('#form-error').textContent=''; $('#file-label').textContent='Importar cartão ponto em PDF';
  $('#editor').showModal();
  if (importFile) $('#pdf').click();
}
['#new-protocol','#side-new'].forEach(id=>$(id).addEventListener('click',()=>openEditor()));
['#import-main','#empty-import'].forEach(id=>$(id).addEventListener('click',()=>openEditor(true)));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if (!uploading && !$('#save').disabled) document.getElementById(button.dataset.close).close();}));
$('#editor').addEventListener('cancel', event=>{if(uploading || $('#save').disabled) event.preventDefault();});
$('#pdf').addEventListener('change',async event=>{
  const file=event.target.files[0]; if(!file)return;
  if(file.size>20*1024*1024){$('#extract-status').textContent='O arquivo deve ter até 20 MB.';event.target.value='';return;}
  const body=new FormData();body.append('file',file);
  uploading=true;$('#save').disabled=true;$('#pdf').disabled=true;$('#extract-status').textContent='Lendo o PDF e identificando os campos…';fileId='';
  try {
    const result=await request('/api/extract',{method:'POST',body});
    for(const [key,value] of Object.entries(result.fields))form.elements[key].value=value;
    fileId=result.file_id;$('#file-label').textContent=file.name;
    $('#extract-status').textContent=result.warning || 'Dados extraídos. Confira os campos abaixo antes de registrar.';
  }catch(error){$('#extract-status').textContent=error.message;$('#file-label').textContent='Importar cartão ponto em PDF';}
  finally{uploading=false;$('#save').disabled=false;$('#pdf').disabled=false;}
});
form.addEventListener('submit',async event=>{
  event.preventDefault(); if(uploading)return;
  $('#form-error').textContent='';$('#save').disabled=true;$('#save').textContent='Registrando…';
  try {
    const body=Object.fromEntries(new FormData(form));delete body.file;body.file_id=fileId;
    const row=await request('/api/protocols',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    $('#editor').close();
    // Remove filters so a newly registered document is immediately visible.
    $('#search').value='';$('#company-filter').value='';$('#date-filter').value='';
    try {await refresh();} catch {toast('Protocolo registrado. Recarregue a página para atualizar a lista.');return;}
    showDetail(row);toast('Protocolo registrado com sucesso.');
  }catch(error){$('#form-error').textContent=error.message;}
  finally{$('#save').disabled=false;$('#save').textContent='Registrar protocolo';}
});
function receipt(row) {
  return `<div class="receipt-brand">folha.</div><p class="receipt-kicker">PROTOCOLO DE RECEBIMENTO DE FOLHA</p><h2>${escapeHTML(row.number)}</h2><p class="receipt-intro">Registramos o recebimento da folha do colaborador identificado abaixo.</p><dl>${[['Colaborador',row.name],['Empresa',row.company],['Função / cargo',row.role],['Matrícula',row.registration || 'Não informada'],['Período da folha',row.period],['Recebido em',dateTime(row.created_at)],['Recebido por',row.received_by],['Observações',row.notes || 'Sem observações']].map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl><p class="receipt-disclaimer">Este comprovante registra o recebimento do documento e não substitui o cartão ponto original.</p>`;
}
function showDetail(row) {
  currentDetail=row;$('#detail-title').textContent=row.number;
  $('#detail-body').innerHTML=receipt(row)+(row.file_id?`<a class="attachment-link" href="/api/files/${encodeURIComponent(row.file_id)}" target="_blank" rel="noopener">↗ Abrir folha PDF anexada</a>`:'<p class="form-note">Registro manual · sem PDF anexado</p>');
  $('#details').showModal();
}
$('#rows').addEventListener('click',event=>{const button=event.target.closest('[data-detail]');if(button){const row=records.find(r=>r.id===Number(button.dataset.detail));if(row)showDetail(row);}});
$('#print').addEventListener('click',()=>{if(currentDetail){$('#print-area').innerHTML=receipt(currentDetail)+'<div class="signature">Assinatura do responsável pelo recebimento</div>';window.print();}});
['#search','#company-filter','#date-filter'].forEach(id=>$(id).addEventListener('input',render));
$('#clear-filters').addEventListener('click',()=>{$('#search').value='';$('#company-filter').value='';$('#date-filter').value='';render();});
$('#export').addEventListener('click',()=>{
  const rows=filtered();if(!rows.length){toast('Não há protocolos para exportar.');return;}
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const keys=['number','name','company','role','registration','period','received_by','created_at','notes'];
  const csv=[['Protocolo','Colaborador','Empresa','Função','Matrícula','Período','Recebido por','Recebido em','Observações'],...rows.map(row=>keys.map(key=>key==='created_at'?dateTime(row[key]):row[key]))].map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='protocolos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Exportação concluída.');
});
refresh().catch(()=>{ $('#empty h3').textContent='Não foi possível carregar os protocolos.';$('#empty p').textContent='Verifique o servidor e recarregue a página.';toast('Falha ao conectar ao servidor.'); });
