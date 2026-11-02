const {test,beforeEach,after} = require('node:test');
const assert = require('node:assert/strict');
const {handler} = require('./netlify/functions/api');
const originalFetch=global.fetch;
let user, calls, saved;
const userId='11111111-1111-1111-1111-111111111111';
function event(path,method='GET',body,authenticated=true){return {path:'/api'+path,httpMethod:method,
  headers:{host:'folha.example',origin:'https://folha.example',...(authenticated?{cookie:'folha_session=test-token'}:{})},
  body:body===undefined?null:JSON.stringify(body)};}
beforeEach(()=>{
  process.env.SUPABASE_URL='https://database.example';process.env.SUPABASE_ANON_KEY='test-public';process.env.SUPABASE_SERVICE_ROLE_KEY='test-private';
  user={id:userId,email:'admin@example.test',user_metadata:{name:'Administrador'},app_metadata:{role:'admin',active:true}};
  calls=[];saved=null;
  global.fetch=async(url,options)=>{
    calls.push({url,options});let result;
    if(url.endsWith('/auth/v1/user')&&options.method==='GET')result=user;
    else if(url.includes('/auth/v1/token?'))result={access_token:'access',refresh_token:'refresh',expires_in:3600,user};
    else if(url.endsWith('/auth/v1/logout'))result={};
    else if(url.includes('/auth/v1/admin/users?page='))result={users:[user]};
    else if(url.endsWith('/auth/v1/admin/users')&&options.method==='POST'){
      const body=JSON.parse(options.body);result={id:userId,...body};
    }else if(url.includes('/auth/v1/admin/users/')){
      result={id:'22222222-2222-2222-2222-222222222222',email:'user@example.test',app_metadata:{role:'user',active:true}};
      if(options.method==='PUT')result.app_metadata=JSON.parse(options.body).app_metadata;
    }else if(url.endsWith('/rest/v1/protocols')&&options.method==='POST'){
      saved=JSON.parse(options.body);result=[{...saved,id:1,created_at:'2026-11-02T20:00:00Z'}];
    }else if(url.includes('/rest/v1/protocols?'))result=[];
    else if(url.includes('/storage/v1/object/upload/sign/'))result={url:'/object/upload/sign/folhas/test.pdf?token=example'};
    else if(url.includes('/storage/v1/object/sign/'))result={signedURL:'/object/sign/folhas/test.pdf?token=example'};
    else throw new Error('Unexpected request: '+url);
    return {ok:true,status:200,json:async()=>result};
  };
});
after(()=>{global.fetch=originalFetch;});
test('anonymous users cannot read protocols, files or create records',async()=>{
  for(const path of ['/protocols','/files/'+'a'.repeat(32),'/users','/uploads']){
    const result=await handler(event(path,path==='/uploads'?'POST':'GET',undefined,false));
    assert.equal(result.statusCode,401,path);
  }
  assert.equal(calls.length,0);
});
test('login uses HttpOnly Secure Strict cookies and does not disclose tokens',async()=>{
  const result=await handler(event('/auth/login','POST',{email:user.email,password:'test-password'},false));
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).user.role,'admin');
  assert.equal(JSON.parse(result.body).access_token,undefined);
  for(const cookie of result.multiValueHeaders['Set-Cookie'])assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
});
test('ordinary user cannot create or list accounts even through direct requests',async()=>{
  user.app_metadata.role='user';
  for(const method of ['GET','POST'])assert.equal((await handler(event('/users',method,{}))).statusCode,403);
  assert.equal(calls.filter(c=>c.url.includes('/admin/')).length,0);
});
test('disabled account is denied despite a valid session',async()=>{
  user.app_metadata.active=false;
  assert.equal((await handler(event('/protocols'))).statusCode,403);
  assert.equal((await handler(event('/auth/login','POST',{email:user.email,password:'password'},false))).statusCode,403);
});
test('protocol author is the authenticated user, ignoring forged received_by',async()=>{
  user.app_metadata.role='user';
  const result=await handler(event('/protocols','POST',{name:'Ana',company:'Empresa',role:'Assistente',period:'Novembro',received_by:'Outra pessoa',created_by:'forged'}));
  assert.equal(result.statusCode,201);
  assert.equal(saved.received_by,user.user_metadata.name);
  assert.equal(saved.created_by,userId);
  assert.equal(JSON.parse(result.body).number,'PRO-2026-00001');
});
test('administrator can create a user with server controlled authorization metadata',async()=>{
  const result=await handler(event('/users','POST',{name:'Pessoa',email:'pessoa@example.test',password:'valid-password',role:'user'}));
  assert.equal(result.statusCode,201);
  const sent=JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(sent.app_metadata,{role:'user',active:true});
  assert.ok(!result.body.includes('valid-password'));
});
test('rejects invalid roles and short initial passwords',async()=>{
  assert.equal((await handler(event('/users','POST',{name:'Pessoa',email:'pessoa@example.test',password:'short',role:'admin'}))).statusCode,400);
  assert.equal((await handler(event('/users','POST',{name:'Pessoa',email:'pessoa@example.test',password:'valid-password',role:'owner'}))).statusCode,400);
});
test('cross origin mutations are rejected',async()=>{
  const request=event('/users','POST',{});request.headers.origin='https://other.example';
  assert.equal((await handler(request)).statusCode,403);assert.equal(calls.length,0);
});
test('user can upload a PDF with signed URL and a maximum of 20 MB',async()=>{
  user.app_metadata.role='user';
  const result=await handler(event('/uploads','POST',{size:1234}));
  assert.equal(result.statusCode,200);assert.match(JSON.parse(result.body).file_id,/^[a-f0-9]{32}$/);
  assert.equal((await handler(event('/uploads','POST',{size:20971521}))).statusCode,400);
});
test('download requires authentication and returns a short lived signed URL',async()=>{
  const result=await handler(event('/files/'+'a'.repeat(32)));
  assert.equal(result.statusCode,302);
  assert.ok(result.headers.Location.startsWith('https://database.example/storage/v1/object/sign/'));
  assert.equal(JSON.parse(calls.at(-1).options.body).expiresIn,60);
});
test('logout revokes session and clears both cookies',async()=>{
  const result=await handler(event('/auth/logout','POST',{}));
  assert.equal(result.statusCode,200);
  for(const cookie of result.multiValueHeaders['Set-Cookie'])assert.match(cookie,/Max-Age=0/);
});
test('refresh cookie renews an expired access session on the server',async()=>{
  const request=event('/auth/me');request.headers.cookie='folha_refresh=refresh';
  const result=await handler(request);
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).user.id,userId);
  assert.ok(result.multiValueHeaders['Set-Cookie'].length===2);
  assert.ok(calls.some(call=>call.url.includes('grant_type=refresh_token')));
});
test('only administrators can disable accounts',async()=>{
  user.app_metadata.role='user';
  const result=await handler(event('/users/22222222-2222-2222-2222-222222222222','PATCH',{active:false}));
  assert.equal(result.statusCode,403);
  assert.ok(!calls.some(call=>call.url.includes('/admin/users/')));
});
test('administrator can deactivate an ordinary account',async()=>{
  const result=await handler(event('/users/22222222-2222-2222-2222-222222222222','PATCH',{active:false}));
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).user.active,false);
});
test('missing Supabase configuration fails closed',async()=>{
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await handler(event('/protocols'))).statusCode,503);assert.equal(calls.length,0);
});
