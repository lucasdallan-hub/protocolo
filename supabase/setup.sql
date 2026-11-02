-- Execute uma vez no SQL Editor do SEU projeto Supabase.
create table if not exists public.protocols (
  id bigint generated always as identity primary key,
  name text not null,
  company text not null,
  role text not null,
  registration text not null default '',
  period text not null,
  received_by text not null,
  created_by uuid not null references auth.users(id),
  notes text not null default '',
  file_id text not null default '',
  created_at timestamptz not null default now()
);

-- O acesso é intermediado pelas funções Netlify após validar usuário e perfil.
-- Nenhuma chave pública ou sessão do navegador acessa as tabelas diretamente.
alter table public.protocols enable row level security;
revoke all on public.protocols from anon, authenticated;
grant all on public.protocols to service_role;
grant usage, select on sequence public.protocols_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('folhas', 'folhas', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf'];

-- Primeiro administrador: crie a conta em Authentication > Users > Add user.
-- Depois substitua o email abaixo e execute APENAS esta instrução.
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--     || '{"role":"admin","active":true}'::jsonb
-- where email = 'SEU_EMAIL_AQUI';
