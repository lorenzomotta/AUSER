const { ipcRenderer } = require('electron');
const { getSharePointData, addItemToSharePoint, getSharePointFieldsMap } = require('./sharepoint');
const fs = require('fs');
const path = require('path');

// Flag debug: mostra la tabella completa in alto (ul#list)
const SHOW_DEBUG_TABLE = false;

let accessToken = null;

// Ricevi il token di accesso
ipcRenderer.on('auth-success', (event, token) => {
  accessToken = token;
  document.getElementById('status').textContent = 'Autenticato!';
  console.log('Token ricevuto');
  
  // Aggiorna lo stato della connessione SharePoint
  const statusElement = document.querySelector('.connection-status span');
  if (statusElement) {
    statusElement.className = 'status-connected';
    statusElement.textContent = '🟢 Connesso a SharePoint';
  }
});

// Gestione errori autenticazione
ipcRenderer.on('auth-error', (event, message) => {
  console.error('Errore autenticazione:', message);
  document.getElementById('status').textContent = 'Errore autenticazione';
  const statusElement = document.querySelector('.connection-status span');
  if (statusElement) {
    statusElement.className = 'status-disconnected';
    statusElement.textContent = `🔴 Errore autenticazione: ${message}`;
  }
  alert(`Errore autenticazione: ${message}`);
});

// Gestione del login - invia messaggio al main process
document.getElementById('loginBtn').addEventListener('click', () => {
  ipcRenderer.send('start-auth');
});

document.getElementById('loadBtn').addEventListener('click', async () => {
  if (!accessToken) {
    alert('Effettua prima il login!');
    return;
  }
  
  try {
    const [data, fieldsMap] = await Promise.all([
      getSharePointData(accessToken, { orderby: 'ID desc' }),
      getSharePointFieldsMap(accessToken)
    ]);
    const loadCardTemplate = () => {
      try {
        const p = path.join(__dirname, 'components', 'servizio_card.html');
        return fs.readFileSync(p, 'utf-8');
      } catch (e) {
        console.error('Impossibile leggere template card:', e);
        return '<div>Template non disponibile</div>';
      }
    };
    const cardTpl = loadCardTemplate();
    const list = document.getElementById('list');
    list.innerHTML = '';

    if (!data || data.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nessun elemento trovato';
      list.appendChild(li);
      return;
    }

    if (SHOW_DEBUG_TABLE) {
      // Render tabella generale (solo per debug)
      const table = document.createElement('table');
      table.border = '1';
      table.cellPadding = '4';
      const thead = document.createElement('thead');
      const tbody = document.createElement('tbody');

      const allKeys = Array.from(new Set(data.flatMap(r => Object.keys(r.text || {})))).sort();

      const trHead = document.createElement('tr');
      allKeys.forEach(k => {
        const th = document.createElement('th');
        th.textContent = fieldsMap[k] || k;
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);

      data.forEach(row => {
        const tr = document.createElement('tr');
        allKeys.forEach(k => {
          const td = document.createElement('td');
          td.textContent = (row.text && row.text[k]) ? String(row.text[k]) : '';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      list.appendChild(table);
    }

    // Render "SERVIZI DEL GIORNO" come card nella prima colonna dell'home
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const getDateString = (row) => {
      const t = row.text || {};
      if (t['DATA_PRELIEVO']) return t['DATA_PRELIEVO'];
      if (t['DATA_x005f_PRELIEVO']) return t['DATA_x005f_PRELIEVO'];
      const k = Object.keys(t).find(x => x.toUpperCase().includes('PRELIEVO'));
      return k ? t[k] : '';
    };
    const parseDDMMYYYY = (s) => {
      const first = String(s).split(' ')[0]; // rimuove eventuale orario
      const parts = first.split('/');
      if (parts.length !== 3) return null;
      const d = Number(parts[0]);
      const m = Number(parts[1]) - 1;
      const y = Number(parts[2]);
      const dt = new Date(y, m, d);
      dt.setHours(0, 0, 0, 0);
      return isNaN(dt.getTime()) ? null : dt;
    };

    console.log('[UI] Tot elementi ricevuti:', Array.isArray(data) ? data.length : 'n/d');
    if (Array.isArray(data) && data.length) {
      const sample = data[0].text || {};
      console.log('[UI] Esempio chiavi FieldValuesAsText:', Object.keys(sample));
      const candidateKeys = Object.keys(sample).filter(k => k.toUpperCase().includes('PRELIEVO'));
      console.log('[UI] Chiavi candidate per data prelievo:', candidateKeys);
      console.log('[UI] Esempio valore prima chiave candidata:', candidateKeys[0] ? sample[candidateKeys[0]] : 'n/d');
    }

    const serviziDelGiorno = data.filter(r => {
      const dt = parseDDMMYYYY(getDateString(r));
      return dt && dt >= startToday && dt <= endToday;
    });
    console.log('[UI] Servizi del giorno:', serviziDelGiorno.length);

    const containers = document.querySelectorAll('.services-container');
    const leftColumn = containers[0];
    const centerColumn = containers[1];

    if (leftColumn) {
      leftColumn.innerHTML = '';
      for (const svc of serviziDelGiorno) {
        const wrapper = document.createElement('div');
        wrapper.className = 'svc-wrapper';
        wrapper.innerHTML = cardTpl;
        const text = svc.text || {};
        wrapper.querySelector('.svc-id').value = text['ID'] || '';
        wrapper.querySelector('.svc-operatore').value = text['OPER'] || text['OPERATORE'] || '';
        wrapper.querySelector('.svc-data').value = getDateString(svc) || '';
        wrapper.querySelector('.svc-nominativo').value = text['NOMINATIVO'] || text['Title'] || '';
        wrapper.querySelector('.svc-ora-sotto-casa').value = text['ORA_SOTTO_CASA'] || '';
        wrapper.querySelector('.svc-ora-destinazione').value = text['ORA_DESTINAZIONE'] || '';
        wrapper.querySelector('.svc-tipo').value = text['TIPO_DI_SERVIZIO'] || text['TIPO_SERVIZIO'] || '';
        leftColumn.appendChild(wrapper);
      }
    }

    // PROSSIMI SERVIZI: tutti i servizi dal giorno dopo in poi (colonna centrale)
    if (centerColumn) {
      const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      const prossimiServizi = data
        .filter(r => {
          const dt = parseDDMMYYYY(getDateString(r));
          return dt && dt >= tomorrowStart;
        })
        .sort((a, b) => {
          const da = parseDDMMYYYY(getDateString(a)) || new Date(8640000000000000);
          const db = parseDDMMYYYY(getDateString(b)) || new Date(8640000000000000);
          return da - db;
        });
      console.log('[UI] Prossimi servizi (>= domani):', prossimiServizi.length);
      centerColumn.innerHTML = '';
      for (const svc of prossimiServizi) {
        const wrapper = document.createElement('div');
        wrapper.className = 'svc-wrapper';
        wrapper.innerHTML = cardTpl;
        const text = svc.text || {};
        wrapper.querySelector('.svc-id').value = text['ID'] || '';
        wrapper.querySelector('.svc-operatore').value = text['OPER'] || text['OPER'] || '';
        wrapper.querySelector('.svc-data').value = getDateString(svc) || '';
        wrapper.querySelector('.svc-nominativo').value = text['NOMINATIVO'] || text['Title'] || '';
        wrapper.querySelector('.svc-ora-sotto-casa').value = text['ORA_SOTTO_CASA'] || '';
        wrapper.querySelector('.svc-ora-destinazione').value = text['ORA_DESTINAZIONE'] || '';
        wrapper.querySelector('.svc-tipo').value = text['TIPO_DI_SERVIZIO'] || text['TIPO_SERVIZIO'] || '';
        centerColumn.appendChild(wrapper);
      }
    }
  } catch (error) {
    console.error('Errore nel caricamento:', error);
    alert('Errore nel caricamento dei dati');
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  if (!accessToken) {
    alert('Effettua prima il login!');
    return;
  }
  
  const newItem = { Title: 'Nuovo Elemento' };
  try {
    await addItemToSharePoint(newItem, accessToken);
    alert('Elemento aggiunto!');
  } catch (error) {
    console.error('Errore nell\'aggiunta:', error);
    alert('Errore nell\'aggiunta dell\'elemento');
  }
});