# Bot de notificacao para WhatsApp com Baileys

Este projeto cria uma base de envio para WhatsApp usando `Baileys`, mas com foco em uso responsavel:

- envia apenas para contatos marcados com `opt_in=true`
- respeita um intervalo minimo entre mensagens
- limita quantas mensagens podem sair por execucao
- registra pedidos de descadastro com palavras como `STOP`, `SAIR` e `CANCELAR`
- roda em modo simulacao por padrao

> Importante: os mantenedores do Baileys desencorajam spam e envio em massa automatizado. Use apenas com consentimento dos destinatarios.

## Requisitos

- Node.js 20+
- WhatsApp disponivel para escanear QR Code ou usar codigo de pareamento

## Instalacao

```bash
npm install
copy .env.example .env
```

## Autenticacao

Primeiro, conecte sua conta:

```bash
npm run auth
```

Se `PAIRING_PHONE_NUMBER` estiver definido no `.env`, o bot tenta gerar codigo de pareamento.
Se nao estiver, ele mostra um QR Code no terminal.

## Listener de descadastro

Para registrar respostas como `STOP` e `SAIR` em `data/optouts.json`:

```bash
npm run listen
```

## Apps Script / Google Sheets

Se voce nao quiser usar terminal para disparar manualmente, o bot pode ler uma planilha via Apps Script.

Fluxo:

- voce publica um Apps Script como Web App
- o bot consulta esse endpoint automaticamente
- ele le as colunas `NOME`, `NÚMERO` e `ETIQUETA`
- envia a proxima mensagem do ciclo
- aplica a etiqueta configurada em `data/label-map.json`
- marca a linha como `ENVIADO` ou `ERRO`

Variaveis do `.env`:

```env
APPS_SCRIPT_URL=https://script.google.com/macros/s/SEU_SCRIPT/exec
APPS_SCRIPT_TOKEN=seu_token_privado
APPS_SCRIPT_POLL_MS=60000
STAGE1_VARIANTS_FILE=data/message-variants.abertura.json
STAGE1_LABEL_ID=7
STAGE2_VARIANTS_FILE=data/message-variants.oferta-tv.json
STAGE2_LABEL_ID=8
STAGE2_MEDIA_NAME=
STAGE2_DELAY_MS=10000
AUTO_STAGE2_AFTER_GREETING=true
MIN_DELAY_MS=40000
MAX_DELAY_MS=300000
DEFAULT_VARIANTS_FILE=data/message-variants.oferta-tv.json
DEFAULT_MEDIA_NAME=
```

Com isso configurado, o comando abaixo deixa o bot em execucao continua:

```bash
npm start
```

Foi incluido um exemplo pronto em `apps-script/Code.gs`.

## Funil em 2 Etapas

O bot agora pode rodar o fluxo automatico abaixo:

- etapa 1: envia uma abertura curta usando `data/message-variants.abertura.json`
- depois do envio da etapa 1, adiciona a etiqueta `7`
- apos o envio da etapa 1, o bot aguarda `10` segundos
- depois desses `10` segundos, o bot remove a etiqueta `7`
- em seguida adiciona a etiqueta `8`
- por fim envia a etapa 2 usando `data/message-variants.oferta-tv.json`

Arquivos e estados usados:

- `data/message-variants.abertura.json`: 200 mensagens curtas de abertura
- `data/message-variants.oferta-tv.json`: campanha 2 com texto + foto por variacao
- `data/funnel-state.json`: estado persistente do funil para nao reenviar a etapa 2
- `data/message-cycle-stage1.json`: ciclo embaralhado da etapa 1
- `data/message-cycle-stage2.json`: ciclo embaralhado da etapa 2

Observacoes:

- a etapa 1 usa sempre a etiqueta `7`
- a etapa 2 troca `7` por `8`
- o bot salva o estado localmente, entao nao perde a etapa do contato se reiniciar
- por padrao, a etapa 2 sai automaticamente apos `10` segundos
- voce pode ajustar esse tempo em `STAGE2_DELAY_MS`
- se quiser manter esse envio automatico ligado, deixe `AUTO_STAGE2_AFTER_GREETING=true`

## Contatos

Use um CSV com este formato:

```csv
NOME,NÚMERO,ETIQUETA
Maria,5511999999999,cliente novo
Joao,5511888888888,retorno
```

- `NÚMERO`: numero com DDI e DDD
- `ETIQUETA`: nome da etiqueta que voce quer aplicar naquele contato
- se a coluna `opt_in` nao existir, o bot considera a linha liberada para envio
- se o numero vier sem DDI, o bot adiciona automaticamente `55`
- ele tambem aceita formatos como `21999998888`, `5521999998888` e `5521999998888@c.us`

## Etiquetas Por Nome

Para usar a coluna `ETIQUETA` com o nome da etiqueta, preencha o arquivo `data/label-map.json` com o mapeamento entre nome e `label_id`.

Exemplo:

```json
{
  "cliente novo": "SEU_LABEL_ID_AQUI",
  "retorno": "SEU_LABEL_ID_AQUI"
}
```

Observacoes:

- na planilha voce escreve o nome da etiqueta, por exemplo `cliente novo`
- no `label-map.json` voce liga esse nome ao `label_id` real
- se a etiqueta da linha nao estiver no mapa, o envio acontece sem aplicar etiqueta

## Descobrir o label_id

Voce pode usar o proprio bot para capturar os IDs das etiquetas:

```bash
npm run labels:watch
```

O bot salva as etiquetas detectadas em:

```text
data/labels-discovered.json
```

Se nenhuma etiqueta aparecer na primeira conexao, abra o WhatsApp Business e:

- crie uma etiqueta nova
- ou renomeie uma etiqueta existente

Quando o evento chegar, o bot registra algo como:

```text
Etiqueta detectada: Lead -> 123456789
```

## Envio

Simulacao:

```bash
npm run send -- --csv data/contacts.example.csv --message-file data/message.example.txt
```

Envio real:

```bash
npm run send -- --csv data/contacts.example.csv --message-file data/message.example.txt --confirm-send
```

Tambem funciona com mensagem inline:

```bash
npm run send -- --csv data/contacts.example.csv --message "Ola {{name}}, sua notificacao chegou." --confirm-send
```

Para usar varias mensagens em ciclo com embaralhamento automatico:

```bash
npm run send -- --csv data/contacts.example.csv --variants-file data/message-variants.example.json --confirm-send
```

O `--variants-file` pode ser um array JSON simples com as mensagens:

```json
[
  "Ola {{name}}, primeira variacao.",
  "Oi {{name}}, segunda variacao.",
  "Ola {{name}}! Terceira variacao."
]
```

Ou um array de objetos para vincular uma midia especifica a cada texto:

```json
[
  {
    "text": "Ola {{name}}, primeira variacao.",
    "mediaName": "img-001"
  },
  {
    "text": "Oi {{name}}, segunda variacao.",
    "mediaName": "img-002"
  },
  {
    "text": "Ola {{name}}! Terceira variacao."
  }
]
```

Como funciona o ciclo:

- o bot embaralha a lista de variacoes
- envia uma variacao por contato, seguindo a ordem atual
- quando acaba a fila, ele embaralha tudo de novo
- o estado fica salvo em `data/message-cycle.json`, entao o ciclo continua na proxima execucao

Voce tambem pode enviar foto ou video com legenda:

```bash
npm run send -- --csv data/contacts.example.csv --media oferta-video --message "Ola {{name}}, veja este material." --confirm-send
```

## Placeholders

- `{{name}}`
- `{{phone}}`

## Ajustes de campanha

Voce pode sobrescrever os limites na linha de comando:

```bash
npm run send -- --csv data/contacts.example.csv --message-file data/message.example.txt --delay 12000 --limit 20 --confirm-send
```

## Midias

Para salvar uma foto ou video dentro do bot:

```bash
npm run media:add -- --source "C:\\midias\\video.mp4" --name oferta-video
npm run media:add -- --source "C:\\midias\\foto.jpg" --name vitrine-foto
```

Se o tipo nao puder ser identificado pela extensao, voce pode informar:

```bash
npm run media:add -- --source "C:\\midias\\arquivo.bin" --name campanha --type video
```

Para listar as midias salvas:

```bash
npm run media:list
```

Para enviar uma midia salva:

```bash
npm run send -- --csv data/contacts.example.csv --media oferta-video --message "Ola {{name}}, segue o video." --confirm-send
```

Notas:

- `--media` usa o nome salvo no comando `media:add`
- `--message` ou `--message-file` vira a legenda da foto/video
- se quiser, voce pode enviar so a foto/video sem legenda
- se o `--variants-file` trouxer `mediaName`, cada variacao usa a propria midia
- se uma variacao nao tiver `mediaName`, o bot usa a midia global passada em `--media` ou no `.env`

## Etiquetas

O Baileys expoe suporte para etiquetas nativas do WhatsApp, entao o bot pode aplicar uma etiqueta apos cada envio.

Via `.env`:

```bash
CHAT_LABEL_ID=seu_label_id
MESSAGE_LABEL_ID=seu_label_id
```

Ou via linha de comando:

```bash
npm run send -- --csv data/contacts.example.csv --message-file data/message.example.txt --chat-label-id seu_label_id --confirm-send
```

Notas:

- `CHAT_LABEL_ID`: aplica etiqueta na conversa
- `MESSAGE_LABEL_ID`: aplica etiqueta na mensagem enviada
- em geral voce precisa usar um `labelId` que ja exista na conta
- a disponibilidade dessas etiquetas pode variar conforme os recursos da conta WhatsApp/WhatsApp Business

## Arquivos gerados

- `auth/`: sessao autenticada do Baileys
- `apps-script/Code.gs`: exemplo de integracao com Google Sheets
- `data/media/`: arquivos de foto e video salvos no bot
- `data/media-manifest.json`: catalogo das midias cadastradas
- `data/message-cycle.json`: estado salvo do ciclo de variacoes
- `data/label-map.json`: mapa entre nome da etiqueta e `label_id`
- `data/optouts.json`: contatos que pediram descadastro
- `logs/report-*.json`: relatorios de envio

## Proximos passos sugeridos

- mover contatos e opt-outs para banco de dados
- adicionar fila com BullMQ ou RabbitMQ
- criar painel web para campanhas
- registrar status detalhado de entrega e falha
