/* Backend Netlify: credenciais Supabase ficam apenas no servidor. */
const { randomUUID } = require('node:crypto');
const COOKIE = 'folha_session';
const REFRESH = 'folha_refresh';

function response(statusCode, body, extra = {}) {
  return {statusCode, headers: {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra},
    body:JSON.stringify(body)};
}
function failure(status, message) { return Object.assign(new Error(message), {status}); }
function jsonBody(event) {
  if ((event.body || '').length > 65536) throw failure(413,'Dados muito extensos.');
  try {const result=JSON.parse(event.body || '{}');if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}
  catch {throw failure(400,'Dados inválidos.');}
}
function text(value, limit=300) {
  if(typeof value!=='string'||value.length>limit)throw failure(400,'Campo inválido ou muito extenso.');
  return value.trim();
}
function publicUser(user) {
  return {id:user.id,email:user.email,name:user.user_metadata?.name || user.email,
    role:user.app_metadata?.role,active:user.app_metadata?.active!==false};
}
function allowedUser(user) {
  return user && ['admin','user'].includes(user.app_metadata?.role) && user.app_metadata?.active!==false;
}
function cookies(event) {
  return Object.fromEntries((event.headers?.cookie||'').split(';').map(v=>v.trim().split('=')).filter(v=>v.length===2));
}
function sessionCookies(session, logout=false) {
  const suffix='; Path=/api; HttpOnly; Secure; SameSite=Strict';
  return [COOKIE+'='+(logout?'':session.access_token)+'; Max-Age='+(logout?0:Math.min(session.expires_in||3600,3600))+suffix,
    REFRESH+'='+(logout?'':session.refresh_token)+'; Max-Age='+(logout?0:604800)+suffix];
}
function withCookies(result, values) {result.multiValueHeaders={'Set-Cookie':values};return result;}
function number(row) {
  return {...row,number:`PRO-${new Date(row.created_at).getFullYear()}-${String(row.id).padStart(5,'0')}`};
}

exports.handler = async event => {
  try {
    const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
    const anon=process.env.SUPABASE_ANON_KEY;
    const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!base||!anon||!service)throw failure(503,'Login ainda não configurado. O administrador precisa conectar o Supabase nas variáveis do Netlify.');
    const route=event.path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '')||'/';
    const method=event.httpMethod;
    // Browsers may only mutate through this site's origin. Cookies are Strict as well.
    const origin=event.headers?.origin;
    if(method!=='GET' && origin) {
      const host=event.headers?.host;
      if(new URL(origin).host!==host)throw failure(403,'Origem não autorizada.');
    }
    async function supa(path, {method='GET',body,token=service,key=service}={}) {
      let result;
      try {result=await fetch(base+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,
        'Content-Type':'application/json',Prefer:'return=representation'},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});}
      catch {throw failure(503,'Não foi possível conectar ao banco. Tente novamente.');}
      const payload=await result.json().catch(()=>null);
      if(!result.ok) {
        if(result.status===401||result.status===403)throw failure(401,'Sessão inválida ou credenciais incorretas.');
        if(result.status===422||result.status===400)throw failure(400,'Operação recusada. Confira os dados e se o email já está cadastrado.');
        throw failure(503,'Banco indisponível ou configuração incompleta. Confira o SQL de instalação.');
      }
      return payload;
    }
    if(route==='/auth/login' && method==='POST') {
      const body=jsonBody(event);const email=text(body.email).toLowerCase();
      if(typeof body.password!=='string'||body.password.length>200)throw failure(400,'Senha inválida.');
      const session=await supa('/auth/v1/token?grant_type=password',{method:'POST',key:anon,token:anon,body:{email,password:body.password}});
      if(!allowedUser(session.user))throw failure(403,'Conta sem autorização ou desativada. Fale com o administrador.');
      return withCookies(response(200,{user:publicUser(session.user)}),sessionCookies(session));
    }
    if(route==='/auth/logout' && method==='POST') {
      const token=cookies(event)[COOKIE];
      if(token)await supa('/auth/v1/logout',{method:'POST',key:anon,token}).catch(()=>{});
      return withCookies(response(200,{ok:true}),sessionCookies({},true));
    }
    let access=cookies(event)[COOKIE];let renewed=null;
    let user;
    if(access) {
      try {user=await supa('/auth/v1/user',{key:anon,token:access});}
      catch(error){if(error.status!==401)throw error;}
    }
    if(!user && cookies(event)[REFRESH]) {
      try {renewed=await supa('/auth/v1/token?grant_type=refresh_token',{method:'POST',key:anon,token:anon,
        body:{refresh_token:cookies(event)[REFRESH]}});user=renewed.user;access=renewed.access_token;}
      catch(error){if(error.status!==401&&error.status!==400)throw error;}
    }
    if(!user)throw failure(401,'Entre na sua conta para continuar.');
    if(!allowedUser(user))throw failure(403,'Conta sem autorização ou desativada.');
    const finish=result=>renewed?withCookies(result,sessionCookies(renewed)):result;
    if(route==='/auth/me' && method==='GET')return finish(response(200,{user:publicUser(user)}));
    if(route.startsWith('/users')) {
      if(user.app_metadata.role!=='admin')throw failure(403,'Somente administradores podem gerenciar usuários.');
      if(route==='/users' && method==='GET') {
        const page=Math.max(1,Math.min(10000,Number(event.queryStringParameters?.page)||1));
        const payload=await supa(`/auth/v1/admin/users?page=${page}&per_page=50`);
        return finish(response(200,{users:(payload.users||[]).filter(u=>['admin','user'].includes(u.app_metadata?.role)).map(publicUser),has_more:(payload.users||[]).length===50,page}));
      }
      if(route==='/users' && method==='POST') {
        const body=jsonBody(event);const name=text(body.name);const email=text(body.email).toLowerCase();
        if(!name||!/^\S+@\S+\.\S+$/.test(email)||typeof body.password!=='string'||body.password.length<10||body.password.length>200)throw failure(400,'Informe nome, email válido e senha com pelo menos 10 caracteres.');
        if(!['user','admin'].includes(body.role))throw failure(400,'Perfil inválido.');
        const result=await supa('/auth/v1/admin/users',{method:'POST',body:{email,password:body.password,email_confirm:true,
          user_metadata:{name},app_metadata:{role:body.role,active:true}}});
        return finish(response(201,{user:publicUser(result)}));
      }
      const match=route.match(/^\/users\/([a-f0-9-]{36})$/i);
      if(match && method==='PATCH') {
        const body=jsonBody(event);if(typeof body.active!=='boolean')throw failure(400,'Situação inválida.');
        const target=await supa('/auth/v1/admin/users/'+match[1]);
        if(target.app_metadata?.role==='admin')throw failure(400,'Administradores não podem ser desativados por esta tela.');
        if(target.app_metadata?.role!=='user')throw failure(400,'Usuário não pertence ao sistema.');
        const result=await supa('/auth/v1/admin/users/'+match[1],{method:'PUT',body:{app_metadata:{...target.app_metadata,active:body.active}}});
        return finish(response(200,{user:publicUser(result)}));
      }
    }
    if(route==='/auth/password' && method==='POST') {
      const body=jsonBody(event);
      if(typeof body.current_password!=='string'||body.current_password.length>200||typeof body.password!=='string'||body.password.length<10||body.password.length>200)throw failure(400,'Use uma nova senha de 10 a 200 caracteres.');
      await supa('/auth/v1/token?grant_type=password',{method:'POST',token:anon,key:anon,body:{email:user.email,password:body.current_password}});
      await supa('/auth/v1/user',{method:'PUT',token:access,key:anon,body:{password:body.password}});
      return finish(response(200,{ok:true}));
    }
    if(route==='/protocols' && method==='GET') {
      // Paginação interna evita truncar o histórico no limite padrão do PostgREST.
      const rows=[];
      for(let offset=0;;offset+=1000){const page=await supa(`/rest/v1/protocols?select=*&order=id.desc&limit=1000&offset=${offset}`);rows.push(...page);if(page.length<1000)break;}
      return finish(response(200,rows.map(number)));
    }
    if(route==='/protocols' && method==='POST') {
      const body=jsonBody(event);const record={};
      for(const field of ['name','company','role','registration','period','notes','file_id'])record[field]=text(body[field]??'',field==='notes'?2000:300);
      if(['name','company','role','period'].some(k=>!record[k]))throw failure(400,'Preencha os campos obrigatórios.');
      if(record.file_id&&!/^[a-f0-9]{32}$/.test(record.file_id))throw failure(400,'Anexo inválido.');
      record.received_by=publicUser(user).name;record.created_by=user.id;
      const result=await supa('/rest/v1/protocols',{method:'POST',body:record});
      return finish(response(201,number(result[0])));
    }
    if(route==='/uploads' && method==='POST') {
      const body=jsonBody(event);if(!Number.isInteger(body.size)||body.size<5||body.size>20971520)throw failure(400,'Envie um PDF de até 20 MB.');
      const id=randomUUID().replaceAll('-','');
      const signed=await supa('/storage/v1/object/upload/sign/folhas/'+id+'.pdf',{method:'POST',body:{}});
      const path=signed.url||signed.signedURL;
      if(!path)throw failure(503,'Não foi possível preparar o envio do PDF.');
      return finish(response(200,{file_id:id,url:base+'/storage/v1'+path}));
    }
    const file=route.match(/^\/files\/([a-f0-9]{32})$/);
    if(file && method==='GET') {
      const signed=await supa('/storage/v1/object/sign/folhas/'+file[1]+'.pdf',{method:'POST',body:{expiresIn:60}});
      return finish(response(302,{}, {Location:base+'/storage/v1'+signed.signedURL}));
    }
    return finish(response(404,{error:'Rota não encontrada.'}));
  }catch(error){return response(error.status||500,{error:error.status?error.message:'Não foi possível concluir. Tente novamente.'});}
};
