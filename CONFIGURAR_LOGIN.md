# Ativar login no Netlify com Supabase

A interface e as funções estão prontas, mas precisam de um projeto Supabase seu. Os planos gratuitos do Netlify e do Supabase têm limites de uso e podem mudar. Nenhum cadastro externo, usuário real ou senha foi criado automaticamente.

## 1. Criar o banco

1. Crie uma conta em https://supabase.com e um projeto gratuito.
2. Aguarde o projeto iniciar e abra **SQL Editor**.
3. Copie e execute o conteúdo de [supabase/setup.sql](supabase/setup.sql). Isso cria a tabela de protocolos e um bucket privado para os PDFs. Não torne o bucket público.

## 2. Configurar o Netlify

Nas configurações do projeto Netlify, em **Environment variables**, adicione as seguintes variáveis para o ambiente de produção e disponibilize-as para as funções:

| Nome | Valor a copiar do seu projeto Supabase |
| --- | --- |
| `SUPABASE_URL` | Project URL, por exemplo `https://SEU-PROJETO.supabase.co` |
| `SUPABASE_ANON_KEY` | Chave legada `anon` em Settings → API Keys → Legacy API Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave legada `service_role`, na mesma seção |

Use as chaves JWT legadas `anon` e `service_role`, compatíveis com esta integração. A chave `service_role` é secreta: coloque-a somente nas variáveis do Netlify, nunca no HTML, no GitHub ou em mensagens. Marque-a como secreta se a interface oferecer essa opção. Não use o prefixo de variável pública de frameworks.

Essas variáveis são lidas pelas funções no servidor. Elas não são inseridas no HTML pelo build. Não é necessário cadastrar essas chaves no ambiente de desenvolvimento do Codex para publicar pelo Netlify.

No Netlify, selecione **Deploys → Trigger deploy → Deploy site**. O repositório contém `netlify.toml`: ele gera a versão com login usando `python3 tools/build_html.py --cloud`, publica `docs` e encaminha `/api/*` para as funções.

## 3. Criar o primeiro administrador

1. No Supabase, abra **Authentication → Users → Add user → Create new user**.
2. Defina seu email e uma senha forte. Confirme o email nessa criação, usando a opção de confirmação automática, se exibida.
3. No SQL Editor, substitua o email no comando abaixo e execute:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"role":"admin","active":true}'::jsonb
where email = 'SEU_EMAIL_AQUI';
```

4. Confirme que uma linha foi atualizada. Entre no site com esse email e senha.
5. Abra **Usuários** no cabeçalho para criar as contas da equipe.

Não há cadastro público na aplicação. Para impedir também cadastros diretos na API pública do Supabase, desabilite a criação pública de contas nas configurações de autenticação do projeto. O administrador continua criando contas pela API administrativa. Contas sem o perfil `admin` ou `user` em `app_metadata` são recusadas mesmo que alguém consiga cadastrar uma conta diretamente.

## Permissões

- **Administrador:** consulta e protocola folhas; cria usuários e administradores; desativa e reativa usuários comuns.
- **Protocolar folhas:** consulta os protocolos e PDFs da equipe e registra novas folhas; não gerencia contas.
- Uma conta desativada perde acesso às solicitações seguintes, mesmo com uma sessão anterior.
- Cada protocolo recebe o ID e o nome do usuário autenticado no servidor. Alterar o campo do formulário não permite se passar por outra pessoa.
- Todos podem alterar a própria senha. As senhas são gerenciadas pelo Supabase Auth; não são armazenadas no HTML, no SQLite ou no código.
- Administradores não podem ser desativados pelo painel. Isso evita remover o último administrador por engano; alterações excepcionais são feitas pelo dono do projeto no Supabase.

As sessões usam cookies HttpOnly, Secure e SameSite=Strict. Use o endereço HTTPS fornecido pelo Netlify. PDFs são guardados em bucket privado; o download exige uma sessão válida e gera um link temporário de 60 segundos. Um link temporário pode ser utilizado por quem o receber enquanto estiver válido.

## Dados existentes

Os registros antigos do HTML offline continuam no navegador anterior e não são enviados automaticamente para o Supabase. Exporte-os antes de trocar a versão se precisar preservar esse histórico. A versão com login usa somente o banco compartilhado; não cria registros offline quando o servidor está indisponível.

## Conferir a instalação

1. Abra o site sem entrar: somente a tela de login deve aparecer.
2. Entre como administrador e crie uma conta com permissão **Protocolar folhas**.
3. Saia e entre com essa conta. O botão **Usuários** não deve aparecer.
4. Importe um PDF, confira os dados e registre. O responsável deve ser o usuário conectado.
5. Acesse em outro navegador com uma conta autorizada e confirme que o protocolo aparece.
6. Desative a conta pelo administrador e confirme que ela perde acesso.

Se aparecer **Login ainda não configurado**, confira as três variáveis do Netlify e faça um novo deploy. Se aparecer **Banco indisponível ou configuração incompleta**, confirme a execução do SQL, as chaves do mesmo projeto e se o projeto Supabase está ativo. Se a conta entrar no Supabase mas for recusada no site, confira `role` e `active` em `app_metadata`.

## Testes do código

```sh
node test_auth.js
python -m unittest -v
python tools/build_html.py --cloud
```

Os testes da API usam respostas simuladas do Supabase e não exigem credenciais. A integração com seu projeto precisa ser verificada após a configuração acima.
