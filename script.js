// ========================================
// GESTIONE OPERATIVA auser Asti - SharePoint Integration + Modalità Sviluppo
// ========================================

// Stato dell'applicazione
let appState = {
    isConnected: false,
    lastSync: null,
    data: {
        servizi: [],
        operatori: [],
        tesserati: [],
        rinnovoTesseramenti: [],
        automezzi: []
    },
    error: null,
    mode: 'development' // 'development' o 'production'
};

// ========================================
// UTILITY FUNZIONI
// ========================================

// Funzione per ottenere la data corrente nel formato dd/mm/yyyy
function getCurrentDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
}

// Fallback per la funzione log se config.js non è ancora caricato
function safeLog(message, level = 'info') {
    if (typeof log === 'function') {
        log(message, level);
    } else {
        // Fallback se log non è disponibile
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        console.log(`${prefix} ${message}`);
    }
}

// ========================================
// INIZIALIZZAZIONE E CONFIGURAZIONE
// ========================================

// Inizializza la modalità dell'applicazione
function initializeAppMode() {
    if (typeof isDevelopmentMode === 'function') {
        appState.mode = isDevelopmentMode() ? 'development' : 'production';
    } else {
        // Fallback se config.js non è caricato
        appState.mode = 'development';
    }
    
    safeLog(`🚀 Modalità applicazione: ${appState.mode.toUpperCase()}`, 'info');
    
    // Aggiorna l'interfaccia per la modalità
    updateInterfaceForMode();
}

// Aggiorna l'interfaccia per la modalità corrente
function updateInterfaceForMode() {
    const connectionStatus = document.querySelector('.connection-status');
    if (connectionStatus) {
        if (appState.mode === 'development') {
            connectionStatus.innerHTML = `
                <span class="last-sync">Database locale caricato</span>
            `;
        } else {
            connectionStatus.innerHTML = `
                <span class="status-disconnected">🔴 Connessione SharePoint in corso...</span>
            `;
        }
    }
}

// ========================================
// FUNZIONI PRINCIPALI - MODALITÀ SVILUPPO
// ========================================

// Carica dati locali per sviluppo
async function loadLocalData() {
    try {
        safeLog('📊 Caricamento dati locali per sviluppo...', 'info');
        showStatusMessage('📊 Caricamento dati locali...', 'info');
        
        // Verifica che localData.js sia caricato
        if (typeof getLocalData !== 'function') {
            throw new Error('Database locale non disponibile');
        }
        
        // Inizializza appState.data se non esiste
        if (!appState.data) {
            appState.data = {};
        }
        
        // Carica dati da tutte le liste locali
        appState.data.servizi = getLocalData('servizi') || [];
        appState.data.operatori = getLocalData('operatori') || [];
        appState.data.tesserati = getLocalData('tesserati') || [];
        appState.data.rinnovoTesseramenti = getLocalData('rinnovoTesseramenti') || [];
        appState.data.automezzi = getLocalData('automezzi') || [];
        
        // Verifica che i dati siano stati caricati correttamente
        if (!appState.data.servizi || appState.data.servizi.length === 0) {
            throw new Error('Nessun servizio trovato nel database locale');
        }
        
        // Simula ritardo di rete se configurato
        if (typeof simulateNetworkDelay === 'function') {
            await simulateNetworkDelay();
        }
        
        safeLog('✅ Dati locali caricati con successo', 'info');
        showStatusMessage('✅ Dati locali caricati - Modalità sviluppo', 'success');
        
        // Aggiorna l'interfaccia
        updateInterfaceWithLocalData(appState.data);
        
        return true;
        
    } catch (error) {
        safeLog(`❌ Errore caricamento dati locali: ${error.message}`, 'error');
        showStatusMessage('❌ Errore caricamento dati locali', 'error');
        return false;
    }
}

// Aggiorna l'interfaccia con dati locali
function updateInterfaceWithLocalData(data) {
    try {
        safeLog('🎨 Aggiornamento interfaccia con dati locali...', 'info');
        
        // Verifica che i dati siano validi
        if (!data || !data.servizi || !Array.isArray(data.servizi)) {
            throw new Error('Dati non validi per l\'aggiornamento interfaccia');
        }
        
        // Aggiorna lo stato dell'app
        appState.data = data;
        
        // Ottieni la data corrente
        const currentDate = getCurrentDate();
        safeLog(`📅 Data corrente: ${currentDate}`, 'info');
        
        // Filtra i servizi del giorno (DATA_PRELIEVO = data corrente)
        const serviziDelGiorno = data.servizi.filter(s => s && s.dataPrelievo === currentDate);
        safeLog(`🚗 Servizi del giorno (DATA_PRELIEVO = ${currentDate}): ${serviziDelGiorno.length}`, 'info');
        
        // Filtra i servizi futuri (DATA_PRELIEVO > data corrente)
        const serviziFuturi = data.servizi.filter(s => {
            if (!s || !s.dataPrelievo) return false;
            
            const prelievoDate = s.dataPrelievo;
            const todayDate = currentDate;
            
            // Converti le date in formato dd/mm/yyyy per il confronto
            const [prelievoDay, prelievoMonth, prelievoYear] = prelievoDate.split('/');
            const [todayDay, todayMonth, todayYear] = todayDate.split('/');
            
            const prelievoDateObj = new Date(prelievoYear, prelievoMonth - 1, prelievoDay);
            const todayDateObj = new Date(todayYear, todayMonth - 1, todayDay);
            
            return prelievoDateObj > todayDateObj;
        });
        safeLog(`🔮 Servizi futuri (DATA_PRELIEVO > ${currentDate}): ${serviziFuturi.length}`, 'info');
        
        // Aggiorna le colonne dei servizi
        updateServicesColumn('SERVIZI DEL GIORNO', serviziDelGiorno);
        updateServicesColumn('PROSSIMI SERVIZI', serviziFuturi);
        
        // Aggiorna la colonna tessere
        if (data.tesserati && Array.isArray(data.tesserati)) {
            const tesseratiInScadenza = data.tesserati.filter(t => t && t.stato === 'in scadenza');
            updateTessereColumn(tesseratiInScadenza);
        }
        
        safeLog('✅ Interfaccia aggiornata con dati locali', 'info');
        
    } catch (error) {
        safeLog(`❌ Errore aggiornamento interfaccia: ${error.message}`, 'error');
        showStatusMessage('❌ Errore aggiornamento interfaccia', 'error');
    }
}

// ========================================
// FUNZIONI PRINCIPALI - MODALITÀ PRODUZIONE (SHAREPOINT)
// ========================================

// Funzione per connettersi a SharePoint
async function connectToSharePoint() {
    try {
        safeLog('🔄 Tentativo di connessione a SharePoint...', 'info');
        showStatusMessage('🔄 Connessione a SharePoint in corso...', 'info');
        
        // Simula connessione SharePoint (qui andrà la vera implementazione)
        await simulateSharePointConnection();
        
        appState.isConnected = true;
        appState.lastSync = new Date();
        appState.error = null;
        
        safeLog('✅ Connesso a SharePoint con successo', 'info');
        showStatusMessage('✅ Connesso a SharePoint - Dati sincronizzati', 'success');
        
        // Carica i dati dalle liste
        await loadAllSharePointData();
        
        return true;
        
    } catch (error) {
        safeLog(`❌ Errore connessione SharePoint: ${error.message}`, 'error');
        appState.isConnected = false;
        appState.error = error.message;
        
        showStatusMessage('❌ Errore connessione SharePoint - Verifica la connessione', 'error');
        
        // Mostra pulsante per riprovare
        showRetryButton();
        
        return false;
    }
}

// Simula connessione SharePoint (da sostituire con vera implementazione)
async function simulateSharePointConnection() {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            // Simula 80% di successo nella connessione
            if (Math.random() > 0.2) {
                resolve();
            } else {
                reject(new Error('Timeout connessione - Verifica la connessione di rete'));
            }
        }, 2000);
    });
}

// Carica tutti i dati da SharePoint
async function loadAllSharePointData() {
    try {
        safeLog('📊 Caricamento dati da SharePoint...', 'info');
        showStatusMessage('📊 Caricamento dati in corso...', 'info');
        
        // Carica dati da tutte le liste
        const promises = [
            loadSharePointList('servizi'),
            loadSharePointList('operatori'),
            loadSharePointList('tesserati'),
            loadSharePointList('rinnovoTesseramenti'),
            loadSharePointList('automezzi')
        ];
        
        const results = await Promise.allSettled(promises);
        
        // Processa i risultati
        results.forEach((result, index) => {
            const listName = Object.keys(getSharePointConfig().lists)[index];
            if (result.status === 'fulfilled') {
                appState.data[listName] = result.value;
                safeLog(`✅ Lista ${listName} caricata: ${result.value.length} elementi`, 'info');
            } else {
                safeLog(`❌ Errore caricamento lista ${listName}: ${result.reason}`, 'error');
                appState.data[listName] = [];
            }
        });
        
        // Aggiorna l'interfaccia con i dati reali
        updateInterfaceWithSharePointData(appState.data);
        
        safeLog('✅ Tutti i dati caricati da SharePoint', 'info');
        showStatusMessage('✅ Dati sincronizzati con successo', 'success');
        
    } catch (error) {
        safeLog(`❌ Errore caricamento dati: ${error.message}`, 'error');
        showStatusMessage('❌ Errore caricamento dati SharePoint', 'error');
    }
}

// Carica una singola lista da SharePoint
async function loadSharePointList(listName) {
    try {
        safeLog(`📋 Caricamento lista: ${listName}`, 'info');
        
        // Simula caricamento dati (da sostituire con vera chiamata SharePoint)
        const mockData = generateMockData(listName);
        
        // Simula ritardo di rete
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
        
        return mockData;
        
    } catch (error) {
        safeLog(`❌ Errore caricamento lista ${listName}: ${error.message}`, 'error');
        throw error;
    }
}

// Genera dati di esempio per le liste (da sostituire con dati reali SharePoint)
function generateMockData(listName) {
    // Usa i dati locali come fallback se disponibili
    if (typeof getLocalData === 'function') {
        return getLocalData(listName);
    }
    
    // Fallback con dati hardcoded
    switch (listName) {
        case 'servizi':
            return [
                {
                    id: '384',
                    operatore: 'BONANNO GIUSEPPE',
                    data: '20/08/2025',
                    dataPrelievo: '20/08/2025',
                    nominativo: 'SQUILLACE ELISABETTA',
                    oraSottoCasa: '09:00',
                    oraDestinazione: '',
                    tipoServizio: 'TRASPORTO IN OSPEDALE CARD. MASSAIA AST',
                    stato: 'attivo'
                }
            ];
        default:
            return [];
    }
}

// ========================================
// FUNZIONI UNIFICATE PER ENTRAMBE LE MODALITÀ
// ========================================

// Funzione principale per caricare i dati
async function loadApplicationData() {
    if (appState.mode === 'development') {
        return await loadLocalData();
    } else {
        return await connectToSharePoint();
    }
}

// Aggiorna l'interfaccia con i dati correnti
function updateInterfaceWithData() {
    if (appState.mode === 'development') {
        updateInterfaceWithLocalData(appState.data);
    } else {
        updateInterfaceWithSharePointData(appState.data);
    }
}

// ========================================
// AGGIORNAMENTO INTERFACCIA
// ========================================

// Aggiorna l'interfaccia con i dati SharePoint
function updateInterfaceWithSharePointData(data) {
    try {
        safeLog('🎨 Aggiornamento interfaccia con dati SharePoint...', 'info');
        
        // Verifica che i dati siano validi
        if (!data || !data.servizi || !Array.isArray(data.servizi)) {
            throw new Error('Dati SharePoint non validi per l\'aggiornamento interfaccia');
        }
        
        // Aggiorna lo stato dell'app
        appState.data = data;
        
        // Ottieni la data corrente
        const currentDate = getCurrentDate();
        safeLog(`📅 Data corrente: ${currentDate}`, 'info');
        
        // Filtra i servizi del giorno (DATA_PRELIEVO = data corrente)
        const serviziDelGiorno = data.servizi.filter(s => s && s.dataPrelievo === currentDate);
        safeLog(`🚗 Servizi del giorno (DATA_PRELIEVO = ${currentDate}): ${serviziDelGiorno.length}`, 'info');
        
        // Filtra i servizi futuri (DATA_PRELIEVO > data corrente)
        const serviziFuturi = data.servizi.filter(s => {
            if (!s || !s.dataPrelievo) return false;
            
            const prelievoDate = s.dataPrelievo;
            const todayDate = currentDate;
            
            // Converti le date in formato dd/mm/yyyy per il confronto
            const [prelievoDay, prelievoMonth, prelievoYear] = prelievoDate.split('/');
            const [todayDay, todayMonth, todayYear] = todayDate.split('/');
            
            const prelievoDateObj = new Date(prelievoYear, prelievoMonth - 1, prelievoDay);
            const todayDateObj = new Date(todayYear, todayMonth - 1, todayDay);
            
            return prelievoDateObj > todayDateObj;
        });
        safeLog(`🔮 Servizi futuri (DATA_PRELIEVO > ${currentDate}): ${serviziFuturi.length}`, 'info');
        
        // Aggiorna le colonne dei servizi
        updateServicesColumn('SERVIZI DEL GIORNO', serviziDelGiorno);
        updateServicesColumn('PROSSIMI SERVIZI', serviziFuturi);
        
        // Aggiorna la colonna tessere
        if (data.tesserati && Array.isArray(data.tesserati)) {
            const tesseratiInScadenza = data.tesserati.filter(t => t && t.stato === 'in scadenza');
            updateTessereColumn(tesseratiInScadenza);
        }
        
        safeLog('✅ Interfaccia aggiornata con dati SharePoint', 'info');
        
    } catch (error) {
        safeLog(`❌ Errore aggiornamento interfaccia SharePoint: ${error.message}`, 'error');
        showStatusMessage('❌ Errore aggiornamento interfaccia SharePoint', 'error');
    }
}

// Aggiorna una colonna servizi
function updateServicesColumn(columnTitle, services) {
    // Trova la colonna usando un approccio più compatibile
    const columns = document.querySelectorAll('.content-column');
    let targetColumn = null;
    
    // Cerca la colonna con il titolo corretto
    for (const column of columns) {
        const titleElement = column.querySelector('.column-title');
        if (titleElement && titleElement.textContent === columnTitle) {
            targetColumn = column;
            break;
        }
    }
    
    if (!targetColumn) {
        safeLog(`❌ Colonna "${columnTitle}" non trovata`, 'error');
        return;
    }
    
    const container = targetColumn.querySelector('.services-container');
    if (!container) {
        safeLog(`❌ Container servizi non trovato in "${columnTitle}"`, 'error');
        return;
    }
    
    // Pulisci il contenuto esistente
    container.innerHTML = '';
    
    safeLog(`📝 Aggiornamento colonna "${columnTitle}" con ${services.length} servizi`, 'info');
    
    // Aggiungi i servizi dalla lista
    services.forEach((service, index) => {
        const serviceCard = createServiceCard(service);
        container.appendChild(serviceCard);
        safeLog(`✅ Aggiunto servizio ${service.id} (${index + 1}/${services.length})`, 'debug');
    });
    
    // Se non ci sono servizi, mostra messaggio
    if (services.length === 0) {
        container.innerHTML = '<div class="empty-services"><p>Nessun servizio disponibile</p></div>';
        safeLog(`ℹ️ Nessun servizio da mostrare in "${columnTitle}"`, 'info');
    }
    
    safeLog(`✅ Colonna "${columnTitle}" aggiornata con successo`, 'info');
}

// Crea una scheda servizio
function createServiceCard(service) {
    const card = document.createElement('div');
    card.className = 'service-card';
    
    // Dettagli del servizio (senza header ridondante)
    const details = document.createElement('div');
    details.className = 'service-details';
    
    // RIGA 1: ID Servizio + OPERATORE (3 campi sulla stessa riga)
    const row1 = document.createElement('div');
    row1.className = 'detail-row-1';
    
    const idServizioValue = document.createElement('div');
    idServizioValue.className = 'value';
    idServizioValue.textContent = service.id;
    
    const operatoreLabel = document.createElement('div');
    operatoreLabel.className = 'label';
    operatoreLabel.textContent = 'OPERATORE';
    
    const operatoreValue = document.createElement('div');
    operatoreValue.className = 'value';
    operatoreValue.textContent = service.operatore;
    
    row1.appendChild(idServizioValue);
    row1.appendChild(operatoreLabel);
    row1.appendChild(operatoreValue);
    
    // RIGA 2: Data + Nominativo (4 campi affiancati sulla stessa riga)
    const row2 = document.createElement('div');
    row2.className = 'detail-row-2';
    
    const dataLabel = document.createElement('div');
    dataLabel.className = 'label';
    dataLabel.textContent = 'Data';
    
    const dataValue = document.createElement('div');
    dataValue.className = 'value';
    dataValue.textContent = service.data;
    
    const nominativoLabel = document.createElement('div');
    nominativoLabel.className = 'label';
    nominativoLabel.textContent = 'Nominativo';
    
    const nominativoValue = document.createElement('div');
    nominativoValue.className = 'value';
    nominativoValue.textContent = service.nominativo;
    
    row2.appendChild(dataLabel);
    row2.appendChild(dataValue);
    row2.appendChild(nominativoLabel);
    row2.appendChild(nominativoValue);
    
    // RIGA 3: ORA SOTTO CASA + ORA A DESTINAZIONE (4 campi sulla stessa riga)
    const row3 = document.createElement('div');
    row3.className = 'detail-row-3';
    
    const oraSottoCasaLabel = document.createElement('div');
    oraSottoCasaLabel.className = 'label';
    oraSottoCasaLabel.textContent = 'ORA SOTTO CASA';
    
    const oraSottoCasaValue = document.createElement('div');
    oraSottoCasaValue.className = 'value';
    oraSottoCasaValue.textContent = service.oraSottoCasa;
    
    const oraDestinazioneLabel = document.createElement('div');
    oraDestinazioneLabel.className = 'label';
    oraDestinazioneLabel.textContent = 'ORA A DESTINAZIONE';
    
    const oraDestinazioneValue = document.createElement('div');
    oraDestinazioneValue.className = 'value empty';
    oraDestinazioneValue.textContent = service.oraDestinazione || '';
    
    row3.appendChild(oraSottoCasaLabel);
    row3.appendChild(oraSottoCasaValue);
    row3.appendChild(oraDestinazioneLabel);
    row3.appendChild(oraDestinazioneValue);
    
    // RIGA 4: TIPO DI SERVIZIO (1 campo che occupa tutta la larghezza)
    const row4 = document.createElement('div');
    row4.className = 'detail-row-4';
    
    const tipoServizioLabel = document.createElement('div');
    tipoServizioLabel.className = 'label';
    tipoServizioLabel.textContent = 'TIPO DI SERVIZIO';
    
    const tipoServizioValue = document.createElement('div');
    tipoServizioValue.className = 'value';
    tipoServizioValue.textContent = service.tipoServizio;
    
    row4.appendChild(tipoServizioLabel);
    row4.appendChild(tipoServizioValue);
    
    // Aggiungi le righe ai dettagli
    details.appendChild(row1);
    details.appendChild(row2);
    details.appendChild(row3);
    details.appendChild(row4);
    
    // Pulsanti azioni
    const actions = document.createElement('div');
    actions.className = 'service-actions';
    
    const btnPrint = document.createElement('button');
    btnPrint.className = 'btn-print';
    btnPrint.textContent = 'STAMPA';
    
    const btnModify = document.createElement('button');
    btnModify.className = 'btn-modify';
    btnModify.textContent = 'MODIFICA';
    
    const btnComplete = document.createElement('button');
    btnComplete.className = 'btn-complete';
    btnComplete.textContent = 'COMPLETA';
    
    actions.appendChild(btnPrint);
    actions.appendChild(btnModify);
    actions.appendChild(btnComplete);
    
    // Assembla la scheda (senza header)
    card.appendChild(details);
    card.appendChild(actions);
    
    // Aggiungi eventi ai pulsanti
    setupServiceCardButtons(card);
    
    return card;
}

// Aggiorna colonna tessere
function updateTessereColumn(tesseramenti) {
    const tessereContainer = document.querySelector('.tessere-container');
    if (!tessereContainer) return;
    
    if (tesseramenti.length === 0) {
        tessereContainer.innerHTML = '<div class="empty-tessere"><p>Nessuna tessera in attesa</p></div>';
    } else {
        let html = '<div class="tessere-list">';
        tesseramenti.forEach(tessera => {
            html += `
                <div class="tessera-item">
                    <div class="tessera-nome">${tessera.nome}</div>
                    <div class="tessera-scadenza">Scadenza: ${tessera.scadenza}</div>
                    <div class="tessera-stato">${tessera.stato}</div>
                </div>
            `;
        });
        html += '</div>';
        tessereContainer.innerHTML = html;
    }
}

// Aggiorna indicatori di stato connessione
function updateConnectionStatus() {
    const statusIndicator = document.querySelector('.connection-status');
    if (statusIndicator) {
        if (appState.isConnected) {
            statusIndicator.innerHTML = `
                <span class="status-connected">🟢 Connesso a SharePoint</span>
                <span class="last-sync">Ultimo aggiornamento: ${appState.lastSync.toLocaleTimeString('it-IT')}</span>
            `;
        } else {
            statusIndicator.innerHTML = `
                <span class="status-disconnected">🔴 Disconnesso da SharePoint</span>
                <span class="last-error">Errore: ${appState.error || 'Sconosciuto'}</span>
            `;
        }
    }
}

// ========================================
// GESTIONE MESSAGGI E STATO
// ========================================

// Mostra messaggio di stato
function showStatusMessage(message, type = 'info') {
    // Rimuovi messaggi precedenti
    const existingMessage = document.querySelector('.status-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Crea nuovo messaggio
    const statusMessage = document.createElement('div');
    statusMessage.className = `status-message status-${type}`;
    statusMessage.innerHTML = message;
    
    // Aggiungi alla pagina
    document.body.appendChild(statusMessage);
    
    // Rimuovi automaticamente dopo 5 secondi
    setTimeout(() => {
        if (statusMessage.parentNode) {
            statusMessage.remove();
        }
    }, 5000);
}

// Mostra pulsante per riprovare
function showRetryButton() {
    const existingButton = document.querySelector('.retry-button');
    if (existingButton) return;
    
    const retryButton = document.createElement('button');
    retryButton.className = 'retry-button';
    retryButton.innerHTML = '🔄 Riprova connessione SharePoint';
    retryButton.onclick = () => {
        retryButton.remove();
        connectToSharePoint();
    };
    
    // Aggiungi alla pagina
    const header = document.querySelector('.main-header');
    if (header) {
        header.appendChild(retryButton);
    }
}

// ========================================
// FUNZIONI ORIGINALI MANTENUTE
// ========================================

// Funzione per aggiornare la data corrente
function updateCurrentDate() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    const dateString = now.toLocaleDateString('it-IT', options);
    
    // Calcola il numero della settimana
    const start = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil(days / 7);
    
    // Aggiorna gli elementi nella nuova posizione (header sinistro)
    const currentDateElement = document.querySelector('.date-info-left .current-date');
    const weekInfoElement = document.querySelector('.date-info-left .week-info');
    
    if (currentDateElement) {
        currentDateElement.textContent = dateString;
    }
    
    if (weekInfoElement) {
        weekInfoElement.textContent = `Settimana numero ${weekNumber}`;
    }
}

// Funzione per gestire i pulsanti di navigazione
function setupNavigationButtons() {
    const navButtons = document.querySelectorAll('.nav-btn');
    
    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            const buttonText = this.textContent;
            safeLog(`Pulsante cliccato: ${buttonText}`, 'info');
            
            // Aggiungi effetto di feedback visivo
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
            
            // Gestisci ogni pulsante
            switch(buttonText) {
                case 'CALENDARIO ONLINE':
                    safeLog('Calendario Online aperto', 'info');
                    alert('Apertura Calendario Online...');
                    break;
                case 'REPORT DEL GIORNO':
                    showData('servizi', 'Report del Giorno');
                    break;
                case 'REPORT SETTIMANALE':
                    showData('servizi', 'Report Settimanale');
                    break;
                case 'ELENCO SERVIZI':
                    showData('servizi', 'Elenco Servizi');
                    break;
                case 'ELENCO SOCI':
                    showData('tesserati', 'Elenco Soci');
                    break;
                case 'ELENCO OPERATORI':
                    showData('operatori', 'Elenco Operatori');
                    break;
                case 'ELENCO MEZZI':
                    showData('automezzi', 'Elenco Mezzi');
                    break;
                case 'NUOVO SERVIZIO':
                    safeLog('Nuovo Servizio richiesto', 'info');
                    alert('Creazione Nuovo Servizio...');
                    break;
            }
        });
    });
}

// Mostra dati in modal
function showData(listType, title) {
    const data = appState.data[listType] || [];
    
    let message = `${title}\n\n`;
    if (data.length === 0) {
        message += 'Nessun dato disponibile';
    } else {
        data.forEach((item, index) => {
            if (typeof item === 'string') {
                message += `${index + 1}. ${item}\n`;
            } else if (item.nome) {
                message += `${index + 1}. ${item.nome}\n`;
            } else if (item.id) {
                message += `${index + 1}. Servizio ${item.id} - ${item.nominativo}\n`;
            }
        });
    }
    
    alert(message);
}

// Funzione per gestire i pulsanti delle schede servizio
function setupServiceCardButtons(serviceCard) {
    // Gestione pulsanti STAMPA
    const printButtons = serviceCard.querySelectorAll('.btn-print');
    printButtons.forEach(button => {
        button.addEventListener('click', function() {
            const serviceId = serviceCard.querySelector('.value').textContent;
            safeLog(`Stampa servizio ${serviceId}`, 'info');
            alert(`Stampa servizio ${serviceId}`);
        });
    });
    
    // Gestione pulsanti MODIFICA
    const modifyButtons = serviceCard.querySelectorAll('.btn-modify');
    modifyButtons.forEach(button => {
        button.addEventListener('click', function() {
            const serviceId = serviceCard.querySelector('.value').textContent;
            safeLog(`Modifica servizio ${serviceId}`, 'info');
            alert(`Modifica servizio ${serviceId}`);
        });
    });
    
    // Gestione pulsanti COMPLETA
    const completeButtons = serviceCard.querySelectorAll('.btn-complete');
    completeButtons.forEach(button => {
        button.addEventListener('click', function() {
            const serviceId = serviceCard.querySelector('.value').textContent;
            safeLog(`Completamento servizio ${serviceId}`, 'info');
            
            // Aggiungi effetto visivo di completamento
            serviceCard.style.opacity = '0.6';
            serviceCard.style.border = '2px solid #22c55e';
            
            // Rimuovi i pulsanti dopo il completamento
            const actions = serviceCard.querySelector('.service-actions');
            if (actions) {
                actions.innerHTML = '<div style="text-align: center; color: #22c55e; font-weight: bold;">SERVIZIO COMPLETATO</div>';
            }
            
            alert(`Servizio ${serviceId} completato con successo!`);
        });
    });
}

// Funzione per gestire il pulsante di chiusura applicazione
function setupCloseButton() {
    const closeBtn = document.querySelector('.btn-close-app');
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            safeLog('Chiusura applicazione richiesta', 'info');
            
            if (confirm('Sei sicuro di voler chiudere l\'applicazione?')) {
                // Simula la chiusura dell'applicazione
                document.body.style.opacity = '0';
                setTimeout(() => {
                    alert('Applicazione chiusa');
                }, 500);
            }
        });
    }
}

// Funzione per aggiungere effetti hover alle schede servizio
function setupServiceCardHover() {
    const serviceCards = document.querySelectorAll('.service-card');
    
    serviceCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.1)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
        });
    });
}

// ========================================
// INIZIALIZZAZIONE APPLICAZIONE
// ========================================

// Funzione per inizializzare l'applicazione
async function initializeApp() {
    safeLog('🚀 Inizializzazione applicazione GESTIONE OPERATIVA...', 'info');
    
    // Inizializza la modalità
    initializeAppMode();
    
    // Aggiorna la data corrente
    updateCurrentDate();
    
    // Imposta i pulsanti di navigazione
    setupNavigationButtons();
    
    // Imposta il pulsante di chiusura
    setupCloseButton();
    
    // Imposta gli effetti hover per le schede
    setupServiceCardHover();
    
    // Carica i dati appropriati per la modalità
    safeLog('🔄 Caricamento dati per modalità: ' + appState.mode, 'info');
    await loadApplicationData();
    
    safeLog('✅ Applicazione inizializzata con successo!', 'info');
}

// Aspetta che il DOM sia completamente caricato
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Aggiorna la data ogni minuto
setInterval(updateCurrentDate, 60000);

// Sincronizza dati ogni 5 minuti (solo in produzione)
setInterval(async () => {
    if (appState.mode === 'production' && appState.isConnected) {
        safeLog('🔄 Sincronizzazione periodica con SharePoint...', 'info');
        await loadAllSharePointData();
    }
}, 300000); // 5 minuti

// Gestione errori globale
window.addEventListener('error', function(e) {
    safeLog(`Errore nell'applicazione: ${e.error}`, 'error');
    showStatusMessage('❌ Errore nell\'applicazione', 'error');
});

// Gestione errori per le promesse non gestite
window.addEventListener('unhandledrejection', function(e) {
    safeLog(`Promessa rifiutata non gestita: ${e.reason}`, 'error');
    showStatusMessage('❌ Errore di connessione', 'error');
});