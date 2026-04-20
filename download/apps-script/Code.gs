const SPREADSHEET_ID = '1mR8VUiUVGY59RWNd8aLG30TWPFSd8846vRCFfRrigw8';
const SHEET_GID = 859951361;
const SHEET_NAME = 'DISPARO';
const TOKEN = 'bot-vortexusa-2026';

const OUTPUT_HEADERS = {
  name: 'NOME',
  phone: 'NUMERO',
  label: 'ETIQUETA',
  status: 'STATUS',
  note: 'OBS',
  sentAt: 'ENVIADO_EM'
};

const HEADER_ALIASES = {
  name: ['NOME', 'NAME'],
  phone: ['NUMERO', 'PHONE', 'TELEFONE', 'WHATSAPP'],
  label: ['ETIQUETA', 'LABEL'],
  status: ['STATUS'],
  note: ['OBS', 'OBSERVACAO', 'NOTA'],
  sentAt: ['ENVIADO_EM', 'ENVIADO EM', 'SENT_AT']
};

function doGet(e) {
  try {
    if (!isAuthorized(e.parameter.token)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    const action = e.parameter.action || 'queue';
    if (action === 'debug') {
      return jsonResponse({
        ok: true,
        debug: getDebugInfo()
      });
    }

    if (action !== 'queue') {
      return jsonResponse({ ok: false, error: 'unknown action' });
    }

    const limit = Number(e.parameter.limit || 30);
    return jsonResponse({
      ok: true,
      rows: getPendingRows(limit)
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');

    if (!isAuthorized(payload.token)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    if (payload.action !== 'update') {
      return jsonResponse({ ok: false, error: 'unknown action' });
    }

    updateRowStatus(payload.rowId, payload.status, payload.note, payload.sentAt);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function getPendingRows(limit) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  ensureColumn(sheet, values[0], OUTPUT_HEADERS.status);
  ensureColumn(sheet, values[0], OUTPUT_HEADERS.note);
  ensureColumn(sheet, values[0], OUTPUT_HEADERS.sentAt);

  const refreshedValues = sheet.getDataRange().getValues();
  const headerMap = getHeaderMap(refreshedValues[0]);
  const nameIndex = getHeaderIndex(headerMap, HEADER_ALIASES.name, false);
  const phoneIndex = getHeaderIndex(headerMap, HEADER_ALIASES.phone, true);
  const labelIndex = getHeaderIndex(headerMap, HEADER_ALIASES.label, false);
  const statusIndex = getHeaderIndex(headerMap, HEADER_ALIASES.status, true);
  const rows = [];

  for (let index = 1; index < refreshedValues.length; index += 1) {
    const row = refreshedValues[index];
    const status = String(row[statusIndex] || '').trim().toUpperCase();

    if (status && status !== 'PENDENTE') {
      continue;
    }

    const name = nameIndex >= 0 ? row[nameIndex] : '';
    const phone = row[phoneIndex];
    const labelName = labelIndex >= 0 ? row[labelIndex] : '';

    if (!phone) {
      continue;
    }

    rows.push({
      rowId: index + 1,
      NOME: name,
      NUMERO: phone,
      ETIQUETA: labelName
    });

    if (rows.length >= limit) {
      break;
    }
  }

  return rows;
}

function updateRowStatus(rowId, status, note, sentAt) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) {
    return;
  }

  ensureColumn(sheet, values[0], OUTPUT_HEADERS.status);
  ensureColumn(sheet, values[0], OUTPUT_HEADERS.note);
  ensureColumn(sheet, values[0], OUTPUT_HEADERS.sentAt);

  const headerMap = getHeaderMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  const statusIndex = getHeaderIndex(headerMap, HEADER_ALIASES.status, true);
  const noteIndex = getHeaderIndex(headerMap, HEADER_ALIASES.note, true);
  const sentAtIndex = getHeaderIndex(headerMap, HEADER_ALIASES.sentAt, true);
  const line = Number(rowId);

  if (!line || line < 2) {
    return;
  }

  sheet.getRange(line, statusIndex + 1).setValue(status || '');
  sheet.getRange(line, noteIndex + 1).setValue(note || '');
  sheet.getRange(line, sentAtIndex + 1).setValue(sentAt || new Date().toISOString());
}

function getSheet() {
  const spreadsheet = getSpreadsheet();
  const sheetById = SHEET_GID
    ? spreadsheet.getSheets().find((sheet) => sheet.getSheetId() === SHEET_GID)
    : null;

  if (sheetById) {
    return sheetById;
  }

  const sheetByName = spreadsheet.getSheetByName(SHEET_NAME);
  if (sheetByName) {
    return sheetByName;
  }

  throw new Error(
    'A aba configurada nao foi encontrada. Verifique SHEET_GID=' +
      SHEET_GID +
      ' e SHEET_NAME=' +
      SHEET_NAME
  );
}

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function getHeaderMap(headers) {
  const map = {};
  headers.forEach((header, index) => {
    map[normalizeHeaderName(header)] = index;
  });
  return map;
}

function getHeaderIndex(headerMap, aliases, required) {
  for (let index = 0; index < aliases.length; index += 1) {
    const alias = aliases[index];
    const key = normalizeHeaderName(alias);
    if (Object.prototype.hasOwnProperty.call(headerMap, key)) {
      return headerMap[key];
    }
  }

  if (required) {
    throw new Error('Coluna obrigatoria nao encontrada: ' + aliases.join(', '));
  }

  return -1;
}

function normalizeHeaderName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
}

function ensureColumn(sheet, headers, columnName) {
  const normalizedHeaders = headers.map((header) => normalizeHeaderName(header));
  if (normalizedHeaders.indexOf(normalizeHeaderName(columnName)) !== -1) {
    return;
  }

  sheet.getRange(1, headers.length + 1).setValue(columnName);
  headers.push(columnName);
}

function getDebugInfo() {
  const spreadsheet = getSpreadsheet();
  const availableSheets = spreadsheet.getSheets().map((sheet) => ({
    name: sheet.getName(),
    sheetId: sheet.getSheetId(),
    lastRow: sheet.getLastRow(),
    lastColumn: sheet.getLastColumn()
  }));
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values.length > 0 ? values[0] : [];

  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    configuredSheetGid: SHEET_GID,
    configuredSheetName: SHEET_NAME,
    resolvedSheetName: sheet.getName(),
    resolvedSheetId: sheet.getSheetId(),
    lastRow: sheet.getLastRow(),
    lastColumn: sheet.getLastColumn(),
    headers: headers,
    normalizedHeaders: headers.map((header) => normalizeHeaderName(header)),
    availableSheets: availableSheets
  };
}

function isAuthorized(token) {
  return String(token || '') === TOKEN;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
