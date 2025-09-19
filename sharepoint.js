const axios = require('axios');
const path = require('path');

// Carica .env da un percorso esplicito (root del progetto per default)
const dotenvPath = process.env.ENV_PATH || path.join(__dirname, '.env');
require('dotenv').config({ path: dotenvPath });

// Verifica e segnala variabili mancanti
function ensureEnv(keys) {
  const missing = keys.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error('Variabili .env mancanti:', missing.join(', '), ' (file:', dotenvPath, ')');
  } else {
    console.log('Variabili .env caricate da', dotenvPath);
  }
}
ensureEnv(['TENANT_ID', 'CLIENT_ID', 'SP_TENANT', 'SITE_URL', 'LIST_NAME']);

// Usa le variabili d'ambiente invece di valori hardcoded
let siteUrl = process.env.SITE_URL || '';
const listName = process.env.LIST_NAME;

// Normalizza siteUrl (aggiunge https:// se manca)
if (siteUrl && !/^https?:\/\//i.test(siteUrl)) {
  siteUrl = `https://${siteUrl.replace(/^\/+/, '')}`;
}

async function getSharePointData(accessToken, options = {}) {
  try {
    // Costruisci URL con opzioni: $filter, $orderby, $top
    const top = options.top || 200;
    const filter = options.filter ? `&$filter=${options.filter}` : '';
    const orderby = options.orderby ? `&$orderby=${options.orderby}` : '';
    const url = `${siteUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')/items?$select=*,FieldValuesAsText&$expand=FieldValuesAsText&$top=${top}${filter}${orderby}`;
    console.log('[SP] GET', url);
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json;odata=verbose'
      }
    });
    return response.data.d.results.map(item => ({
      raw: item,
      text: item.FieldValuesAsText || {}
    }));
  } catch (error) {
    const status = error && error.response && error.response.status;
    const data = error && error.response && error.response.data;
    console.error('[SP] Errore nel caricare dati:', status, data && (data.error && (data.error.message && data.error.message.value)) || error.message);
    return [];
  }
}

async function addItemToSharePoint(item, accessToken) {
  try {
    const url = `${siteUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')/items`;
    console.log('[SP] POST', url);
    await axios.post(url, item, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json;odata=verbose',
        'Accept': 'application/json;odata=verbose'
      }
    });
  } catch (error) {
    const status = error && error.response && error.response.status;
    const data = error && error.response && error.response.data;
    console.error('[SP] Errore nell\'aggiungere elemento:', status, data && (data.error && (data.error.message && data.error.message.value)) || error.message);
  }
}

module.exports = { getSharePointData, addItemToSharePoint };
// Recupera la mappa dei campi: InternalName -> Title (intestazione umana)
async function getSharePointFieldsMap(accessToken) {
  try {
    const url = `${siteUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')/fields?$select=InternalName,Title`; 
    console.log('[SP] GET fields', url);
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json;odata=verbose'
      }
    });
    const map = {};
    (response.data.d.results || []).forEach(f => { map[f.InternalName] = f.Title || f.InternalName; });
    return map;
  } catch (error) {
    console.error('[SP] Errore lettura campi:', error && error.response && error.response.status, error.message);
    return {};
  }
}

module.exports.getSharePointFieldsMap = getSharePointFieldsMap;