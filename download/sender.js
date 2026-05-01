require('dotenv').config();
const fs = require('fs');
const { getRandomMessage } = require('./messages');
const { markAsSent } = require('./sheets');
const {
  wait, randomBetween, formatNumber,
  calculateTypingTime, getMediaFiles, getMediaType,
  isWithinAllowedHours, log
} = require('./utils');

const MIN_DELAY = parseInt(process.env.MIN_DELAY || '35000');
const MAX_DELAY = parseInt(process.env.MAX_DELAY || '250000');
const MAX_RETRIES = 2;

let dailySentCount = 0;
let lastResetDate = new Date().toDateString();

function checkDailyReset() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailySentCount = 0;
    lastResetDate = today;
    log('Contador diario resetado');
  }
}

function getDailyCount() {
  return dailySentCount;
}

async function sendMedia(sock, jid, filePath) {
  const type = getMediaType(filePath);
  if (!type) {
    log(`Tipo de midia nao reconhecido: ${filePath}`, 'WARN');
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const fileName = filePath.split('/').pop();

  try {
    if (type === 'image') {
      await sock.sendMessage(jid, { image: buffer, caption: '' });
    } else if (type === 'video') {
      await sock.sendMessage(jid, { video: buffer, caption: '' });
    } else if (type === 'audio') {
      await sock.sendMessage(jid, {
        audio: buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      });
    }

    log(`Midia enviada: ${fileName} -> ${jid}`);
  } catch (err) {
    log(`Erro ao enviar midia ${fileName}: ${err.message}`, 'ERROR');
  }
}

async function sendText(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
    log(`Mensagem enviada -> ${jid}`);
  } catch (err) {
    log(`Erro ao enviar mensagem: ${err.message}`, 'ERROR');
  }
}

async function sendToContact(contact, sock, attempt = 1, options = {}) {
  checkDailyReset();

  const dailyLimit = parseInt(process.env.DAILY_LIMIT || '150');
  if (dailySentCount >= dailyLimit) {
    log(`Limite diario de ${dailyLimit} envios atingido. Aguardando proximo dia.`, 'WARN');
    return false;
  }

  const { nome, numero, row } = contact;
  const jid = formatNumber(numero);
  const name = nome || 'amigo(a)';

  if (!isWithinAllowedHours()) {
    log(`Fora do horario permitido (08h-20h). Pulando ${name}.`, 'WARN');
    return false;
  }

  if (attempt === 1) {
    const delay = options.initialDelay ?? randomBetween(MIN_DELAY, MAX_DELAY);
    log(`Aguardando ${Math.round(delay / 1000)}s antes de enviar para ${name} (${numero})`);
    await wait(delay);
  }

  if (typeof options.beforeSend === 'function') {
    let canSend = false;
    try {
      canSend = await options.beforeSend(contact);
    } catch (err) {
      log(`Erro ao confirmar planilha atual antes do envio: ${err.message}`, 'WARN');
    }

    if (!canSend) {
      log(`Contato ${name} (${numero}) nao esta mais na planilha atual. Envio cancelado.`, 'WARN');
      return false;
    }
  }

  if (attempt > 1) {
    log(`Retentativa ${attempt}/${MAX_RETRIES + 1} para ${name}...`, 'WARN');
  } else {
    log(`Iniciando envio para: ${name} (${numero})`);
  }

  try {
    await sock.sendPresenceUpdate('available', jid);
    await wait(randomBetween(800, 1800));

    // Removido o comando disappearingMessagesInChat: 0 porque ele pode gerar
    // o placeholder "Aguardando mensagem..." em alguns clientes do WhatsApp.

    const mediaFiles = getMediaFiles();
    if (mediaFiles.length > 0) {
      log(`Enviando ${mediaFiles.length} midia(s) para ${name}`);
      for (const file of mediaFiles) {
        await sendMedia(sock, jid, file);
        await wait(randomBetween(2000, 5000));
      }
    }

    const messageText = getRandomMessage(name);
    const typingTime = calculateTypingTime(messageText.length);

    await sock.sendPresenceUpdate('composing', jid);
    await wait(Math.round(typingTime * 0.55));
    await sock.sendPresenceUpdate('paused', jid);
    await wait(randomBetween(700, 1400));
    await sock.sendPresenceUpdate('composing', jid);
    await wait(Math.round(typingTime * 0.45));

    await wait(7000);
    await sendText(sock, jid, messageText);
    await markAsSent(row, numero);

    dailySentCount++;
    log(`Envio concluido para ${name} | Total hoje: ${dailySentCount}/${dailyLimit}`);
    return true;
  } catch (err) {
    log(`Erro no envio para ${name} (tentativa ${attempt}): ${err.message}`, 'ERROR');

    if (attempt <= MAX_RETRIES) {
      const retryDelay = attempt * 15000;
      log(`Aguardando ${retryDelay / 1000}s antes de retentar...`, 'WARN');
      await wait(retryDelay);
      return sendToContact(contact, sock, attempt + 1, options);
    }

    log(`Desistindo apos ${attempt} tentativas para ${name}.`, 'ERROR');
    return false;
  }
}

module.exports = { sendToContact, getDailyCount };
