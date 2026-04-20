import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState
} from "baileys";
import { parse } from "csv-parse/sync";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

const CONFIG = {
  botName: process.env.BOT_NAME || "MeuBot",
  minDelayMs: parsePositiveInt(process.env.MIN_DELAY_MS, 40000),
  maxDelayMs: parsePositiveInt(process.env.MAX_DELAY_MS, 300000),
  maxMessagesPerRun: parsePositiveInt(process.env.MAX_MESSAGES_PER_RUN, 30),
  defaultCountryCode: "55",
  pairingPhoneNumber: normalizePhone(process.env.PAIRING_PHONE_NUMBER || ""),
  chatLabelId: String(process.env.CHAT_LABEL_ID || "").trim(),
  messageLabelId: String(process.env.MESSAGE_LABEL_ID || "").trim(),
  appsScriptUrl: String(process.env.APPS_SCRIPT_URL || "").trim(),
  appsScriptToken: String(process.env.APPS_SCRIPT_TOKEN || "").trim(),
  appsScriptPollMs: parsePositiveInt(process.env.APPS_SCRIPT_POLL_MS, 60000),
  appsScriptStageMode: normalizeStageMode(process.env.APPS_SCRIPT_STAGE_MODE || "stage2"),
  stage1VariantsFile: String(
    process.env.STAGE1_VARIANTS_FILE || "data/message-variants.abertura.json"
  ).trim(),
  stage1LabelId: String(process.env.STAGE1_LABEL_ID || "7").trim(),
  stage2VariantsFile: String(
    process.env.STAGE2_VARIANTS_FILE ||
      process.env.DEFAULT_VARIANTS_FILE ||
      "data/message-variants.oferta-tv.json"
  ).trim(),
  stage2LabelId: String(process.env.STAGE2_LABEL_ID || "8").trim(),
  stage2MediaName: String(
    process.env.STAGE2_MEDIA_NAME || process.env.DEFAULT_MEDIA_NAME || ""
  ).trim(),
  stage2DelayMs: parsePositiveInt(process.env.STAGE2_DELAY_MS, 10000),
  autoStage2AfterGreeting: parseBoolean(process.env.AUTO_STAGE2_AFTER_GREETING || "true"),
  stage2UseInteractiveButtons: parseBoolean(
    process.env.STAGE2_USE_INTERACTIVE_BUTTONS || "true"
  ),
  stage2ButtonLinkUrl: String(
    process.env.STAGE2_BUTTON_LINK_URL ||
      "https://chat.whatsapp.com/FG1hAPfo12e8AJOydKTnKs"
  ).trim(),
  stage2ButtonLinkText: String(
    process.env.STAGE2_BUTTON_LINK_TEXT || "Participar Agora"
  ).trim(),
  stage2ButtonQuickReplyText: String(
    process.env.STAGE2_BUTTON_QUICK_REPLY_TEXT || "Essa vou passar"
  ).trim(),
  stage2ButtonQuickReplyId: String(
    process.env.STAGE2_BUTTON_QUICK_REPLY_ID || "stage2_skip_offer"
  ).trim(),
  stage2ButtonFooterText: String(
    process.env.STAGE2_BUTTON_FOOTER_TEXT || "Rifas Clube do Churrasco"
  ).trim(),
  defaultVariantsFile: String(process.env.DEFAULT_VARIANTS_FILE || "data/message-variants.oferta-tv.json").trim(),
  defaultMediaName: String(process.env.DEFAULT_MEDIA_NAME || "").trim(),
  timezone: process.env.TIMEZONE || "America/Sao_Paulo"
};

const logger = pino({ level: "silent" });
const DATA_DIR = "data";
const OPTOUT_FILE = `${DATA_DIR}/optouts.json`;
const CONTACTS_EXAMPLE_FILE = `${DATA_DIR}/contacts.example.csv`;
const MESSAGE_EXAMPLE_FILE = `${DATA_DIR}/message.example.txt`;
const MESSAGE_VARIANTS_EXAMPLE_FILE = `${DATA_DIR}/message-variants.example.json`;
const MESSAGE_CYCLE_FILE = `${DATA_DIR}/message-cycle.json`;
const STAGE1_MESSAGE_CYCLE_FILE = `${DATA_DIR}/message-cycle-stage1.json`;
const STAGE2_MESSAGE_CYCLE_FILE = `${DATA_DIR}/message-cycle-stage2.json`;
const FUNNEL_STATE_FILE = `${DATA_DIR}/funnel-state.json`;
const FUNNEL_STATE_BACKUP_FILE = `${DATA_DIR}/funnel-state.backup.json`;
const FUNNEL_STATE_TMP_FILE = `${DATA_DIR}/funnel-state.tmp.json`;
const LABEL_MAP_FILE = `${DATA_DIR}/label-map.json`;
const LABEL_MAP_EXAMPLE_FILE = `${DATA_DIR}/label-map.example.json`;
const DISCOVERED_LABELS_FILE = `${DATA_DIR}/labels-discovered.json`;
const MEDIA_DIR = path.join(DATA_DIR, "media");
const MEDIA_MANIFEST_FILE = `${DATA_DIR}/media-manifest.json`;
const STOP_KEYWORDS = new Set(["STOP", "SAIR", "CANCELAR", "REMOVER"]);
const SUPPORTED_MEDIA_TYPES = new Set(["image", "video"]);
const REPLY_REACTION_DELAY_MS = 10000;
const REPLY_HEART_REACTION = "\u2764\uFE0F";
const replyFlowLocks = new Set();
let funnelStateWriteQueue = Promise.resolve();
let funnelStateCache = null;

async function main() {
  const command = process.argv[2] || "daemon";

  if (command === "auth") {
    await startAuthSession();
    return;
  }

  if (command === "listen") {
    await startListener();
    return;
  }

  if (command === "daemon") {
    await startDaemon();
    return;
  }

  if (command === "send") {
    await runCampaign(process.argv.slice(3));
    return;
  }

  if (command === "media:add") {
    await importMediaAsset(process.argv.slice(3));
    return;
  }

  if (command === "media:list") {
    await listMediaAssets();
    return;
  }

  if (command === "labels:watch") {
    await watchLabels();
    return;
  }

  console.log(`Uso:
  npm start
  npm run auth
  npm run daemon
  npm run listen
  npm run labels:watch
  npm run send -- --csv data/contacts.example.csv --message "Ola {{name}}" --confirm-send
  npm run send -- --csv data/contacts.example.csv --variants-file data/message-variants.example.json --confirm-send
  npm run media:add -- --source "C:\\midias\\video.mp4" --name oferta-video
  npm run media:list`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

async function loadContactsFromCsv(filePath) {
  const csvContent = await fs.readFile(filePath, "utf8");
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return records
    .map((record) => ({
      name: getRecordValue(record, ["name", "nome", "NOME", "Nome"]) || "",
      phone: normalizePhone(
        getRecordValue(
          record,
          [
            "phone",
            "numero",
            "número",
            "NUMERO",
            "NÚMERO",
            "Número",
            "numeros",
            "números",
            "NUMEROS",
            "NÚMEROS",
            "Numeros",
            "Números"
          ]
        ) || ""
      ),
      optIn: parseOptIn(record),
      tags: getRecordValue(record, ["tags", "TAGS", "Tags"]) || "",
      labelName: getRecordValue(record, ["label_name", "etiqueta", "ETIQUETA", "Etiqueta"]) || ""
    }))
    .filter((record) => record.phone);
}

function normalizePhone(value) {
  const digits = String(value || "")
    .replace(/@.+$/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith(CONFIG.defaultCountryCode)) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `${CONFIG.defaultCountryCode}${digits}`;
  }

  return digits;
}

function formatMessage(template, contact) {
  const nomeComEspaco = contact.name ? ` ${contact.name}` : "";
  const greeting = getGreeting();
  const dayPeriod = getPeriodOfDayGreeting();
  return template
    .replaceAll("{{name}}", contact.name || "cliente")
    .replaceAll("{{nome}}", nomeComEspaco)
    .replaceAll("{{phone}}", contact.phone || "")
    .replaceAll("{{saudacao}}", greeting)
    .replaceAll("{{periododia}}", dayPeriod)
    .replaceAll("{{periodo_do_dia}}", dayPeriod);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseBoolean(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "sim";
}

function normalizeStageMode(value) {
  return String(value || "").trim().toLowerCase() === "stage2" ? "stage2" : "stage1";
}

function parseOptIn(record) {
  const rawValue = getRecordValue(record, ["opt_in", "optin", "OPT_IN", "OPTIN"]);
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return true;
  }

  return parseBoolean(rawValue);
}

function getRecordValue(record, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return record[alias];
    }
  }

  return "";
}

async function mkdirSafe(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "EACCES") {
      console.log(`Aviso: nao foi possivel criar a pasta "${dirPath}": ${error.message}`);
    }
  }
}

async function ensureDataFiles() {
  await mkdirSafe(DATA_DIR);
  await mkdirSafe(MEDIA_DIR);

  await ensureFile(OPTOUT_FILE, "[]\n");
  await ensureFile(MEDIA_MANIFEST_FILE, "{}\n");
  await ensureFile(LABEL_MAP_FILE, "{}\n");
  await ensureFile(DISCOVERED_LABELS_FILE, "[]\n");
  await ensureFile(
    FUNNEL_STATE_FILE,
    JSON.stringify(
      {
        version: 1,
        contacts: {},
        processedInboundMessageIds: {}
      },
      null,
      2
    )
  );
  await ensureFile(
    FUNNEL_STATE_BACKUP_FILE,
    JSON.stringify(
      {
        version: 1,
        contacts: {},
        processedInboundMessageIds: {}
      },
      null,
      2
    )
  );
  await ensureFile(
    CONTACTS_EXAMPLE_FILE,
    "NOME,NÚMERO,ETIQUETA\nMaria,5511999999999,cliente novo\nJoao,5511888888888,retorno\n"
  );
  await ensureFile(
    MESSAGE_EXAMPLE_FILE,
    "Ola {{name}}, aqui e uma mensagem enviada com consentimento pelo bot.\n"
  );
  await ensureFile(
    MESSAGE_VARIANTS_EXAMPLE_FILE,
    JSON.stringify(
      [
        {
          text: "Ola {{name}}, aqui e uma mensagem enviada com consentimento pelo bot.",
          mediaName: "img-001"
        },
        {
          text: "Oi {{name}}, passando para compartilhar uma notificacao com voce.",
          mediaName: "img-002"
        },
        {
          text: "Ola {{name}}! Esta e mais uma variacao da mensagem automatica."
        }
      ],
      null,
      2
    )
  );
  await ensureFile(
    MESSAGE_CYCLE_FILE,
    JSON.stringify(
      {
        signature: "",
        queue: []
      },
      null,
      2
    )
  );
  await ensureFile(
    STAGE1_MESSAGE_CYCLE_FILE,
    JSON.stringify(
      {
        signature: "",
        queue: []
      },
      null,
      2
    )
  );
  await ensureFile(
    STAGE2_MESSAGE_CYCLE_FILE,
    JSON.stringify(
      {
        signature: "",
        queue: []
      },
      null,
      2
    )
  );
  await ensureFile(
    LABEL_MAP_EXAMPLE_FILE,
    JSON.stringify(
      {
        "cliente novo": "SEU_LABEL_ID_AQUI",
        retorno: "SEU_LABEL_ID_AQUI"
      },
      null,
      2
    )
  );
}

function hasAppsScriptConfig() {
  return Boolean(CONFIG.appsScriptUrl);
}

async function getOptOutSet() {
  await ensureDataFiles();
  const content = await fs.readFile(OPTOUT_FILE, "utf8");
  const values = JSON.parse(content);
  return new Set(values);
}

async function getLabelMap() {
  await ensureDataFiles();
  const content = await fs.readFile(LABEL_MAP_FILE, "utf8");
  return JSON.parse(content);
}

async function getDiscoveredLabels() {
  await ensureDataFiles();
  const content = await fs.readFile(DISCOVERED_LABELS_FILE, "utf8");
  return JSON.parse(content);
}

async function saveDiscoveredLabels(labels) {
  await ensureDataFiles();
  await fs.writeFile(DISCOVERED_LABELS_FILE, JSON.stringify(labels, null, 2));
}

async function getFunnelState() {
  await ensureDataFiles();
  await funnelStateWriteQueue.catch(() => {});

  if (funnelStateCache) {
    return cloneFunnelState(funnelStateCache);
  }

  const state = await loadFunnelStateFromDisk();
  funnelStateCache = cloneFunnelState(state);
  return cloneFunnelState(funnelStateCache);
}

async function saveFunnelState(state) {
  const normalizedState = cloneFunnelState(state);
  funnelStateCache = cloneFunnelState(normalizedState);
  funnelStateWriteQueue = funnelStateWriteQueue
    .catch(() => {})
    .then(async () => {
      await ensureDataFiles();
      const serialized = JSON.stringify(normalizedState, null, 2);
      await fs.writeFile(FUNNEL_STATE_TMP_FILE, serialized);
      await fs.copyFile(FUNNEL_STATE_TMP_FILE, FUNNEL_STATE_BACKUP_FILE);

      try {
        await fs.rename(FUNNEL_STATE_TMP_FILE, FUNNEL_STATE_FILE);
      } catch {
        await fs.copyFile(FUNNEL_STATE_TMP_FILE, FUNNEL_STATE_FILE);
        await fs.unlink(FUNNEL_STATE_TMP_FILE).catch(() => {});
      }
    });

  return funnelStateWriteQueue;
}

function normalizeFunnelState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    contacts:
      state.contacts && typeof state.contacts === "object" && !Array.isArray(state.contacts)
        ? state.contacts
        : {},
    processedInboundMessageIds:
      state.processedInboundMessageIds &&
      typeof state.processedInboundMessageIds === "object" &&
      !Array.isArray(state.processedInboundMessageIds)
        ? state.processedInboundMessageIds
        : {}
  };
}

function cloneFunnelState(state) {
  return JSON.parse(JSON.stringify(normalizeFunnelState(state)));
}

async function loadFunnelStateFromDisk() {
  const current = await readJsonFileSafe(FUNNEL_STATE_FILE);
  if (current) {
    return normalizeFunnelState(current);
  }

  const backup = await readJsonFileSafe(FUNNEL_STATE_BACKUP_FILE);
  if (backup) {
    const normalizedBackup = normalizeFunnelState(backup);
    await saveFunnelState(normalizedBackup);
    return normalizedBackup;
  }

  const emptyState = normalizeFunnelState({});
  await saveFunnelState(emptyState);
  return emptyState;
}

async function readJsonFileSafe(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.log(`Nao foi possivel ler ${filePath} como JSON valido: ${error.message || error}`);
    return null;
  }
}

async function fetchAppsScriptQueue() {
  const url = new URL(CONFIG.appsScriptUrl);
  url.searchParams.set("action", "queue");
  url.searchParams.set("limit", String(CONFIG.maxMessagesPerRun));

  if (CONFIG.appsScriptToken) {
    url.searchParams.set("token", CONFIG.appsScriptToken);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar fila do Apps Script: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.rows;

  if (!Array.isArray(rows)) {
    throw new Error("A resposta do Apps Script nao trouxe um array em `rows`.");
  }

  return rows
    .map((record) => ({
      rowId: String(
        getRecordValue(record, ["rowId", "row_id", "ROW_ID", "id", "ID", "rowNumber", "row"])
      ).trim(),
      name: getRecordValue(record, ["name", "nome", "NOME", "Nome"]) || "",
      phone: normalizePhone(
        getRecordValue(record, ["phone", "numero", "número", "NUMERO", "NÚMERO", "Número"]) || ""
      ),
      optIn: parseOptIn(record),
      tags: getRecordValue(record, ["tags", "TAGS", "Tags"]) || "",
      labelName: getRecordValue(record, ["label_name", "etiqueta", "ETIQUETA", "Etiqueta"]) || ""
    }))
    .filter((record) => record.phone);
}

async function updateAppsScriptRow(rowId, status, note = "") {
  if (!rowId) {
    return;
  }

  const response = await fetch(CONFIG.appsScriptUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      action: "update",
      token: CONFIG.appsScriptToken,
      rowId,
      status,
      note,
      sentAt: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao atualizar linha ${rowId} no Apps Script: HTTP ${response.status}`);
  }
}

async function watchOptOutKeywords(messages) {
  const optOutSet = await getOptOutSet();
  let changed = false;

  for (const message of messages) {
    if (!message.key?.remoteJid || message.key.fromMe) {
      continue;
    }

    const text = extractText(message.message).trim().toUpperCase();
    if (!STOP_KEYWORDS.has(text)) {
      continue;
    }

    optOutSet.add(message.key.remoteJid);
    changed = true;
    console.log(`Descadastro registrado para ${message.key.remoteJid}.`);
  }

  if (changed) {
    await fs.writeFile(OPTOUT_FILE, JSON.stringify([...optOutSet], null, 2));
  }
}

async function handleReplyFunnelMessages(socket, messages) {
  if (CONFIG.autoStage2AfterGreeting) {
    return;
  }

  if (!CONFIG.stage1LabelId || !CONFIG.stage2LabelId || !CONFIG.stage2VariantsFile) {
    return;
  }

  const funnelState = await getFunnelState();
  const optOutSet = await getOptOutSet();
  const followUpMessages = await loadMessages({
    "variants-file": CONFIG.stage2VariantsFile
  });

  if (followUpMessages.length === 0) {
    return;
  }

  const cycleState = await getMessageCycleState(followUpMessages, STAGE2_MESSAGE_CYCLE_FILE);
  const fallbackMediaAsset = await getMediaAssetByName(CONFIG.stage2MediaName);
  const mediaCache = new Map();
  let shouldSaveFunnelState = false;
  let stageTwoTriggered = false;

  for (const message of messages) {
    const jid = message.key?.remoteJid;
    const inboundMessageId = message.key?.id;

    if (!jid || message.key?.fromMe || !isDirectChatJid(jid) || !hasAnyInboundContent(message.message)) {
      continue;
    }

    if (hasProcessedInboundMessage(funnelState, inboundMessageId)) {
      continue;
    }

    const normalizedText = extractText(message.message).trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalizedText) || optOutSet.has(jid)) {
      rememberProcessedInboundMessage(funnelState, inboundMessageId);
      shouldSaveFunnelState = true;
      continue;
    }

    const { key: contactStateKey, contactState, candidateKeys: inboundChatKeys } =
      await resolveFunnelContactState(socket, funnelState, jid);

    if (hasStageTwoBeenSent(contactState)) {
      console.log(
        `Resposta adicional recebida de ${contactState.name || jidToPhone(jid)}, mas a etapa 2 ja havia sido enviada. Nenhum reenvio sera feito.`
      );
      rememberProcessedInboundMessage(funnelState, inboundMessageId);
      shouldSaveFunnelState = true;
      updateFunnelStateCache(funnelState);
      continue;
    }

    if (contactState?.stage !== "awaiting_response") {
      console.log(
        `Resposta recebida de ${jid}, mas o contato nao foi encontrado na etapa aguardando resposta. Chaves testadas: ${inboundChatKeys.join(", ")}`
      );
      rememberProcessedInboundMessage(funnelState, inboundMessageId);
      shouldSaveFunnelState = true;
      continue;
    }

    if (replyFlowLocks.has(jid)) {
      continue;
    }

    replyFlowLocks.add(jid);

    try {
      const variant = getNextVariant(cycleState);
      const selectedMediaAsset = await resolveVariantMediaAsset(
        variant,
        fallbackMediaAsset,
        mediaCache
      );
      const text = formatMessage(variant.text, {
        name: contactState.name || "cliente",
        phone: contactState.phone || jidToPhone(jid)
      });
      const interactiveButtons = shouldUseStage2InteractiveButtons(selectedMediaAsset)
        ? buildStage2InteractiveButtons(variant.id)
        : null;

      await sleep(REPLY_REACTION_DELAY_MS);

      try {
        await socket.sendMessage(jid, {
          react: {
            text: REPLY_HEART_REACTION,
            key: message.key
          }
        });
      } catch (reactionError) {
        console.log(
          `Nao foi possivel reagir com coracao na mensagem de ${contactState.name || jidToPhone(jid)}: ${reactionError.message || reactionError}`
        );
      }

      await sleep(CONFIG.stage2DelayMs);

      try {
        await socket.removeChatLabel(jid, CONFIG.stage1LabelId);
      } catch (error) {
        console.log(
          `Nao foi possivel remover a etiqueta ${CONFIG.stage1LabelId} de ${contactState.name || jidToPhone(jid)}: ${error.message || error}`
        );
      }

      await socket.addChatLabel(jid, CONFIG.stage2LabelId);

      try {
        await sendPreparedMessage(socket, jid, {
          mediaAsset: selectedMediaAsset,
          text,
          interactiveButtons,
          quoted: message
        });
      } catch (sendError) {
        try {
          await socket.removeChatLabel(jid, CONFIG.stage2LabelId);
        } catch {}

        try {
          await socket.addChatLabel(jid, CONFIG.stage1LabelId);
        } catch {}

        throw sendError;
      }

      markStageTwoSent(funnelState, contactStateKey || jid, inboundMessageId, variant, selectedMediaAsset);
      rememberProcessedInboundMessage(funnelState, inboundMessageId);
      shouldSaveFunnelState = true;
      stageTwoTriggered = true;
      updateFunnelStateCache(funnelState);
      console.log(
        `Resposta recebida de ${contactState.name || jidToPhone(jid)}. Etiqueta ${CONFIG.stage1LabelId} trocada por ${CONFIG.stage2LabelId} e etapa 2 enviada com variacao ${variant.id}.`
      );
    } catch (error) {
      console.error(
        `Erro ao processar resposta de ${contactState.name || jidToPhone(jid)}:`,
        error.message || error
      );
    } finally {
      replyFlowLocks.delete(jid);
    }
  }

  if (stageTwoTriggered) {
    await saveMessageCycleState(cycleState, STAGE2_MESSAGE_CYCLE_FILE);
  }

  if (shouldSaveFunnelState) {
    await saveFunnelState(funnelState);
  }
}

async function handleLabelAssociationUpdate(socket, event) {
  if (event?.association?.type !== "label_jid") {
    return;
  }

  const { chatId, labelId } = event.association;
  if (!chatId || !labelId) {
    return;
  }

  if (labelId !== CONFIG.stage1LabelId && labelId !== CONFIG.stage2LabelId) {
    return;
  }

  const funnelState = await getFunnelState();
  const resolvedContact = await resolveFunnelContactState(socket, funnelState, chatId);
  const contactKey = resolvedContact.key || resolvedContact.preferredKey;
  const existing = resolvedContact.contactState || {
    jid: contactKey,
    phone: jidToPhone(contactKey),
    name: "",
    requestedLabelName: "",
    sourceRowId: "",
    stage1LabelId: CONFIG.stage1LabelId,
    stage2LabelId: CONFIG.stage2LabelId,
    stage1VariantId: null,
    stage1SentAt: "",
    stage2SentAt: "",
    stage2VariantId: null,
    lastInboundMessageId: "",
    lastInboundAt: ""
  };

  if (event.type === "add" && labelId === CONFIG.stage1LabelId) {
    if (hasStageTwoBeenSent(existing)) {
      return;
    }

    funnelState.contacts[contactKey] = {
      ...existing,
      stage: "awaiting_response",
      jid: contactKey,
      stage1LabelId: CONFIG.stage1LabelId
    };
    await saveFunnelState(funnelState);
    return;
  }

  if (event.type === "add" && labelId === CONFIG.stage2LabelId) {
    funnelState.contacts[contactKey] = {
      ...existing,
      stage: "followup_sent",
      jid: contactKey,
      stage2LabelId: CONFIG.stage2LabelId
    };
    await saveFunnelState(funnelState);
    return;
  }

  if (event.type === "remove" && labelId === CONFIG.stage1LabelId && funnelState.contacts[contactKey]) {
    funnelState.contacts[contactKey] = {
      ...existing,
      jid: contactKey
    };
    await saveFunnelState(funnelState);
  }
}

async function getMediaManifest() {
  await ensureDataFiles();
  const content = await fs.readFile(MEDIA_MANIFEST_FILE, "utf8");
  return JSON.parse(content);
}

async function saveMediaManifest(manifest) {
  await ensureDataFiles();
  await fs.writeFile(MEDIA_MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

async function getMessageCycleState(messages, cycleFile = MESSAGE_CYCLE_FILE) {
  await ensureDataFiles();

  const saved = JSON.parse(await fs.readFile(cycleFile, "utf8"));
  const baseMessages = messages.map((message, index) => normalizeVariantConfig(message, index + 1));
  const signature = JSON.stringify(baseMessages);

  if (saved.signature !== signature) {
    return {
      signature,
      baseMessages,
      queue: shuffleMessages([...baseMessages])
    };
  }

  const messagesById = new Map(baseMessages.map((message) => [message.id, message]));
  const queue = Array.isArray(saved.queue)
    ? saved.queue
        .map((item) => messagesById.get(item.id))
        .filter(Boolean)
    : [];

  return {
    signature,
    baseMessages,
    queue: queue.length > 0 ? queue : shuffleMessages([...baseMessages])
  };
}

async function saveMessageCycleState(cycleState, cycleFile = MESSAGE_CYCLE_FILE) {
  await ensureDataFiles();
  await fs.writeFile(
    cycleFile,
    JSON.stringify(
      {
        signature: cycleState.signature,
        queue: cycleState.queue
      },
      null,
      2
    )
  );
}

async function createStageTwoFlow() {
  if (!CONFIG.stage2VariantsFile || !CONFIG.stage2LabelId) {
    return null;
  }

  const messages = await loadMessages({
    "variants-file": CONFIG.stage2VariantsFile
  });

  if (messages.length === 0) {
    return null;
  }

  return {
    cycleState: await getMessageCycleState(messages, STAGE2_MESSAGE_CYCLE_FILE),
    fallbackMediaAsset: await getMediaAssetByName(CONFIG.stage2MediaName),
    mediaCache: new Map()
  };
}

async function sendStageTwoAfterDelay({
  socket,
  jid,
  contact,
  stage2Flow,
  funnelState,
  funnelKey,
  index,
  totalContacts
}) {
  if (!stage2Flow) {
    return null;
  }

  console.log(
    `(${index + 1}/${totalContacts}) Aguardando ${Math.round(CONFIG.stage2DelayMs / 1000)}s para enviar a etapa 2 a ${contact.name || contact.phone}.`
  );
  await sleep(CONFIG.stage2DelayMs);

  const variant = getNextVariant(stage2Flow.cycleState);
  const selectedMediaAsset = await resolveVariantMediaAsset(
    variant,
    stage2Flow.fallbackMediaAsset,
    stage2Flow.mediaCache
  );
  const text = formatMessage(variant.text, contact);
  const interactiveButtons = shouldUseStage2InteractiveButtons(selectedMediaAsset)
    ? buildStage2InteractiveButtons(variant.id)
    : null;
  let removedStage1Label = false;
  let addedStage2Label = false;

  try {
    await socket.removeChatLabel(jid, CONFIG.stage1LabelId);
    removedStage1Label = true;
  } catch (error) {
    console.log(
      `Nao foi possivel remover a etiqueta ${CONFIG.stage1LabelId} de ${contact.name || contact.phone}: ${error.message || error}`
    );
  }

  try {
    await socket.addChatLabel(jid, CONFIG.stage2LabelId);
    addedStage2Label = true;
  } catch (error) {
    console.log(
      `Nao foi possivel aplicar a etiqueta ${CONFIG.stage2LabelId} em ${contact.name || contact.phone}: ${error.message || error}`
    );
  }

  try {
    await sendPreparedMessage(socket, jid, {
      mediaAsset: selectedMediaAsset,
      text,
      interactiveButtons
    });
  } catch (error) {
    if (addedStage2Label) {
      try {
        await socket.removeChatLabel(jid, CONFIG.stage2LabelId);
      } catch {}
    }

    if (removedStage1Label) {
      try {
        await socket.addChatLabel(jid, CONFIG.stage1LabelId);
      } catch {}
    }

    throw error;
  }

  markStageTwoSent(funnelState, funnelKey, "", variant, selectedMediaAsset);
  await saveMessageCycleState(stage2Flow.cycleState, STAGE2_MESSAGE_CYCLE_FILE);
  await saveFunnelState(funnelState);

  console.log(
    `(${index + 1}/${totalContacts}) Etapa 2 enviada para ${contact.name || contact.phone} com variacao ${variant.id}.`
  );

  return {
    sentAt: new Date().toISOString(),
    variantId: variant.id,
    variantText: variant.text,
    media: selectedMediaAsset
      ? {
          name: selectedMediaAsset.name,
          type: selectedMediaAsset.type,
          fileName: selectedMediaAsset.fileName
        }
      : null
  };
}

function peekNextMessageVariants(cycleState, count) {
  const queue = [...cycleState.queue];
  const variants = [];

  while (variants.length < count && cycleState.baseMessages.length > 0) {
    if (queue.length === 0) {
      queue.push(...shuffleMessages([...cycleState.baseMessages]));
    }

    variants.push(queue.shift());
  }

  return variants;
}

async function ensureFile(filePath, contents) {
  try {
    await fs.access(filePath);
  } catch {
    try {
      await fs.writeFile(filePath, contents);
    } catch (writeError) {
      if (writeError.code !== "EACCES") {
        throw writeError;
      }
      console.log(`Aviso: sem permissao para criar "${filePath}". Crie o arquivo manualmente.`);
    }
  }
}

function extractText(message = {}) {
  if (message.conversation) {
    return message.conversation;
  }

  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text;
  }

  if (message.buttonsResponseMessage?.selectedDisplayText) {
    return message.buttonsResponseMessage.selectedDisplayText;
  }

  if (message.templateButtonReplyMessage?.selectedDisplayText) {
    return message.templateButtonReplyMessage.selectedDisplayText;
  }

  if (message.interactiveResponseMessage?.body?.text) {
    return message.interactiveResponseMessage.body.text;
  }

  const interactiveParamsJson =
    message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (interactiveParamsJson) {
    try {
      const parsed = JSON.parse(interactiveParamsJson);
      return parsed.display_text || parsed.id || parsed.title || "";
    } catch {
      return interactiveParamsJson;
    }
  }

  return "";
}

function shuffleMessages(messages) {
  for (let index = messages.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [messages[index], messages[randomIndex]] = [messages[randomIndex], messages[index]];
  }

  return messages;
}

async function importMediaAsset(argv) {
  await ensureDataFiles();

  const options = parseCliArgs(argv);
  const source = getRequiredString(options.source, "Informe `--source` com o caminho do arquivo.");
  const name = sanitizeAssetName(
    getRequiredString(options.name, "Informe `--name` para salvar a midia no bot.")
  );
  const providedType = getOptionalString(options.type);
  const sourcePath = path.resolve(source);
  const stats = await fs.stat(sourcePath);

  if (!stats.isFile()) {
    throw new Error("O caminho informado em `--source` nao e um arquivo.");
  }

  const extension = path.extname(sourcePath).toLowerCase();
  const type = resolveMediaType(providedType, extension);
  const targetFileName = `${name}${extension}`;
  const targetPath = path.join(MEDIA_DIR, targetFileName);
  const manifest = await getMediaManifest();

  await mkdirSafe(MEDIA_DIR);
  await fs.copyFile(sourcePath, targetPath);

  manifest[name] = {
    name,
    type,
    fileName: targetFileName,
    originalName: path.basename(sourcePath),
    savedAt: new Date().toISOString()
  };

  await saveMediaManifest(manifest);

  console.log(`Midia salva com sucesso como "${name}".`);
  console.log(`Tipo: ${type}.`);
  console.log(`Arquivo interno: ${targetPath}.`);
}

async function listMediaAssets() {
  await ensureDataFiles();
  const manifest = await getMediaManifest();
  const assets = Object.values(manifest).sort((left, right) => left.name.localeCompare(right.name));

  if (assets.length === 0) {
    console.log("Nenhuma midia cadastrada.");
    return;
  }

  console.log("Midias cadastradas:");
  for (const asset of assets) {
    console.log(`- ${asset.name} | ${asset.type} | ${path.join(MEDIA_DIR, asset.fileName)}`);
  }
}

async function getMediaAssetByName(name) {
  if (!name) {
    return null;
  }

  await ensureDataFiles();
  const manifest = await getMediaManifest();
  const asset = manifest[name];

  if (!asset) {
    throw new Error(`A midia "${name}" nao foi encontrada. Use \`npm run media:list\` para consultar.`);
  }

  return {
    ...asset,
    path: path.join(MEDIA_DIR, asset.fileName)
  };
}

function resolveMediaType(providedType, extension) {
  if (SUPPORTED_MEDIA_TYPES.has(providedType)) {
    return providedType;
  }

  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    return "image";
  }

  if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(extension)) {
    return "video";
  }

  throw new Error("Nao foi possivel identificar o tipo da midia. Use `--type image` ou `--type video`.");
}

function sanitizeAssetName(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
}

function getRequiredString(value, message) {
  const normalized = getOptionalString(value);
  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function getOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveChatLabelId(labelName, labelMap, fallbackLabelId) {
  const normalizedLabelName = normalizeLabelName(labelName);
  if (normalizedLabelName) {
    if (labelMap[normalizedLabelName]) {
      return String(labelMap[normalizedLabelName]).trim();
    }

    if (/^\d+$/.test(normalizedLabelName)) {
      return normalizedLabelName;
    }

    return "";
  }

  return fallbackLabelId || "";
}

function normalizeLabelName(value) {
  return String(value || "").trim().toLowerCase();
}

function decodeSimpleJid(jid) {
  const value = String(jid || "");
  const atIndex = value.indexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const server = value.slice(atIndex + 1);
  const userCombined = value.slice(0, atIndex);
  const [userAgent] = userCombined.split(":");
  const [user] = userAgent.split("_");

  if (!user || !server) {
    return null;
  }

  return {
    user,
    server
  };
}

function isDirectChatJid(jid) {
  return typeof jid === "string" && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));
}

function jidToPhone(jid) {
  return String(jid || "").replace(/@.+$/, "");
}

function normalizeJidKey(jid) {
  const decoded = decodeSimpleJid(jid);
  if (!decoded) {
    return "";
  }

  return `${decoded.user}@${decoded.server === "c.us" ? "s.whatsapp.net" : decoded.server}`;
}

function areLikelySameChatJid(leftJid, rightJid) {
  const left = decodeSimpleJid(leftJid);
  const right = decodeSimpleJid(rightJid);

  if (!left || !right) {
    return false;
  }

  return left.user === right.user;
}

function findFunnelContactStateByJid(state, jid) {
  if (!jid) {
    return { key: "", contactState: null };
  }

  if (state.contacts[jid]) {
    return {
      key: jid,
      contactState: state.contacts[jid]
    };
  }

  const normalizedJid = normalizeJidKey(jid);
  if (normalizedJid && state.contacts[normalizedJid]) {
    return {
      key: normalizedJid,
      contactState: state.contacts[normalizedJid]
    };
  }

  for (const [key, contactState] of Object.entries(state.contacts)) {
    if (areLikelySameChatJid(key, jid)) {
      return {
        key,
        contactState
      };
    }
  }

  return {
    key: "",
    contactState: null
  };
}

async function resolveInboundChatKeys(socket, jid) {
  const keys = [];
  const pushKey = (value) => {
    const normalized = normalizeJidKey(value) || String(value || "");
    if (normalized && !keys.includes(normalized)) {
      keys.push(normalized);
    }
  };

  pushKey(jid);

  if (String(jid || "").endsWith("@lid") || String(jid || "").endsWith("@hosted.lid")) {
    try {
      const pnJid = await socket.signalRepository?.lidMapping?.getPNForLID?.(jid);
      pushKey(pnJid);
    } catch (error) {
      console.log(`Falha ao resolver LID ${jid} para PN: ${error.message || error}`);
    }
  }

  return keys;
}

async function resolveFunnelContactState(socket, state, jid) {
  const candidateKeys = await resolveInboundChatKeys(socket, jid);
  const matches = [];
  const matchedKeys = new Set();

  for (const candidateJid of candidateKeys) {
    const found = findFunnelContactStateByJid(state, candidateJid);
    if (found.contactState) {
      if (!matchedKeys.has(found.key)) {
        matches.push(found);
        matchedKeys.add(found.key);
      }
    }
  }

  const preferredMatch =
    matches.find((match) => hasStageTwoBeenSent(match.contactState)) ||
    matches.find((match) => match.contactState?.stage === "awaiting_response") ||
    matches[0];

  if (preferredMatch) {
    return {
      key: preferredMatch.key,
      contactState: preferredMatch.contactState,
      candidateKeys,
      preferredKey: preferredMatch.key
    };
  }

  return {
    key: "",
    contactState: null,
    candidateKeys,
    preferredKey: candidateKeys.find((candidateJid) => candidateJid.endsWith("@s.whatsapp.net")) ||
      candidateKeys[0] ||
      normalizeJidKey(jid) ||
      String(jid || "")
  };
}

function hasAnyInboundContent(message) {
  return Boolean(message && typeof message === "object" && Object.keys(message).length > 0);
}

function hasProcessedInboundMessage(state, messageId) {
  return Boolean(messageId && state.processedInboundMessageIds?.[messageId]);
}

function rememberProcessedInboundMessage(state, messageId) {
  if (!messageId) {
    return;
  }

  state.processedInboundMessageIds[messageId] = new Date().toISOString();
  const entries = Object.entries(state.processedInboundMessageIds);

  if (entries.length <= 2000) {
    return;
  }

  entries
    .sort((left, right) => String(left[1]).localeCompare(String(right[1])))
    .slice(0, entries.length - 2000)
    .forEach(([id]) => {
      delete state.processedInboundMessageIds[id];
    });
}

function hasStageTwoBeenSent(contactState) {
  if (!contactState || typeof contactState !== "object") {
    return false;
  }

  return Boolean(
    contactState.stage === "followup_sent" ||
      contactState.stage2SentAt ||
      (contactState.stage2VariantId !== null && contactState.stage2VariantId !== undefined)
  );
}

function updateFunnelStateCache(state) {
  funnelStateCache = cloneFunnelState(state);
}

function markStageOneAwaitingResponse(state, jid, contact, variant, labelId) {
  state.contacts[jid] = {
    ...(state.contacts[jid] || {}),
    stage: "awaiting_response",
    jid,
    phone: contact.phone || jidToPhone(jid),
    name: contact.name || "",
    requestedLabelName: contact.labelName || "",
    sourceRowId: contact.rowId || "",
    stage1LabelId: labelId || "",
    stage2LabelId: CONFIG.stage2LabelId,
    stage1VariantId: variant?.id ?? null,
    stage1SentAt: new Date().toISOString(),
    stage2SentAt: "",
    stage2VariantId: null,
    lastInboundMessageId: "",
    lastInboundAt: ""
  };
}

function markStageTwoSent(state, jid, inboundMessageId, variant, mediaAsset) {
  const previous = state.contacts[jid] || {};
  state.contacts[jid] = {
    ...previous,
    stage: "followup_sent",
    stage2VariantId: variant?.id ?? null,
    stage2SentAt: new Date().toISOString(),
    lastInboundMessageId: inboundMessageId || "",
    lastInboundAt: new Date().toISOString(),
    lastStage2MediaName: mediaAsset?.name || ""
  };
}

function getGreeting() {
  const dayPeriod = getPeriodOfDayGreeting();
  return dayPeriod.charAt(0).toUpperCase() + dayPeriod.slice(1);
}

function getStage2ButtonEmojiSuffix(seed = 0) {
  const emojiVariants = [
    "\uD83D\uDD25\uD83C\uDF9F\uFE0F",
    "\uD83E\uDD69\uD83C\uDF96\uFE0F",
    "\uD83C\uDF56\uD83D\uDE80",
    "\uD83C\uDF96\uFE0F\uD83D\uDD25",
    "\uD83C\uDF96\uFE0F\uD83C\uDF89",
    "\uD83C\uDF56\uD83D\uDE0E"
  ];
  return emojiVariants[Math.abs(Number(seed) || 0) % emojiVariants.length];
}

function shouldUseStage2InteractiveButtons(mediaAsset) {
  return Boolean(
    CONFIG.stage2UseInteractiveButtons &&
      !mediaAsset &&
      CONFIG.stage2ButtonLinkUrl &&
      CONFIG.stage2ButtonLinkText &&
      CONFIG.stage2ButtonQuickReplyText
  );
}

function buildStage2InteractiveButtons(seed = 0) {
  const linkLabel = `${CONFIG.stage2ButtonLinkText} ${getStage2ButtonEmojiSuffix(seed)}`.trim();
  return [
    {
      name: "cta_url",
      buttonParamsJson: JSON.stringify({
        display_text: linkLabel,
        url: CONFIG.stage2ButtonLinkUrl,
        merchant_url: CONFIG.stage2ButtonLinkUrl
      })
    },
    {
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: CONFIG.stage2ButtonQuickReplyText,
        id: CONFIG.stage2ButtonQuickReplyId
      })
    }
  ];
}

function getPeriodOfDayGreeting() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: CONFIG.timezone }));
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "bom dia";
  if (hour >= 12 && hour < 18) return "boa tarde";
  return "boa noite";
}

async function createSocket({ printQrInTerminal = true } = {}) {
  await ensureDataFiles();

  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ["Codex Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    await watchOptOutKeywords(messages);
    await handleReplyFunnelMessages(socket, messages);
  });
  socket.ev.on("labels.association", async (event) => {
    await handleLabelAssociationUpdate(socket, event);
  });
  socket.ev.on("labels.edit", async (label) => {
    await registerDiscoveredLabel(label);
  });

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && printQrInTerminal && !CONFIG.pairingPhoneNumber) {
      qrcodeTerminal.generate(qr, { small: true });
      console.log("Escaneie o QR Code acima no WhatsApp.");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Conexao encerrada. Tentando reconectar...");
        await createSocket({ printQrInTerminal });
        return;
      }

      console.log("Sessao desconectada. Execute `npm run auth` para autenticar novamente.");
    }

    if (connection === "open") {
      console.log("WhatsApp conectado com sucesso.");
    }
  });

  return socket;
}

async function registerDiscoveredLabel(label) {
  if (!label?.id) {
    return;
  }

  const existing = await getDiscoveredLabels();
  const next = existing.filter((item) => item.id !== label.id);
  next.push({
    id: label.id,
    name: label.name || "",
    deleted: Boolean(label.deleted),
    color: label.color ?? null,
    predefinedId: label.predefinedId || "",
    updatedAt: new Date().toISOString()
  });

  await saveDiscoveredLabels(next);
  console.log(`Etiqueta detectada: ${label.name || "(sem nome)"} -> ${label.id}`);
}

async function watchLabels() {
  await createSocket();
  console.log("Monitor de etiquetas ativo.");
  console.log(`Arquivo de saida: ${DISCOVERED_LABELS_FILE}`);
  console.log("Se nenhuma etiqueta aparecer, crie ou renomeie uma etiqueta no WhatsApp Business para forcar o evento.");
}

async function startAuthSession() {
  const socket = await createSocket();

  if (CONFIG.pairingPhoneNumber && !socket.authState?.creds?.registered) {
    const code = await socket.requestPairingCode(CONFIG.pairingPhoneNumber);
    console.log(`Codigo de pareamento para ${CONFIG.pairingPhoneNumber}: ${code}`);
  }

  console.log("Sessao de autenticacao ativa. Pressione Ctrl+C quando terminar.");
}

async function startDaemon() {
  const socket = await createSocket();

  if (hasAppsScriptConfig()) {
    console.log(
      `Modo Apps Script ativo. Consultando a planilha a cada ${CONFIG.appsScriptPollMs}ms.`
    );
    startAppsScriptPolling(socket);
  } else {
    console.log("Modo listener ativo. Configure APPS_SCRIPT_URL para sincronizar com Google Sheets.");
  }
}

function startAppsScriptPolling(socket) {
  let running = false;
  const sendOnlyStageTwo = CONFIG.appsScriptStageMode === "stage2";

  const runCycle = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      const queuedContacts = await fetchAppsScriptQueue();

      if (queuedContacts.length === 0) {
        return;
      }

      console.log(`Apps Script retornou ${queuedContacts.length} contato(s) pendente(s).`);
      await processContacts({
        socket,
        contacts: queuedContacts,
        messages: await loadMessages({
          "variants-file": sendOnlyStageTwo
            ? CONFIG.stage2VariantsFile
            : CONFIG.stage1VariantsFile
        }),
        mediaAsset: null,
        chatLabelId: sendOnlyStageTwo ? CONFIG.stage2LabelId : CONFIG.stage1LabelId,
        messageLabelId: CONFIG.messageLabelId,
        shouldUpdateAppsScript: true,
        ignoreContactLabel: true,
        funnelStage: sendOnlyStageTwo ? "stage2" : "stage1",
        cycleFile: sendOnlyStageTwo ? STAGE2_MESSAGE_CYCLE_FILE : STAGE1_MESSAGE_CYCLE_FILE
      });
    } catch (error) {
      console.error("Erro ao sincronizar com Apps Script:", error.message || error);
    } finally {
      running = false;
    }
  };

  void runCycle();
  setInterval(() => {
    void runCycle();
  }, CONFIG.appsScriptPollMs);
}

async function waitForConnection(socket, timeoutMs = 30000) {
  if (socket.user) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo limite excedido aguardando conexao com o WhatsApp."));
    }, timeoutMs);

    const onUpdate = ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        cleanup();
        resolve();
        return;
      }

      if (connection === "close") {
        cleanup();
        reject(lastDisconnect?.error || new Error("Conexao encerrada antes de abrir."));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.ev.off("connection.update", onUpdate);
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

async function runCampaign(argv) {
  await ensureDataFiles();

  const options = parseCliArgs(argv);
  const csvPath = options.csv || "data/contacts.example.csv";
  const loadedMessages = await loadMessages(options);
  const messages = loadedMessages.length > 0 ? loadedMessages : [normalizeVariantConfig("", 1)];
  const mediaName = getOptionalString(options.media);
  const mediaAsset = await getMediaAssetByName(mediaName);
  const confirmSend = options["confirm-send"] === true;
  const delayMs = options.delay ? Number.parseInt(options.delay, 10) : CONFIG.minDelayMs;
  const maxMessages =
    options.limit ? Number.parseInt(options.limit, 10) : CONFIG.maxMessagesPerRun;
  const chatLabelId = getOptionalString(options["chat-label-id"]) || CONFIG.chatLabelId;
  const messageLabelId = getOptionalString(options["message-label-id"]) || CONFIG.messageLabelId;

  if (loadedMessages.length === 0 && !mediaAsset) {
    throw new Error(
      "Informe `--message`, `--message-file`, `--variants-file` ou selecione uma midia com `--media`."
    );
  }

  const contacts = await loadContactsFromCsv(csvPath);
  const optOutSet = await getOptOutSet();
  const eligibleContacts = contacts
    .filter((contact) => contact.optIn)
    .filter((contact) => !optOutSet.has(toJid(contact.phone)))
    .slice(0, maxMessages);

  console.log(`Campanha carregada: ${contacts.length} contatos no CSV.`);
  console.log(`Elegiveis para envio: ${eligibleContacts.length}.`);
  console.log(`Delay entre mensagens: ${delayMs}ms a ${Math.max(delayMs, CONFIG.maxDelayMs)}ms.`);
  if (loadedMessages.length > 1) {
    console.log(`Variacoes carregadas: ${loadedMessages.length}.`);
  }
  const linkedMediaCount = new Set(
    loadedMessages.map((variant) => getOptionalString(variant.mediaName)).filter(Boolean)
  ).size;
  if (linkedMediaCount > 0) {
    console.log(`Variacoes com midia vinculada: ${linkedMediaCount}.`);
  }
  if (mediaAsset) {
    console.log(`Midia selecionada: ${mediaAsset.name} (${mediaAsset.type}).`);
  }
  if (chatLabelId) {
    console.log(`Etiqueta de conversa ativa: ${chatLabelId}.`);
  }
  if (messageLabelId) {
    console.log(`Etiqueta de mensagem ativa: ${messageLabelId}.`);
  }

  if (!confirmSend) {
    console.log("Modo simulacao ativo. Nenhuma mensagem sera enviada.");
    await previewMessages(eligibleContacts, messages, mediaAsset);
    console.log("Para enviar de verdade, rode novamente com `--confirm-send`.");
    return;
  }

  if (eligibleContacts.length === 0) {
    console.log("Nenhum contato elegivel para envio.");
    return;
  }

  const socket = await createSocket({ printQrInTerminal: false });
  await waitForConnection(socket);
  const sent = await processContacts({
    socket,
    contacts: eligibleContacts,
    messages,
    mediaAsset,
    chatLabelId,
    messageLabelId,
    minDelayMs: delayMs,
    maxDelayMs: Math.max(delayMs, CONFIG.maxDelayMs)
  });
  const skipped = contacts.length - eligibleContacts.length;

  await saveReport(sent, {
    totalLoaded: contacts.length,
    totalEligible: eligibleContacts.length,
    totalSkipped: skipped
  });
}

async function processContacts({
  socket,
  contacts,
  messages,
  mediaAsset,
  chatLabelId,
  messageLabelId,
  minDelayMs = CONFIG.minDelayMs,
  maxDelayMs = CONFIG.maxDelayMs,
  shouldUpdateAppsScript = false,
  ignoreContactLabel = false,
  funnelStage = "",
  cycleFile = MESSAGE_CYCLE_FILE
}) {
  const sent = [];
  const cycleState = await getMessageCycleState(messages, cycleFile);
  const labelMap = await getLabelMap();
  const mediaCache = new Map();
  const funnelState = funnelStage === "stage1" ? await getFunnelState() : null;
  const autoStage2Flow =
    funnelStage === "stage1" && CONFIG.autoStage2AfterGreeting
      ? await createStageTwoFlow()
      : null;
  let shouldSaveFunnelState = false;

  for (const [index, contact] of contacts.entries()) {
    const jid = toJid(contact.phone);

    try {
      const [exists] = await socket.onWhatsApp(jid);
      if (!exists?.exists) {
        console.log(`(${index + 1}/${contacts.length}) Numero sem WhatsApp: ${contact.phone}`);
        if (shouldUpdateAppsScript) {
          await updateAppsScriptRow(contact.rowId, "ERRO", "Numero sem WhatsApp");
        }
        continue;
      }

      const variant = getNextVariant(cycleState);
      const selectedMediaAsset = await resolveVariantMediaAsset(variant, mediaAsset, mediaCache);
      const text = formatMessage(variant.text, contact);
      const interactiveButtons =
        funnelStage === "stage2" && shouldUseStage2InteractiveButtons(selectedMediaAsset)
          ? buildStage2InteractiveButtons(variant.id + index)
          : null;
      const sentMessage = await sendPreparedMessage(socket, jid, {
        mediaAsset: selectedMediaAsset,
        text,
        interactiveButtons
      });
      const appliedLabels = [];
      const contactChatLabelId = ignoreContactLabel
        ? getOptionalString(chatLabelId)
        : resolveChatLabelId(contact.labelName, labelMap, chatLabelId);

      if (contactChatLabelId) {
        await socket.addChatLabel(jid, contactChatLabelId);
        appliedLabels.push({
          type: "chat",
          labelId: contactChatLabelId,
          labelName: contact.labelName || ""
        });
      } else if (contact.labelName) {
        console.log(
          `Etiqueta "${contact.labelName}" nao encontrada no mapa local. O envio seguiu sem etiqueta para ${contact.name || contact.phone}.`
        );
      }

      if (messageLabelId && sentMessage?.key?.id) {
        await socket.addMessageLabel(jid, sentMessage.key.id, messageLabelId);
        appliedLabels.push({ type: "message", labelId: messageLabelId });
      }

      await saveMessageCycleState(cycleState, cycleFile);
      let stageTwoResult = null;
      if (funnelState && contactChatLabelId === CONFIG.stage1LabelId) {
        const funnelKey = normalizeJidKey(jid) || jid;
        markStageOneAwaitingResponse(funnelState, funnelKey, contact, variant, contactChatLabelId);
        await saveFunnelState(funnelState);

        if (autoStage2Flow) {
          stageTwoResult = await sendStageTwoAfterDelay({
            socket,
            jid,
            contact,
            stage2Flow: autoStage2Flow,
            funnelState,
            funnelKey,
            index,
            totalContacts: contacts.length
          });
        }
      }
      sent.push({
        phone: contact.phone,
        name: contact.name,
        sentAt: new Date().toISOString(),
        variantId: variant.id,
        variantText: variant.text,
        requestedLabelName: contact.labelName || "",
        media: selectedMediaAsset
          ? {
              name: selectedMediaAsset.name,
              type: selectedMediaAsset.type,
              fileName: selectedMediaAsset.fileName
            }
          : null,
        appliedLabels,
        autoFollowUp: stageTwoResult
      });

      console.log(
        `(${index + 1}/${contacts.length}) Envio concluido para ${contact.name || contact.phone} com variacao ${variant.id}`
      );
      if (appliedLabels.length > 0) {
        console.log(
          `Etiquetas aplicadas: ${appliedLabels.map((label) => `${label.type}:${label.labelId}`).join(", ")}`
        );
      }

      if (shouldUpdateAppsScript) {
        await updateAppsScriptRow(contact.rowId, "ENVIADO", "Mensagem enviada com sucesso");
      }
    } catch (error) {
      console.error(`Erro ao enviar para ${contact.name || contact.phone}:`, error.message || error);
      if (shouldUpdateAppsScript) {
        await updateAppsScriptRow(contact.rowId, "ERRO", String(error.message || error));
      }
    }

    if (index < contacts.length - 1) {
      const nextDelayMs = getRandomDelayMs(minDelayMs, maxDelayMs);
      console.log(`Aguardando ${Math.round(nextDelayMs / 1000)}s antes do proximo envio.`);
      await sleep(nextDelayMs);
    }
  }

  if (shouldSaveFunnelState && funnelState) {
    await saveFunnelState(funnelState);
  }

  return sent;
}

function getRandomDelayMs(minDelayMs, maxDelayMs) {
  const normalizedMin = Math.max(1000, Number(minDelayMs) || CONFIG.minDelayMs);
  const normalizedMax = Math.max(normalizedMin, Number(maxDelayMs) || CONFIG.maxDelayMs);
  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

async function loadMessages(options) {
  if (typeof options.message === "string") {
    return [normalizeVariantConfig({ text: options.message }, 1)];
  }

  if (typeof options["message-file"] === "string") {
    return [
      normalizeVariantConfig({ text: await fs.readFile(options["message-file"], "utf8") }, 1)
    ];
  }

  if (typeof options["variants-file"] === "string") {
    const content = await fs.readFile(options["variants-file"], "utf8");
    const values = JSON.parse(content);

    if (!Array.isArray(values)) {
      throw new Error("O arquivo informado em `--variants-file` deve conter um array JSON.");
    }

    return values
      .map((value, index) => normalizeVariantConfig(value, index + 1))
      .filter((variant) => variant.text || variant.mediaName);
  }

  return [];
}

async function previewMessages(contacts, messages, mediaAsset) {
  const cycleState = await getMessageCycleState(messages);
  const previewContacts = contacts.slice(0, 5);
  const previewVariants = peekNextMessageVariants(cycleState, previewContacts.length);
  const mediaCache = new Map();

  for (const [index, contact] of previewContacts.entries()) {
    const variant = previewVariants[index] || { id: 1, text: "", mediaName: "" };
    const selectedMediaAsset = await resolveVariantMediaAsset(variant, mediaAsset, mediaCache);
    console.log("-----");
    console.log(`${contact.name || "Sem nome"} <${normalizePhone(contact.phone)}>:`);
    if (selectedMediaAsset) {
      console.log(`Midia: ${selectedMediaAsset.name} (${selectedMediaAsset.type})`);
    }
    console.log(`Variacao ${variant.id}:`);
    if (variant.text) {
      console.log(formatMessage(variant.text, contact));
    } else {
      console.log("[sem legenda]");
    }
  }

  if (contacts.length > 5) {
    console.log(`... e mais ${contacts.length - 5} contatos.`);
  }
}

function toJid(phone) {
  return `${normalizePhone(phone)}@s.whatsapp.net`;
}

function normalizeMessage(value) {
  return String(value || "").trim();
}

function normalizeVariantConfig(value, fallbackId) {
  if (typeof value === "string") {
    return {
      id: fallbackId,
      text: normalizeMessage(value),
      mediaName: ""
    };
  }

  if (value && typeof value === "object") {
    return {
      id: Number.isInteger(value.id) ? value.id : fallbackId,
      text: normalizeMessage(value.text ?? value.message ?? ""),
      mediaName: getOptionalString(value.mediaName ?? value.media ?? value.media_name)
    };
  }

  return {
    id: fallbackId,
    text: "",
    mediaName: ""
  };
}

function getNextVariant(cycleState) {
  if (cycleState.queue.length === 0) {
    cycleState.queue = shuffleMessages([...cycleState.baseMessages]);
  }

  return cycleState.queue.shift();
}

async function resolveVariantMediaAsset(variant, fallbackMediaAsset, mediaCache) {
  const mediaName = getOptionalString(variant?.mediaName);
  if (!mediaName) {
    return fallbackMediaAsset;
  }

  if (!mediaCache.has(mediaName)) {
    mediaCache.set(mediaName, await getMediaAssetByName(mediaName));
  }

  return mediaCache.get(mediaName);
}

async function sendInteractiveButtonsMessage(
  socket,
  jid,
  { text, buttons, footerText = CONFIG.stage2ButtonFooterText, quoted } = {}
) {
  const messageContent = {
    viewOnceMessage: {
      message: {
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({
            text: text || ""
          }),
          footer: proto.Message.InteractiveMessage.Footer.create({
            text: footerText || "",
            hasMediaAttachment: false
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: buttons || [],
            messageParamsJson: "{}",
            messageVersion: 1
          })
        })
      }
    }
  };

  const waMessage = generateWAMessageFromContent(jid, messageContent, {
    userJid: socket.user?.id,
    quoted
  });

  await socket.relayMessage(jid, waMessage.message, {
    messageId: waMessage.key.id
  });

  return waMessage;
}

async function sendPreparedMessage(
  socket,
  jid,
  { mediaAsset, text, quoted, interactiveButtons, footerText } = {}
) {
  if (interactiveButtons?.length && !mediaAsset) {
    return sendInteractiveButtonsMessage(socket, jid, {
      text,
      buttons: interactiveButtons,
      footerText,
      quoted
    });
  }

  const payload = buildPayload(mediaAsset, text);
  if (quoted) {
    return socket.sendMessage(jid, payload, { quoted });
  }

  return socket.sendMessage(jid, payload);
}

function buildPayload(mediaAsset, text) {
  if (!mediaAsset) {
    return text ? { text } : { text: "" };
  }

  if (mediaAsset.type === "image") {
    return {
      image: { url: mediaAsset.path },
      caption: text || undefined
    };
  }

  return {
    video: { url: mediaAsset.path },
    caption: text || undefined
  };
}

async function saveReport(sent, stats) {
  const report = {
    generatedAt: new Date().toISOString(),
    stats,
    sent
  };

  await mkdirSafe("logs");
  const fileName = `logs/report-${Date.now()}.json`;
  await fs.writeFile(fileName, JSON.stringify(report, null, 2));

  console.log(`Relatorio salvo em ${fileName}.`);
  console.log(`Mensagens enviadas: ${sent.length}.`);
}

async function startListener() {
  await createSocket();
  console.log("Listener ativo. Respostas com STOP serao registradas para descadastro.");
}

main().catch((error) => {
  console.error("Erro fatal:", error);
  process.exitCode = 1;
});
