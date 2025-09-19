// ========================================
// ELENCO SERVIZI - GESTIONE DINAMICA
// Collegabile a SharePoint
// ========================================

// Classe per gestire i servizi
class ServizioManager {
    constructor() {
        this.servizi = [];
        this.init();
    }

    // Inizializzazione
    async init() {
        await this.caricaServizi();
        this.setupEventListeners();
        this.aggiornaInterfaccia();
    }

    // Carica i servizi (da SharePoint o dati locali)
    async caricaServizi() {
        console.log('=== CARICAMENTO DATI SHAREPOINT ===');
        console.log('Tentativo di collegamento a SharePoint...');
        
        // Ora proviamo a caricare da SharePoint
        const successo = await this.caricaDaSharePoint();
        
        // Se fallisce, usa i dati di esempio
        if (!successo) {
            console.log('Usando dati di esempio per sviluppo');
            this.servizi = [
            {
                id: 159,
                dataPrelievo: "02/09/2025",
                idSocio: "12345",
                socioTrasportato: "ASTUTI GUIDO",
                oraInizio: "08:00",
                comunePrelievo: "ROMA",
                luogoPrelievo: "VIA ROMA 123",
                tipoServizio: "STANDARD", // STANDARD o SOLLEVATORE
                carrozzina: "",
                motivazione: "Visita medica",
                oraArrivo: "09:30",
                comuneDestinazione: "ROMA",
                luogoDestinazione: "OSPEDALE SANTO SPIRITO",
                pagamento: "0,00 €",
                operatore: "ANDREAZZA MARIA",
                tempo: ["0", "0"],
                mezzoUsato: "FIAT PANDA (3)",
                km: "15",
                richiedente: "SOCIO",
                statoServizio: "ESEGUITO",
                statoIncasso: "DA INCASSARE",
                note: "",
                tipoPagamento: "CONTANTI",
                dataBonifico: "",
                st: true,  // Checkbox ST (nascosto)
                sv: false  // Checkbox SV (nascosto)
            },
            {
                id: 165,
                dataPrelievo: "31/08/2025",
                idSocio: "67890",
                socioTrasportato: "ABBA TERESA",
                oraInizio: "08:24",
                comunePrelievo: "MILANO",
                luogoPrelievo: "VIA MILANO 456",
                tipoServizio: "SOLLEVATORE", // STANDARD o SOLLEVATORE
                carrozzina: "SOCIO",
                motivazione: "Controllo fisioterapico",
                oraArrivo: "10:00",
                comuneDestinazione: "MILANO",
                luogoDestinazione: "CENTRO FISIOTERAPIA",
                pagamento: "10,00 €",
                operatore: "PASCARIELLO GIUSEPPE",
                tempo: ["0", "0"],
                mezzoUsato: "()",
                km: "8",
                richiedente: "COMUNE",
                statoServizio: "ANNULLATO",
                statoIncasso: "DA INCASSARE",
                note: "",
                tipoPagamento: "CONTANTI",
                dataBonifico: "",
                st: false, // Checkbox ST (nascosto)
                sv: true   // Checkbox SV (nascosto)
            },
            {
                id: 166,
                dataPrelievo: "31/08/2025",
                idSocio: "67890",
                socioTrasportato: "ABBA TERESA",
                oraInizio: "08:24",
                comunePrelievo: "MILANO",
                luogoPrelievo: "VIA MILANO 456",
                tipoServizio: "SOLLEVATORE", // STANDARD o SOLLEVATORE
                carrozzina: "SOCIO",
                motivazione: "Controllo fisioterapico",
                oraArrivo: "10:00",
                comuneDestinazione: "MILANO",
                luogoDestinazione: "CENTRO FISIOTERAPIA",
                pagamento: "10,00 €",
                operatore: "PASCARIELLO GIUSEPPE",
                tempo: ["0", "0"],
                mezzoUsato: "()",
                km: "8",
                richiedente: "COMUNE",
                statoServizio: "ANNULLATO",
                statoIncasso: "DA INCASSARE",
                note: "",
                tipoPagamento: "CONTANTI",
                dataBonifico: "",
                st: false, // Checkbox ST (nascosto)
                sv: true   // Checkbox SV (nascosto)
            }
        ];
        
        // Genera i servizi dal template
        this.generaServizi();
        }
    }
    
    // Genera i servizi dal template
    generaServizi() {
        const container = document.getElementById('servizi-container');
        if (!container) return;
        
        // Pulisce il container
        container.innerHTML = '';
        
        // Genera ogni servizio dal template
        this.servizi.forEach(servizio => {
            const elemento = this.creaServizioDalTemplate(servizio);
            if (elemento) {
                container.appendChild(elemento);
            }
        });
    }
    
    // Crea un servizio dal template
    creaServizioDalTemplate(servizio) {
        const template = document.getElementById('servizio-template');
        if (!template) {
            console.error('Template servizio non trovato!');
            return null;
        }
        
        // Clona il template
        const clone = template.content.cloneNode(true);
        
        // Imposta l'ID del servizio
        const container = clone.querySelector('.container');
        container.setAttribute('data-servizio-id', servizio.id);
        
        // Popola tutti i campi
        this.popolaCampi(clone, servizio);
        
        // Aggiunge gli event listener
        this.aggiungiEventListeners(clone, servizio);
        
        return clone;
    }
    
    // Popola i campi del servizio
    popolaCampi(elemento, servizio) {
        // Prima riga
        elemento.querySelector('.service-ids').value = servizio.id;
        elemento.querySelector('.service-data').value = servizio.dataPrelievo;
        elemento.querySelector('.service-idsocio').value = servizio.idSocio || '';
        elemento.querySelector('.service-socio').value = servizio.socioTrasportato;
        elemento.querySelector('.service-ora-inizio').value = servizio.oraInizio;
        elemento.querySelector('.service-comune').value = servizio.comunePrelievo;
        elemento.querySelector('.service-luogo').value = servizio.luogoPrelievo;
        elemento.querySelector('.service-tipo').value = servizio.tipoServizio;
        elemento.querySelector('.service-carrozzina').value = servizio.carrozzina;
        elemento.querySelector('.service-carrozzina').setAttribute('data-carrozzina', servizio.carrozzina);
        
        // Seconda riga
        elemento.querySelector('.col-richiedente input').value = servizio.richiedente;
        elemento.querySelector('.col-motivazione input').value = servizio.motivazione;
        elemento.querySelector('.col-ora-arrivo input').value = servizio.oraArrivo;
        elemento.querySelector('.col-comune-destinazione input').value = servizio.comuneDestinazione;
        elemento.querySelector('.col-luogo-destinazione input').value = servizio.luogoDestinazione;
        elemento.querySelector('.col-pagamento input').value = servizio.pagamento;
        elemento.querySelector('.col-stato-incasso input').value = servizio.statoIncasso;
        
        // Terza riga
        elemento.querySelector('.col-operatore input').value = servizio.operatore;
        const campiTempo = elemento.querySelectorAll('.col-tempo input');
        if (campiTempo[0]) campiTempo[0].value = servizio.tempo[0];
        if (campiTempo[1]) campiTempo[1].value = servizio.tempo[1];
        elemento.querySelector('.col-mezzo input').value = servizio.mezzoUsato;
        elemento.querySelector('.col-km input').value = servizio.km;
        elemento.querySelector('.col-stato-servizio input').value = servizio.statoServizio;
        
        // Quarta riga
        elemento.querySelector('.col-note input').value = servizio.note;
        elemento.querySelector('.col-tipo-pagamento input').value = servizio.tipoPagamento;
        elemento.querySelector('.col-data-bonifico input').value = servizio.dataBonifico;
    }
    
    // Aggiunge gli event listener al servizio
    aggiungiEventListeners(elemento, servizio) {
        // Pulsante FILTRA
        const btnFiltra = elemento.querySelector('.btn-filtra');
        if (btnFiltra) {
            btnFiltra.addEventListener('click', (e) => this.filtraServizio(e));
        }
        
        // Pulsanti azioni
        const btnStampa = elemento.querySelector('.btn-stampa');
        if (btnStampa) {
            btnStampa.addEventListener('click', (e) => this.stampaServizio(e));
        }
        
        const btnModifica = elemento.querySelector('.btn-modifica');
        if (btnModifica) {
            btnModifica.addEventListener('click', (e) => this.modificaServizio(e));
        }
        
        const btnCompleta = elemento.querySelector('.btn-completa');
        if (btnCompleta) {
            btnCompleta.addEventListener('click', (e) => this.completaServizio(e));
        }
    }

    // Imposta gli event listener
    setupEventListeners() {
        // Barra di ricerca
        const searchInputs = document.querySelectorAll('.search-bar input');
        searchInputs.forEach(input => {
            input.addEventListener('input', () => this.filtraServizi());
        });

        // Pulsante MOSTRA TUTTO
        const btnMostraTutto = document.querySelector('.search-bar button');
        if (btnMostraTutto) {
            btnMostraTutto.addEventListener('click', () => this.mostraTuttiServizi());
        }

        // Footer CHIUDI
        const footer = document.querySelector('.footer');
        if (footer) {
            footer.addEventListener('click', () => this.chiudiInterfaccia());
        }
    }

    // Aggiorna l'interfaccia con i dati
    aggiornaInterfaccia() {
        // Non serve più aggiornare elementi esistenti
        // I servizi vengono generati dinamicamente dal template
        console.log('Interfaccia aggiornata - servizi generati dal template');
    }

    // Aggiorna un singolo campo
    aggiornaCampo(container, selector, valore) {
        const campo = container.querySelector(selector);
        if (campo && campo.tagName === 'INPUT') {
            campo.value = valore;
        }
    }

    // Filtra servizi per ricerca
    filtraServizi() {
        const searchInputs = document.querySelectorAll('.search-bar input');
        const query = Array.from(searchInputs).map(input => input.value.toLowerCase()).join(' ');

        if (!query.trim()) {
            this.mostraTuttiServizi();
            return;
        }

        const serviziFiltrati = this.servizi.filter(servizio => {
            return Object.values(servizio).some(valore => 
                String(valore).toLowerCase().includes(query)
            );
        });

        this.mostraServiziFiltrati(serviziFiltrati);
    }

    // Mostra servizi filtrati
    mostraServiziFiltrati(serviziFiltrati) {
        const container = document.getElementById('servizi-container');
        if (!container) return;
        
        container.querySelectorAll('.container').forEach(containerServizio => {
            const servizioId = parseInt(containerServizio.getAttribute('data-servizio-id'));
            const servizioTrovato = serviziFiltrati.find(s => s.id === servizioId);
            
            if (servizioTrovato) {
                containerServizio.style.display = 'block';
            } else {
                containerServizio.style.display = 'none';
            }
        });
    }

    // Mostra tutti i servizi
    mostraTuttiServizi() {
        const container = document.getElementById('servizi-container');
        if (!container) return;
        
        container.querySelectorAll('.container').forEach(containerServizio => {
            containerServizio.style.display = 'block';
        });
    }

    // Filtra un singolo servizio (pulsante FILTRA)
    filtraServizio(event) {
        const btn = event.target;
        const container = btn.closest('.container');
        const servizioId = parseInt(container.getAttribute('data-servizio-id'));
        
        console.log(`Filtro attivato per servizio ${servizioId}`);
        // Qui puoi implementare la logica di filtro specifica
    }

    // Stampa servizio
    stampaServizio(event) {
        const btn = event.target;
        const container = btn.closest('.container');
        const servizioId = parseInt(container.getAttribute('data-servizio-id'));
        
        console.log(`Stampa servizio ${servizioId}`);
        // Implementa la logica di stampa
    }

    // Modifica servizio
    modificaServizio(event) {
        const btn = event.target;
        const container = btn.closest('.container');
        const servizioId = parseInt(container.getAttribute('data-servizio-id'));
        
        console.log(`Modifica servizio ${servizioId}`);
        this.abilitaCampi(container, true);
    }

    // Completa servizio
    completaServizio(event) {
        const btn = event.target;
        const container = btn.closest('.container');
        const servizioId = parseInt(container.getAttribute('data-servizio-id'));
        
        console.log(`Completa servizio ${servizioId}`);
        this.abilitaCampi(container, false);
    }

    // Abilita/disabilita campi
    abilitaCampi(container, abilita) {
        const campi = container.querySelectorAll('input:not(.service-ids):not(.service-tipo), select');
        campi.forEach(campo => {
            campo.disabled = !abilita;
        });
    }

    // Chiudi interfaccia
    chiudiInterfaccia() {
        console.log('Chiusura interfaccia');
        // Implementa la logica di chiusura
    }

    // ========================================
    // METODI PER SHAREPOINT
    // ========================================

    // Carica servizi da SharePoint
    async caricaDaSharePoint() {
        try {
            console.log('🔄 Tentativo di caricamento da SharePoint...');
            
            // Prima facciamo una diagnosi completa
            if (window.SharePointHelper && SharePointHelper.diagnoseConnection) {
                console.log('🔍 Eseguendo diagnosi preliminare...');
                const diagnosi = await SharePointHelper.diagnoseConnection();
                
                // Se tutti i test falliscono, non tentare il caricamento
                if (diagnosi.summary.passed === 0) {
                    console.log('❌ Diagnosi fallita - impossibile procedere con il caricamento');
                    return false;
                }
            }
            
            // Ottieni gli header di autenticazione
            const headers = await SharePointHelper.getAuthHeaders();
            
            // Costruisci l'URL completo con parametri OData per migliori performance
            const apiUrl = SharePointHelper.buildApiUrl(
                SHAREPOINT_CONFIG.apiEndpoint + 
                '?$select=ID,DataPrelievo,SocioTrasportato,OraInizio,ComunePrelievo,LuogoPrelievo,ST,SV,Carrozzina,Motivazione,OraArrivo,ComuneDestinazione,LuogoDestinazione,Pagamento,Operatore,Tempo,MezzoUsato,KM,Richiedente,StatoServizio,StatoIncasso,Note,TipoPagamento,DataBonifico' +
                '&$top=100' + // Limita i risultati per test
                '&$orderby=ID desc' // Ordina per ID decrescente
            );
            
            console.log('🌐 URL API completo:', apiUrl);
            
            // Chiamata a SharePoint REST API con credenziali e timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SHAREPOINT_CONFIG.timeout);
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    ...headers,
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose'
                },
                credentials: 'include', // Importante per SharePoint Online
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                // Gestione dettagliata degli errori HTTP
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                
                switch (response.status) {
                    case 401:
                        errorMessage = 'Non autorizzato - Effettua il login su SharePoint';
                        break;
                    case 403:
                        errorMessage = 'Accesso negato - Verifica i permessi sulla lista LOREAPP_SERVIZI';
                        break;
                    case 404:
                        errorMessage = 'Lista LOREAPP_SERVIZI non trovata - Verifica il nome della lista';
                        break;
                    case 500:
                        errorMessage = 'Errore interno del server SharePoint';
                        break;
                }
                
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            console.log('📥 Dati ricevuti da SharePoint:', data);
            
            // Verifica formato dati SharePoint (formato OData verbose)
            const items = data.d && data.d.results ? data.d.results : 
                         data.value ? data.value : [];
            
            if (items.length === 0) {
                console.log('⚠️ Nessun dato trovato nella lista LOREAPP_SERVIZI');
                return false;
            }
            
            // Converte i dati SharePoint nel formato dell'app
            this.servizi = items.map(item => this.convertiDaSharePoint(item));
            
            console.log('✅ Caricamento da SharePoint completato -', this.servizi.length, 'servizi caricati');
            
            // Genera i servizi dal template
            this.generaServizi();
            
            return true; // Successo
            
        } catch (error) {
            console.error('❌ Errore caricamento SharePoint:', error);
            
            // Log dettagliato per debugging
            if (error.name === 'AbortError') {
                console.error('⏱️ Timeout - La richiesta ha impiegato troppo tempo');
            } else if (error.message.includes('CORS')) {
                console.error('🚫 Errore CORS - Impossibile accedere a SharePoint dal browser');
                console.error('💡 Soluzione: Usa SharePoint Framework o Power Platform');
            } else if (error.message.includes('network')) {
                console.error('🌐 Errore di rete - Verifica la connessione internet');
            }
            
            // Prima di arrendersi, proviamo l'approccio iframe
            console.log('🔄 Tentativo con metodo iframe come fallback...');
            try {
                if (SharePointHelper.loadDataViaIframe) {
                    const dataIframe = await SharePointHelper.loadDataViaIframe();
                    
                    if (dataIframe && dataIframe.d && dataIframe.d.results) {
                        this.servizi = dataIframe.d.results.map(item => this.convertiDaSharePoint(item));
                        console.log('✅ Caricamento iframe completato -', this.servizi.length, 'servizi caricati');
                        this.generaServizi();
                        return true;
                    }
                }
            } catch (iframeError) {
                console.error('❌ Anche il metodo iframe ha fallito:', iframeError.message);
            }
            
            return false; // Fallimento
        }
    }

    // Converte dati da SharePoint
    convertiDaSharePoint(item) {
        return {
            id: item.ID,
            dataPrelievo: item.DataPrelievo,
            socioTrasportato: item.SocioTrasportato,
            oraInizio: item.OraInizio,
            comunePrelievo: item.ComunePrelievo,
            luogoPrelievo: item.LuogoPrelievo,
            tipoServizio: item.ST ? "STANDARD" : "SOLLEVATORE",
            carrozzina: item.Carrozzina,
            // ... altri campi
        };
    }

    // Salva servizio su SharePoint
    async salvaSuSharePoint(servizio) {
        try {
            // Esempio di salvataggio SharePoint
            // const response = await fetch('/_api/web/lists/getbytitle(\'Servizi\')/items', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(servizio)
            // });
            
            console.log('Servizio salvato su SharePoint');
        } catch (error) {
            console.error('Errore salvataggio SharePoint:', error);
        }
    }
}

// ========================================
// INIZIALIZZAZIONE
// ========================================

// Test immediato
console.log('=== FILE ELENCO_SERVIZI.JS CARICATO ===');

// Attendi che il DOM sia caricato
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOM CARICATO - INIZIALIZZAZIONE ELENCO SERVIZI ===');
    
    // Crea l'istanza del manager
    window.servizioManager = new ServizioManager();
    
    console.log('=== ELENCO SERVIZI INIZIALIZZATO CON SUCCESSO ===');
});

// ========================================
// FUNZIONI UTILITY
// ========================================

// Funzione per aggiornare il tipo servizio in base ai checkbox
function aggiornaTipoServizio(container) {
    const stCheckbox = container.querySelector('input[type="checkbox"][data-st]');
    const svCheckbox = container.querySelector('input[type="checkbox"][data-sv]');
    const tipoField = container.querySelector('.service-tipo');
    
    if (stCheckbox && svCheckbox && tipoField) {
        if (stCheckbox.checked) {
            tipoField.value = "STANDARD";
        } else if (svCheckbox.checked) {
            tipoField.value = "SOLLEVATORE";
        }
    }
}

// Funzione per sincronizzare i dati con SharePoint
function sincronizzaConSharePoint() {
    if (window.servizioManager) {
        window.servizioManager.caricaDaSharePoint();
    }
}

// Funzione di diagnosi completa SharePoint
async function diagnoseSharePoint() {
    console.log('🚀 Avvio diagnosi completa SharePoint...');
    
    if (window.SharePointHelper && SharePointHelper.diagnoseConnection) {
        const results = await SharePointHelper.diagnoseConnection();
        
        // Mostra i risultati anche nell'interfaccia utente
        const container = document.getElementById('servizi-container');
        if (container && results.summary.failed > 0) {
            container.innerHTML = `
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; margin: 20px; border-radius: 5px;">
                    <h3 style="color: #856404; margin-top: 0;">🔍 Risultati Diagnosi SharePoint</h3>
                    <p><strong>Test superati:</strong> ${results.summary.passed}</p>
                    <p><strong>Test falliti:</strong> ${results.summary.failed}</p>
                    <ul style="margin: 15px 0;">
                        ${results.tests.map(test => 
                            `<li style="color: ${test.status === 'PASSED' ? '#28a745' : '#dc3545'};">
                                ${test.status === 'PASSED' ? '✅' : '❌'} ${test.name}: ${test.message}
                            </li>`
                        ).join('')}
                    </ul>
                    ${results.summary.failed > 0 ? `
                        <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; margin-top: 15px; border-radius: 3px;">
                            <h4 style="color: #721c24; margin-top: 0;">💡 Suggerimenti per risolvere i problemi:</h4>
                            <ul style="margin: 10px 0; color: #721c24;">
                                <li>Assicurati di essere <strong>loggato su SharePoint</strong> nello stesso browser</li>
                                <li>Verifica che la lista <strong>LOREAPP_SERVIZI</strong> esista nel sito</li>
                                <li>Controlla di avere <strong>permessi di lettura</strong> sulla lista</li>
                                <li>Prova ad accedere manualmente al sito: <a href="${SHAREPOINT_CONFIG.siteUrl}" target="_blank">${SHAREPOINT_CONFIG.siteUrl}</a></li>
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        return results;
    } else {
        console.error('❌ SharePointHelper non disponibile');
        return null;
    }
}

// Funzione per testare la connessione SharePoint (versione semplificata)
async function testaConnessioneSharePoint() {
    console.log('=== TEST CONNESSIONE SHAREPOINT RAPIDO ===');
    
    try {
        // Prima prova una diagnosi completa
        const risultati = await diagnoseSharePoint();
        
        if (risultati && risultati.summary.passed > 0) {
            console.log('🔄 Tentativo di caricamento dati reali...');
            
            // Se almeno alcuni test passano, prova a caricare i dati
            if (window.servizioManager) {
                const successo = await window.servizioManager.caricaDaSharePoint();
                
                if (successo) {
                    console.log('🎉 Test completato con successo! Dati caricati da SharePoint.');
                } else {
                    console.log('⚠️ Test parzialmente superato, ma caricamento dati fallito.');
                }
            }
        } else {
            console.log('❌ Test fallito - impossibile accedere a SharePoint');
        }
        
    } catch (error) {
        console.error('❌ Errore durante il test:', error.message);
        console.log('💡 Prova la DIAGNOSI COMPLETA per maggiori dettagli');
    }
}

// Funzione per aprire SharePoint direttamente
function apriSharePoint() {
    console.log('🌐 Apertura SharePoint in nuova finestra...');
    
    // Apre SharePoint in una nuova finestra
    const sharepointWindow = window.open(
        SHAREPOINT_CONFIG.siteUrl + '/Lists/LOREAPP_SERVIZI/',
        'SharePoint_LOREAPP_SERVIZI',
        'width=1200,height=800,scrollbars=yes,resizable=yes'
    );
    
    if (sharepointWindow) {
        console.log('✅ SharePoint aperto in nuova finestra');
        
        // Prova a rilevare quando la finestra è pronta per comunicare
        const checkWindow = setInterval(() => {
            try {
                if (sharepointWindow.location.href.includes('sharepoint.com')) {
                    console.log('📡 SharePoint caricato, tentativo di comunicazione...');
                    
                    // Prova a inviare un messaggio alla finestra
                    sharepointWindow.postMessage({
                        type: 'request-data',
                        listName: 'LOREAPP_SERVIZI'
                    }, SHAREPOINT_CONFIG.siteUrl);
                    
                    clearInterval(checkWindow);
                }
            } catch (error) {
                // Errore di accesso normale per cross-origin
            }
        }, 1000);
        
        // Smetti di controllare dopo 10 secondi
        setTimeout(() => clearInterval(checkWindow), 10000);
        
    } else {
        console.error('❌ Impossibile aprire SharePoint - popup bloccato?');
        alert('Impossibile aprire SharePoint. Verifica che i popup non siano bloccati.');
    }
}

// Esporta per uso esterno
window.ServizioManager = ServizioManager;
window.sincronizzaConSharePoint = sincronizzaConSharePoint;
window.testaConnessioneSharePoint = testaConnessioneSharePoint;
window.diagnoseSharePoint = diagnoseSharePoint;
window.apriSharePoint = apriSharePoint;
