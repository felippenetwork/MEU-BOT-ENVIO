# Deploy na VortexUSA

## Arquivos para subir

Se voce quiser substituir os arquivos manualmente na hospedagem, use a pasta `download/`.
Ela agora guarda somente os arquivos atualizados que realmente precisam ser substituidos na hospedagem.

Sempre que atualizar o projeto, rode:

```bash
npm run download:refresh -- index.js
```

Exemplos:

```bash
npm run download:refresh -- index.js
npm run download:refresh -- index.js data/message-variants.oferta-tv.json
npm run download:refresh -- apps-script/Code.gs
```

Depois disso, substitua na hospedagem somente os arquivos que aparecerem dentro de `download/`.

## Passos

1. Envie o arquivo `.zip` para a hospedagem.
2. Extraia o conteudo.
3. Entre na pasta do projeto.
4. Rode:

```bash
npm install
```

5. Crie o arquivo `.env` com base no `.env.example`.

Exemplo:

```env
BOT_NAME=MeuBot
MIN_DELAY_MS=40000
MAX_DELAY_MS=300000
MAX_MESSAGES_PER_RUN=30
PAIRING_PHONE_NUMBER=
CHAT_LABEL_ID=
MESSAGE_LABEL_ID=
APPS_SCRIPT_URL=
APPS_SCRIPT_TOKEN=
APPS_SCRIPT_POLL_MS=60000
DEFAULT_VARIANTS_FILE=data/message-variants.oferta-tv.json
DEFAULT_MEDIA_NAME=
TIMEZONE=America/Sao_Paulo
```

## Comandos uteis

Autenticar WhatsApp:

```bash
npm run auth
```

Iniciar pela entrada principal da raiz:

```bash
npm start
```

O `npm start` sobe o modo `daemon`, entao o processo fica ativo na hospedagem.
Se `APPS_SCRIPT_URL` estiver preenchido, ele sincroniza automaticamente com a planilha.

Escutar respostas STOP/SAIR:

```bash
npm run listen
```

Enviar campanha com arquivo de variacoes:

```bash
npm run send -- --csv data/contacts.example.csv --variants-file data/message-variants.oferta-tv.json --confirm-send
```

Cadastrar midia:

```bash
npm run media:add -- --source "/caminho/do/arquivo.mp4" --name oferta-video
```

Listar midias:

```bash
npm run media:list
```

## Observacoes

- Recomendado: Node.js 20 ou superior.
- Nao suba a pasta `auth/` de outro ambiente se quiser autenticar do zero.
- O estado do ciclo das mensagens fica em `data/message-cycle.json`.
- O exemplo do Apps Script esta em `apps-script/Code.gs`.
