let currentUser=null, usersPage=1;
async function cloudRequest(url,options={}){
  const headers={...(options.headers||{})};
  if(options.body && typeof options.body==='string')headers['Content-Type']='application/json';
  let response;
  try{response=await fetch(url,{...options,headers,credentials:'same-origin'});}catch{throw new Error('Sem conexão. Verifique sua internet e tente novamente.');}
  const body=await response.json().catch(()=>({error:'Resposta inválida do servidor.'}));
  if(!response.ok){
    if((response.status===401||response.status===403)&&url!=='/api/auth/login'&&url!=='/api/users'){
      if(response.status===401||body.error?.includes('desativada'))showLogin();
    }
    throw new Error(body.error||'Não foi possível concluir.');
  }
  return body;
}
function showLogin(){
  currentUser=null;records=[];render();
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  document.body.classList.add('auth-pending');
  $('#users-open').hidden=true;
  $('#rows').replaceChildren();$('#detail-body').replaceChildren();$('#print-area').replaceChildren();
  $('#total').textContent='0';$('#month').textContent='0';$('#companies').textContent='0';
}
async function authenticated(user){
  currentUser=user;$('#current-user-name').textContent=user.name;
  $('#current-user-role').textContent=user.role==='admin'?'Administrador':'Protocolar folhas';
  $('#current-user-avatar').textContent=initials(user.name);
  $('#users-open').hidden=user.role!=='admin';document.body.classList.remove('auth-pending');
  form.elements.received_by.value=user.name;form.elements.received_by.readOnly=true;
  $('#batch-responsible').value=user.name;$('#batch-responsible').readOnly=true;
  try{await refresh();}catch(error){$('#empty h3').textContent='Não foi possível carregar os protocolos.';$('#empty p').textContent=error.message;toast(error.message);}
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#login-error').textContent='';$('#login-submit').disabled=true;
  const fields=event.target.elements;
  try{const result=await cloudRequest('/api/auth/login',{method:'POST',body:JSON.stringify({email:fields.email.value.trim(),password:fields.password.value})});fields.password.value='';await authenticated(result.user);}
  catch(error){$('#login-error').textContent=error.message;}
  finally{$('#login-submit').disabled=false;}
});
$('#logout').addEventListener('click',async()=>{
  $('#logout').disabled=true;
  try{await cloudRequest('/api/auth/logout',{method:'POST',body:'{}'});showLogin();$('#login-error').textContent='';}
  catch(error){toast(error.message);}
  finally{$('#logout').disabled=false;}
});
document.querySelectorAll('[data-auth-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.authClose).close()));
async function loadUsers(){
  $('#users-list').textContent='Carregando usuários…';
  $('#users-prev').disabled=true;$('#users-next').disabled=true;
  try{
    const result=await cloudRequest('/api/users?page='+usersPage);
    $('#users-list').innerHTML=result.users.map(user=>`<article class="user-row"><div><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.email)}</small><small>${user.role==='admin'?'Administrador':'Protocolar folhas'} · ${user.active?'Ativo':'Desativado'}</small></div>${user.role==='admin'?'<span class="badge">Administrador</span>':`<button class="secondary" data-user-id="${escapeHTML(user.id)}" data-active="${user.active?'false':'true'}">${user.active?'Desativar':'Reativar'}</button>`}</article>`).join('')||'<p class="form-note">Nenhum usuário nesta página.</p>';
    $('#users-prev').disabled=usersPage===1;$('#users-next').disabled=!result.has_more;$('#users-page-label').textContent='Página '+usersPage;
  }catch(error){$('#users-list').textContent=error.message;}
}
$('#users-open').addEventListener('click',()=>{if(currentUser?.role!=='admin')return;usersPage=1;$('#users-dialog').showModal();loadUsers();});
$('#users-prev').addEventListener('click',()=>{usersPage--;loadUsers();});
$('#users-next').addEventListener('click',()=>{usersPage++;loadUsers();});
$('#create-user-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#users-error').textContent='';$('#create-user-submit').disabled=true;
  try{const values=Object.fromEntries(new FormData(event.target));await cloudRequest('/api/users',{method:'POST',body:JSON.stringify(values)});event.target.reset();usersPage=1;await loadUsers();toast('Usuário criado. Ele já pode entrar com o email e a senha inicial.');}
  catch(error){$('#users-error').textContent=error.message;}
  finally{$('#create-user-submit').disabled=false;}
});
$('#users-list').addEventListener('click',async event=>{
  const button=event.target.closest('[data-user-id]');if(!button)return;button.disabled=true;$('#users-error').textContent='';
  try{await cloudRequest('/api/users/'+button.dataset.userId,{method:'PATCH',body:JSON.stringify({active:button.dataset.active==='true'})});await loadUsers();}
  catch(error){$('#users-error').textContent=error.message;button.disabled=false;}
});
$('#password-open').addEventListener('click',()=>{$('#password-form').reset();$('#password-error').textContent='';$('#password-dialog').showModal();});
$('#password-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#password-error').textContent='';const button=event.target.querySelector('[type=submit]');button.disabled=true;
  try{const values=Object.fromEntries(new FormData(event.target));if(values.password!==values.confirm)throw new Error('A confirmação não corresponde à nova senha.');delete values.confirm;await cloudRequest('/api/auth/password',{method:'POST',body:JSON.stringify(values)});event.target.reset();$('#password-dialog').close();toast('Senha alterada.');}
  catch(error){$('#password-error').textContent=error.message;}
  finally{button.disabled=false;}
});
cloudRequest('/api/auth/me').then(result=>authenticated(result.user)).catch(error=>{showLogin();if(!error.message.includes('Entre na sua conta'))$('#login-error').textContent=error.message;});
