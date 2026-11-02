# Folha — protocolo de folhas

Sistema local para receber cartões ponto em PDF, extrair os dados do colaborador, conferir as informações e registrar um protocolo de recebimento.

## Versão online com login e usuários

O Netlify agora publica a versão com login (`python tools/build_html.py --cloud`). O administrador pode criar contas, definir quem pode protocolar e desativar usuários. Protocolos e anexos são compartilhados pelo Supabase, e o responsável por cada protocolo é definido no servidor a partir da sessão.

**É necessário configurar seu projeto Supabase e as variáveis do Netlify para ativar o acesso.** Consulte [CONFIGURAR_LOGIN.md](CONFIGURAR_LOGIN.md). Sem essa configuração, a página mostra o login, mas o backend recusa o acesso. Não há senha padrão nem administrador criado automaticamente.

As funções em `netlify/functions/api.js` validam a sessão e o perfil a cada chamada. A chave administrativa fica somente no servidor; a tabela tem RLS ativado e o bucket de PDFs é privado. Contas comuns podem consultar e protocolar folhas da equipe; apenas administradores gerenciam usuários.

## HTML independente com importação em lote

A versão HTML **offline**, gerada com `python tools/build_html.py --output Folha.html` (sem `--cloud`), pode ser aberta no navegador sem servidor ou internet. Ela não tem login e usa apenas o armazenamento local. O arquivo [docs/index.html](docs/index.html) deste repositório é a versão online com login. Nas duas versões, clique em **Importar PDFs** e selecione vários arquivos usando Ctrl ou Shift. Cada PDF pode ter até 20 MB; todas as páginas são lidas, sem o limite anterior de 30 páginas.

O sistema mostra o progresso por arquivo e página e continua nos demais arquivos se algum PDF falhar. Páginas do mesmo colaborador, empresa, matrícula e período são agrupadas dentro de cada arquivo. Arquivos separados continuam sendo registros separados. Revise os campos, desmarque folhas que não quer registrar, informe o responsável e clique em **Registrar selecionados**. Cada folha selecionada recebe um protocolo próprio e o PDF completo como anexo. Registros já salvos não são reenviados ao tentar novamente os pendentes no mesmo lote.

PDFs sem texto precisam de preenchimento manual; esta versão não inclui OCR. Confira especialmente PDFs cujo cabeçalho difere do modelo fornecido. Os registros e anexos desta versão ficam no IndexedDB do navegador, separados do banco do servidor. Exportar CSV salva os campos, mas não inclui os PDFs anexados. Limpar os dados do navegador pode apagar os registros locais.

Para gerar a versão online: `python tools/build_html.py --cloud`. O resultado fica em `docs/index.html`; para gerar offline em outro destino, use `python tools/build_html.py --output caminho/Folha.html`. O gerador incorpora as bibliotecas PDF.js incluídas em `tools/vendor/` e os arquivos `static/batch.*`. O servidor Python abaixo mantém seu fluxo local de importação individual e não é o backend da versão Netlify.

Para hospedar a versão com login, conecte o repositório ao Netlify para incluir as funções e configure o Supabase. Enviar apenas a pasta `docs` por upload manual ou GitHub Pages não executa as funções de autenticação. A versão offline pode ser hospedada como HTML estático, mas não oferece controle de acesso nem sincronização.

### Publicação pelo GitHub no Netlify

Conecte o repositório `lucasdallan-hub/protocolo` ao Netlify e use a branch `main`. O arquivo `netlify.toml` define o diretório base como a raiz do repositório, executa `python3 tools/build_html.py --cloud`, publica `docs` e inclui as funções em `netlify/functions`. Não configure `server.py` como comando de build nem use a pasta `static` como diretório de publicação.

Se o site já estiver conectado, inicie um novo deploy da branch `main` após receber a atualização. Confira no log que o diretório publicado é `docs`. Se houver configuração antiga de diretório base ou de pacote no painel, remova-a para usar a raiz do repositório. Para publicação manual, envie o conteúdo de `docs` com `index.html` na raiz do pacote.

O Netlify executa o backend JavaScript para autenticação e permissões, e o Supabase guarda usuários, protocolos e PDFs. O Netlify não executa o servidor Python local. Registros antigos da versão offline não são migrados automaticamente.

## Executar

Requisitos: Python 3.10+ e `pdftotext` (pacote `poppler-utils` no Debian/Ubuntu). Não há dependências Python externas nem serviços de banco para instalar.

```sh
cd /workspace/protocolo
python server.py --port 8000
```

Abra o servidor na porta 8000 no seu ambiente local. O endereço padrão de escuta é `127.0.0.1`. Para disponibilizar em uma rede controlada, configure explicitamente `--host`.

## Uso

1. Clique em **Importar folha PDF**, selecione um cartão ponto e aguarde a leitura.
2. Confira nome, empresa, função, matrícula e período. O modelo usa os rótulos Empresa, Colaborador, Cargo, Matrícula e Período do PDF fornecido como referência.
3. Informe quem recebeu o documento e registre o protocolo.
4. Consulte o histórico, filtre por empresa ou mês de recebimento, abra o PDF e imprima o comprovante. A impressão do navegador permite salvar como PDF.
5. Exporte os resultados dos filtros em CSV para planilha.

É possível registrar manualmente sem anexo. PDFs escaneados não têm OCR nesta versão; preencha os campos manualmente. A importação processa um PDF por vez e retorna um conjunto de dados por arquivo; cartões de vários colaboradores devem ser separados antes da importação. Limite de 20 MB por solicitação.

Os números de protocolo são gerados no servidor em sequência, no formato `PRO-AAAA-00001`. O recebimento é registrado com data e hora do servidor. O sistema registra documentos recebidos; não realiza cálculo ou auditoria de jornada e não cria assinatura digital.

## Dados e privacidade

O banco SQLite e os PDFs ficam em `data/`, ignorado pelo Git. Os campos CPF e PIS não são extraídos nem registrados como campos, mas continuam no PDF original anexado. Nenhuma amostra com dados pessoais é incluída no código ou no banco inicial.

Faça backup da pasta `data/` com o servidor parado. PDFs importados ficam armazenados mesmo se o formulário for cancelado; planeje limpeza e retenção antes de uso prolongado.

Esta versão é para uso local em ambiente confiável, sem login ou isolamento por usuário. Antes de publicar na internet ou usar com múltiplos usuários, implemente autenticação, permissões, HTTPS, política de retenção, backups e controles de acesso aos documentos. O banco local não sincroniza entre máquinas.

## Validação

```sh
python -m unittest -v
node --check static/app.js
```

Os testes usam um banco temporário e verificam extração dos rótulos, persistência, numeração, campos obrigatórios e rejeição de anexos inválidos.
