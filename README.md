# Folha — protocolo de folhas

Sistema local para receber cartões ponto em PDF, extrair os dados do colaborador, conferir as informações e registrar um protocolo de recebimento.

## HTML independente com importação em lote

A versão [docs/index.html](docs/index.html) pode ser baixada e aberta no navegador sem servidor ou internet. Clique em **Importar PDFs** e selecione vários arquivos usando Ctrl ou Shift. Cada PDF pode ter até 20 MB; todas as páginas são lidas, sem o limite anterior de 30 páginas.

O sistema mostra o progresso por arquivo e página e continua nos demais arquivos se algum PDF falhar. Páginas do mesmo colaborador, empresa, matrícula e período são agrupadas dentro de cada arquivo. Arquivos separados continuam sendo registros separados. Revise os campos, desmarque folhas que não quer registrar, informe o responsável e clique em **Registrar selecionados**. Cada folha selecionada recebe um protocolo próprio e o PDF completo como anexo. Registros já salvos não são reenviados ao tentar novamente os pendentes no mesmo lote.

PDFs sem texto precisam de preenchimento manual; esta versão não inclui OCR. Confira especialmente PDFs cujo cabeçalho difere do modelo fornecido. Os registros e anexos desta versão ficam no IndexedDB do navegador, separados do banco do servidor. Exportar CSV salva os campos, mas não inclui os PDFs anexados. Limpar os dados do navegador pode apagar os registros locais.

Para gerar novamente o HTML: `python tools/build_html.py`. O resultado fica em `docs/index.html`; para outro destino, use `--output caminho/Folha.html`. O gerador incorpora as bibliotecas PDF.js incluídas em `tools/vendor/` e os arquivos `static/batch.*`. A interface de lote é exclusiva do HTML independente; o servidor abaixo mantém seu fluxo de importação individual.

Para hospedar a versão HTML no Netlify, envie a pasta `docs`. No GitHub Pages, configure a publicação a partir da branch `main`, pasta `/docs`. A publicação exige ativar a hospedagem no serviço escolhido; apenas enviar o código ao GitHub não publica o site.

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
