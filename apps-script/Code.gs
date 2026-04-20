const SPREADSHEET_ID = '1mR8VUiUVGY59RWNd8aLG30TWPFSd8846vRCFfRrigw8';
const SHEET_GID = 859951361;
const SHEET_NAME = 'DISPARO';
const TOKEN = 'bot-vortexusa-2026';
const HEADERS = {
  name: 'NOME',
  phone: 'NÚMERO',
  label: 'ETIQUETA',
  status: 'STATUS',
  note: 'OBS',
  sentAt: 'ENVIADO_EM'
};

function doGet(e) {
  if (!isAuthorized(e.parameter.token)) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  const action = e.parameter.action || 'queue';
  if (action !== 'queue') {
    return jsonResponse({ ok: false, error: 'unknown action' });
  }

  const limit = Number(e.parameter.limit || 30);
  return jsonResponse({
    ok: true,
    rows: getPendingRows(limit)
  });
}

function doPost(e) {
  const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');

  if (!isAuthorized(payload.token)) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  if (payload.action !== 'update') {
    return jsonResponse({ ok: false, error: 'unknown action' });
  }

  updateRowStatus(payload.rowId, payload.status, payload.note, payload.sentAt);
  return jsonResponse({ ok: true });
}

function getPendingRows(limit) {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  ensureColumn(sheet, values[0], HEADERS.status);
  ensureColumn(sheet, values[0], HEADERS.note);
  ensureColumn(sheet, values[0], HEADERS.sentAt);

  const refreshedValues = sheet.getDataRange().getValues();
  const headerMap = getHeaderMap(refreshedValues[0]);
  const rows = [];

  for (let index = 1; index < refreshedValues.length; index += 1) {
    const row = refreshedValues[index];
    const status = String(row[headerMap[HEADERS.status]] || '').trim().toUpperCase();

    if (status && status !== 'PENDENTE') {
      continue;
    }

    const name = row[headerMap[HEADERS.name]];
    const phone = row[headerMap[HEADERS.phone]];
    const labelName = row[headerMap[HEADERS.label]];

    if (!phone) {
      continue;
    }

    rows.push({
      rowId: index + 1,
      NOME: name,
      'NÚMERO': phone,
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

  ensureColumn(sheet, values[0], HEADERS.status);
  ensureColumn(sheet, values[0], HEADERS.note);
  ensureColumn(sheet, values[0], HEADERS.sentAt);

  const headerMap = getHeaderMap(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  const line = Number(rowId);
  if (!line || line < 2) {
    return;
  }

  sheet.getRange(line, headerMap[HEADERS.status] + 1).setValue(status || '');
  sheet.getRange(line, headerMap[HEADERS.note] + 1).setValue(note || '');
  sheet.getRange(line, headerMap[HEADERS.sentAt] + 1).setValue(sentAt || new Date().toISOString());
}

function getSheet() {
  const spreadsheet = getSpreadsheet();
  const sheetById = SHEET_GID
    ? spreadsheet.getSheets().find((sheet) => sheet.getSheetId() === SHEET_GID)
    : null;

  if (sheetById) {
    return sheetById;
  }

  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
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
    map[String(header).trim()] = index;
  });
  return map;
}

function ensureColumn(sheet, headers, columnName) {
  if (headers.indexOf(columnName) !== -1) {
    return;
  }

  sheet.getRange(1, headers.length + 1).setValue(columnName);
  headers.push(columnName);
}

function isAuthorized(token) {
  return String(token || '') === TOKEN;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
