// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::OnceLock;
use std::fs;

mod sharepoint;
use sharepoint::{SharePointClient, SharePointConfig};

use chrono::{Local, Datelike};

#[derive(Debug, Serialize, Deserialize)]
struct AppConfig {
    sharepoint: SharePointConfigSection,
    github: Option<GithubConfigSection>,
    lists: Option<ListsConfigSection>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SharePointConfigSection {
    site_url: String,
    client_id: Option<String>,
    tenant_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GithubConfigSection {
    username: Option<String>,
    repo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListsConfigSection {
    servizi_giorno: Option<String>,
    prossimi_servizi: Option<String>,
    servizi_inseriti_oggi: Option<String>,
    tessere_da_fare: Option<String>,
    tesserati: Option<String>,
    automezzi: Option<String>,
    operatori: Option<String>,
    impostazioni: Option<String>,
}

// Stato globale per il client SharePoint
// Usiamo tokio::sync::Mutex per supportare operazioni async
static SHAREPOINT_CLIENT: OnceLock<Mutex<Option<SharePointClient>>> = OnceLock::new();

// Stato per OAuth2 flow
static OAUTH_STATE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

// Configurazione globale per i nomi delle liste SharePoint
static LISTS_CONFIG: OnceLock<Mutex<Option<ListsConfigSection>>> = OnceLock::new();

// Helper per ottenere la configurazione delle liste
fn get_lists_config() -> &'static Mutex<Option<ListsConfigSection>> {
    LISTS_CONFIG.get_or_init(|| Mutex::new(None))
}

// Helper per ottenere il nome della lista per tipo
async fn get_list_name(list_type: &str) -> String {
    let lists_guard = get_lists_config().lock().await;
    if let Some(lists) = lists_guard.as_ref() {
        match list_type {
            "servizi_giorno" => lists.servizi_giorno.clone().unwrap_or_else(|| "LOREAPP_SERVIZI".to_string()),
            "prossimi_servizi" => lists.prossimi_servizi.clone().unwrap_or_else(|| "LOREAPP_SERVIZI".to_string()),
            "servizi_inseriti_oggi" => lists.servizi_inseriti_oggi.clone().unwrap_or_else(|| "LOREAPP_SERVIZI".to_string()),
            "tessere_da_fare" => lists.tessere_da_fare.clone().unwrap_or_else(|| "TessereDaFare".to_string()),
            "tesserati" => lists.tesserati.clone().unwrap_or_else(|| "LOREAPP_TESSERATI".to_string()),
            "automezzi" => lists.automezzi.clone().unwrap_or_else(|| "LOREAPP_AUTOMEZZI".to_string()),
            "operatori" => lists.operatori.clone().unwrap_or_else(|| "LOREAPP_OPERATORI".to_string()),
            "impostazioni" => lists.impostazioni.clone().unwrap_or_else(|| "LOREAPP_IMPOSTAZIONI".to_string()),
            _ => "LOREAPP_SERVIZI".to_string(),
        }
    } else {
        // Fallback ai valori di default se la config non è caricata
        match list_type {
            "servizi_giorno" => "LOREAPP_SERVIZI".to_string(),
            "prossimi_servizi" => "LOREAPP_SERVIZI".to_string(),
            "servizi_inseriti_oggi" => "LOREAPP_SERVIZI".to_string(),
            "tessere_da_fare" => "TessereDaFare".to_string(),
            "tesserati" => "LOREAPP_TESSERATI".to_string(),
            "automezzi" => "LOREAPP_AUTOMEZZI".to_string(),
            "operatori" => "LOREAPP_OPERATORI".to_string(),
            "impostazioni" => "LOREAPP_IMPOSTAZIONI".to_string(),
            _ => "LOREAPP_SERVIZI".to_string(),
        }
    }
}

// Helper per ottenere il client lock
fn get_sharepoint_client() -> &'static Mutex<Option<SharePointClient>> {
    SHAREPOINT_CLIENT.get_or_init(|| Mutex::new(None))
}

// Helper per ottenere l'oauth state lock
fn get_oauth_state() -> &'static Mutex<Option<String>> {
    OAUTH_STATE.get_or_init(|| Mutex::new(None))
}

// Comando per verificare se l'utente è autenticato
#[tauri::command]
async fn check_authentication() -> Result<bool, String> {
    let client_guard = get_sharepoint_client().lock().await;
    
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Controllo autenticazione: client presente, is_authenticated = {}", is_auth);
        return Ok(is_auth);
    }
    
    println!("Controllo autenticazione: client SharePoint non presente");
    Ok(false)
}

#[derive(Debug, Serialize, Deserialize)]
struct Servizio {
    id: u32,
    operatore: String,
    data: String,
    nominativo: String,
    ora_sotto_casa: String,
    ora_destinazione: String,
    tipo_servizio: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ServizioCompleto {
    id: String,
    data_prelievo: String,
    idsocio: String,
    socio_trasportato: String,
    ora_inizio: String,
    comune_prelievo: String,
    luogo_prelievo: String,
    tipo_servizio: String,
    carrozzina: String,
    richiedente: String,
    motivazione: String,
    ora_arrivo: String,
    comune_destinazione: String,
    luogo_destinazione: String,
    pagamento: String,
    stato_incasso: String,
    operatore: String,
    operatore_2: String,
    mezzo_usato: String,
    tempo: String,
    km: String,
    tipo_pagamento: String,
    data_bonifico: String,
    data_ricevuta: String,
    stato_servizio: String,
    note_prelievo: String,
    note_arrivo: String,
    note_fine_servizio: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tessera {
    id: u32,
    descrizione: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tesserato {
    id: u32, // ID interno SharePoint
    idsocio: String,
    nominativo: String,
    codicefiscale: String,
    numerotessera: String,
    scadenzatessera: String,
    telefono: String,
    tipologiasocio: String,
    operatore: String,
    attivo: String,
    disponibilita: String,
    notaaggiuntiva: String,
}

// Comando per ottenere servizi del giorno
#[tauri::command]
async fn get_servizi_giorno() -> Result<Vec<Servizio>, String> {
    println!("=== get_servizi_giorno chiamato ===");
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return get_servizi_giorno_fallback();
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return get_servizi_giorno_fallback();
        }
    }
    
    // Prepara il filtro per la data corrente (tutta la giornata)
    // Proviamo a usare un filtro con Microsoft Graph API per recuperare solo gli elementi con DATA_PRELIEVO >= oggi
    // Se il filtro non funziona (campo non indicizzato), recupereremo tutti gli elementi e filtriamo manualmente
    let oggi = Local::now().format("%Y-%m-%d").to_string();
    let oggi_inizio = format!("{}T00:00:00Z", oggi);
    
    println!("Data oggi: {}", oggi);
    println!("Tentativo di usare filtro DATA_PRELIEVO >= {}", oggi_inizio);
    
    // Costruisci il filtro per Microsoft Graph API
    // NOTA: DATA_PRELIEVO potrebbe non essere indicizzato, quindi il filtro potrebbe fallire
    // In quel caso, recupereremo tutti gli elementi e filtriamo manualmente
    let filter = format!("fields/DATA_PRELIEVO ge {}", oggi_inizio);
    
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config
        let list_name = get_list_name("servizi_giorno").await;
        println!("📋 Usando lista: {}", list_name);
        println!("Tentativo di recuperare servizi da SharePoint con filtro...");
        // Proviamo prima con il filtro, se fallisce recuperiamo tutti gli elementi
        let items_result = client.get_list_items(&list_name, Some(&filter)).await;
        
        // Se il filtro fallisce (errore 400), proviamo senza filtro
        let items = match items_result {
            Ok(items) => {
                println!("✓ Filtro applicato con successo, recuperati {} elementi", items.len());
                items
            }
            Err(e) => {
                println!("⚠️ Filtro fallito (probabilmente campo non indicizzato): {}", e);
                println!("Recupero tutti gli elementi senza filtro...");
                match client.get_list_items(&list_name, None).await {
                    Ok(all_items) => {
                        println!("✓ Recuperati {} elementi totali (senza filtro)", all_items.len());
                        all_items
                    }
                    Err(e2) => {
                        eprintln!("✗ Errore anche senza filtro: {}", e2);
                        return Err(format!("Errore nel recupero elementi: {} (filtro: {})", e2, e));
                    }
                }
            }
        };
        
        println!("✓ Ricevuti {} elementi da SharePoint", items.len());
        
        // Converti in Servizio e filtra per data corrente
        // La data viene formattata in formato italiano "dd/mm/yyyy"
        let now = Local::now();
        let oggi_italiano = format!("{:02}/{:02}/{}", 
            now.day(),
            now.month(),
            now.year()
        );
        println!("Data oggi (formato italiano): {}", oggi_italiano);
        
        // Log dei primi 5 elementi per vedere come sono formattate le date
        println!("Primi 5 elementi ricevuti:");
        for (i, item) in items.iter().take(5).enumerate() {
            if let Ok(servizio) = serde_json::from_value::<Servizio>(item.clone()) {
                println!("  [{}] ID: {}, Data: '{}', Operatore: {}", 
                    i, servizio.id, servizio.data, servizio.operatore);
            } else {
                println!("  [{}] Errore nel parsing: {:?}", i, item);
            }
        }
        
        // Cerca specificamente l'elemento con ID 64
        println!("🔍 Ricerca elemento con ID 64...");
        let mut trovato_64 = false;
        for item in items.iter() {
            // Log dettagliato del raw item per vedere id_interno e IDSERVIZIO
            let mut id_interno_64 = false;
            if let Some(id_raw) = item.get("id") {
                // Controlla se l'id interno è 64
                if let Some(id_str) = id_raw.as_str() {
                    if id_str == "64" || id_str.parse::<u32>().ok() == Some(64) {
                        id_interno_64 = true;
                    }
                } else if let Some(id_num) = id_raw.as_number().and_then(|n| n.as_u64()) {
                    if id_num == 64 {
                        id_interno_64 = true;
                    }
                }
                
                if id_interno_64 {
                    println!("  🔍 TROVATO elemento con id interno 64 (raw):");
                    println!("    id interno (raw): {:?}", id_raw);
                    if let Some(fields) = item.get("fields") {
                        if let Some(idservizio) = fields.get("IDSERVIZIO") {
                            println!("    IDSERVIZIO (raw): {:?}", idservizio);
                        } else {
                            println!("    IDSERVIZIO: NON PRESENTE");
                        }
                        // Log anche altri campi rilevanti
                        if let Some(oper) = fields.get("OPER") {
                            println!("    OPER (raw): {:?}", oper);
                        }
                        if let Some(data_prelievo) = fields.get("DATA_PRELIEVO") {
                            println!("    DATA_PRELIEVO (raw): {:?}", data_prelievo);
                        }
                    }
                    println!("    Raw item completo: {}", serde_json::to_string(item).unwrap_or_else(|_| "errore serializzazione".to_string()));
                }
            }
            
            if let Ok(servizio) = serde_json::from_value::<Servizio>(item.clone()) {
                if servizio.id == 64 {
                    trovato_64 = true;
                    println!("  ✓ TROVATO elemento con ID 64 (dopo mapping)!");
                    println!("    Data: '{}', Operatore: '{}'", servizio.data, servizio.operatore);
                    println!("    Confronto con oggi: '{}' vs '{}' -> {}", 
                        servizio.data, oggi_italiano, servizio.data == oggi_italiano);
                }
            }
        }
        if !trovato_64 {
            println!("  ✗ Elemento con ID 64 NON trovato nei {} elementi recuperati", items.len());
        }
        
        // Cerca tutti gli elementi con data 28/12/2025
        println!("🔍 Ricerca elementi con data 28/12/2025...");
        let mut elementi_28_12 = 0;
        for item in items.iter() {
            if let Ok(servizio) = serde_json::from_value::<Servizio>(item.clone()) {
                if servizio.data == "28/12/2025" {
                    elementi_28_12 += 1;
                    if elementi_28_12 <= 5 {
                        println!("  [{}] ID: {}, Data: '{}', Operatore: {}", 
                            elementi_28_12, servizio.id, servizio.data, servizio.operatore);
                    }
                }
            }
        }
        println!("  Totale elementi con data 28/12/2025: {}", elementi_28_12);
        
        let mut elementi_parsing_fallito = 0;
        let mut elementi_totali_parsati = 0;
        let mut servizi_trovati = 0;
        let servizi: Vec<Servizio> = items
            .iter()
            .filter_map(|item| {
                elementi_totali_parsati += 1;
                match serde_json::from_value::<Servizio>(item.clone()) {
                    Ok(servizio) => {
                        // Filtra per data corrente (solo oggi)
                        // La data è in formato "dd/mm/yyyy"
                        let corrisponde = servizio.data == oggi_italiano;
                        if servizi_trovati < 3 {
                            println!("Confronto [{}]: servizio.data='{}' vs oggi_italiano='{}' -> {}", 
                                servizio.id, servizio.data, oggi_italiano, corrisponde);
                        }
                        if corrisponde {
                            servizi_trovati += 1;
                            if servizi_trovati <= 3 {
                                println!("  ✓ Servizio {} corrisponde alla data di oggi!", servizio.id);
                            }
                            Some(servizio)
                        } else {
                            None
                        }
                    }
                    Err(e) => {
                        elementi_parsing_fallito += 1;
                        if elementi_parsing_fallito <= 5 {
                            eprintln!("Errore nel parsing elemento {}: {} - {:?}", elementi_totali_parsati, e, item);
                        }
                        None
                    }
                }
            })
            .collect();
        
        if elementi_parsing_fallito > 0 {
            println!("⚠️ Totale elementi con errore di parsing: {} su {}", elementi_parsing_fallito, items.len());
        }
        println!("✓ Convertiti e filtrati {} servizi per la data {} (su {} elementi parsati)", 
            servizi.len(), oggi_italiano, elementi_totali_parsati - elementi_parsing_fallito);
        Ok(servizi)
    } else {
        println!("⚠️ Client non disponibile dopo il lock");
        get_servizi_giorno_fallback()
    }
}

fn get_servizi_giorno_fallback() -> Result<Vec<Servizio>, String> {
    Ok(vec![
        Servizio {
            id: 1146,
            operatore: "GAGLIARDI DESIDERATO".to_string(),
            data: "23/12/2025".to_string(),
            nominativo: "GALUPPO ANGELO".to_string(),
            ora_sotto_casa: "08:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST".to_string(),
        },
        Servizio {
            id: 1140,
            operatore: "ARNONE ANTONINO".to_string(),
            data: "23/12/2025".to_string(),
            nominativo: "GROSSO GRAZIELLA".to_string(),
            ora_sotto_casa: "10:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "Trasporto Via Scotti".to_string(),
        },
        Servizio {
            id: 1132,
            operatore: "PASCARIELLO GIUSEPPE".to_string(),
            data: "23/12/2025".to_string(),
            nominativo: "CAMILLERI MARIANNA".to_string(),
            ora_sotto_casa: "14:45".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO GENERICO".to_string(),
        },
    ])
}

// Comando per ottenere prossimi servizi
#[tauri::command]
async fn get_prossimi_servizi() -> Result<Vec<Servizio>, String> {
    println!("=== get_prossimi_servizi chiamato ===");
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return get_prossimi_servizi_fallback();
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return get_prossimi_servizi_fallback();
        }
    }
    
    // Calcola domani (oggi + 1 giorno)
    let oggi = Local::now();
    let domani = oggi + chrono::Duration::days(1);
    let domani_str = domani.format("%Y-%m-%d").to_string();
    let domani_inizio = format!("{}T00:00:00Z", domani_str);
    
    println!("Data oggi: {}", oggi.format("%Y-%m-%d"));
    println!("Data domani: {}", domani_str);
    println!("Tentativo di usare filtro DATA_PRELIEVO >= {}", domani_inizio);
    
    // Costruisci il filtro per Microsoft Graph API (domani e successivi)
    let filter = format!("fields/DATA_PRELIEVO ge {}", domani_inizio);
    
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config
        let list_name = get_list_name("prossimi_servizi").await;
        println!("📋 Usando lista: {}", list_name);
        println!("Tentativo di recuperare prossimi servizi da SharePoint con filtro...");
        // Proviamo prima con il filtro, se fallisce recuperiamo tutti gli elementi
        let items_result = client.get_list_items(&list_name, Some(&filter)).await;
        
        // Se il filtro fallisce (errore 400), proviamo senza filtro e filtriamo lato client
        let items = match items_result {
            Ok(items) => {
                println!("✓ Filtro applicato con successo, recuperati {} elementi", items.len());
                items
            }
            Err(e) => {
                println!("⚠️ Filtro fallito (probabilmente campo non indicizzato): {}", e);
                println!("Recupero tutti gli elementi senza filtro e filtro lato client...");
                match client.get_list_items(&list_name, None).await {
                    Ok(all_items) => {
                        println!("✓ Recuperati {} elementi totali (senza filtro)", all_items.len());
                        all_items
                    }
                    Err(e2) => {
                        eprintln!("✗ Errore anche senza filtro: {}", e2);
                        return Err(format!("Errore nel recupero elementi: {} (filtro: {})", e2, e));
                    }
                }
            }
        };
        
        println!("✓ Ricevuti {} elementi da SharePoint", items.len());
        
        // Converti in Servizio e filtra per data domani e successivi
        let domani_italiano = format!("{:02}/{:02}/{}", 
            domani.day(),
            domani.month(),
            domani.year()
        );
        println!("Data domani (formato italiano): {}", domani_italiano);
        
        // Parse della data domani per il confronto
        let domani_naive = chrono::NaiveDate::from_ymd_opt(
            domani.year(),
            domani.month(),
            domani.day()
        ).unwrap();
        
        let servizi: Vec<Servizio> = items
            .iter()
            .filter_map(|item| {
                match serde_json::from_value::<Servizio>(item.clone()) {
                    Ok(servizio) => {
                        // Parse della data del servizio (formato dd/mm/yyyy)
                        let parse_date = |date_str: &str| -> Option<chrono::NaiveDate> {
                            if date_str.is_empty() {
                                return None;
                            }
                            chrono::NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()
                        };
                        
                        if let Some(servizio_date) = parse_date(&servizio.data) {
                            // Include solo servizi con data >= domani
                            if servizio_date >= domani_naive {
                                Some(servizio)
                            } else {
                                None
                            }
                        } else {
                            // Se non riesce a parsare la data, escludi l'elemento
                            None
                        }
                    }
                    Err(_) => None,
                }
            })
            .collect();
        
        println!("✓ Convertiti e filtrati {} servizi per data >= {} (domani e successivi)", 
            servizi.len(), domani_italiano);
        Ok(servizi)
    } else {
        println!("⚠️ Client non disponibile dopo il lock");
        get_prossimi_servizi_fallback()
    }
}

fn get_prossimi_servizi_fallback() -> Result<Vec<Servizio>, String> {
    Ok(vec![
        Servizio {
            id: 1153,
            operatore: "GUAZZINI LUCA".to_string(),
            data: "24/12/2025".to_string(),
            nominativo: "BESTENTE ANNA VINCENZA".to_string(),
            ora_sotto_casa: "09:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "Commissioni varie".to_string(),
        },
        Servizio {
            id: 1099,
            operatore: "CONTI MARZIA".to_string(),
            data: "24/12/2025".to_string(),
            nominativo: "RESCE MARIA GIUSEPPINA".to_string(),
            ora_sotto_casa: "09:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST".to_string(),
        },
        Servizio {
            id: 1157,
            operatore: "PASCARIELLO GIUSEPPE".to_string(),
            data: "24/12/2025".to_string(),
            nominativo: "CHIRONE FILIPPO".to_string(),
            ora_sotto_casa: "10:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO IN OSPEDALE CON MEZZO ATTREZ".to_string(),
        },
    ])
}

// Comando per ottenere servizi inseriti oggi
#[tauri::command]
async fn get_servizi_inseriti_oggi() -> Result<Vec<Servizio>, String> {
    let oggi = Local::now().format("%Y-%m-%d").to_string();
    let filter = format!("Created ge datetime'{}T00:00:00Z'", oggi);
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config
        let list_name = get_list_name("servizi_inseriti_oggi").await;
        println!("📋 Usando lista: {}", list_name);
        // Proviamo prima con il filtro, se fallisce recuperiamo tutti gli elementi
        let items_result = client.get_list_items(&list_name, Some(&filter)).await;
        
        // Se il filtro fallisce (errore 400), proviamo senza filtro e filtriamo lato client
        let items = match items_result {
            Ok(items) => {
                println!("✓ Filtro createdDateTime applicato con successo, recuperati {} elementi", items.len());
                items
            }
            Err(e) => {
                println!("⚠️ Filtro createdDateTime fallito (probabilmente non supportato): {}", e);
                println!("Recupero tutti gli elementi senza filtro e filtro lato client...");
                match client.get_list_items(&list_name, None).await {
                    Ok(all_items) => {
                        println!("✓ Recuperati {} elementi totali (senza filtro)", all_items.len());
                        // Filtra lato client per createdDateTime >= oggi
                        let oggi_start = format!("{}T00:00:00Z", oggi);
                        let filtered: Vec<serde_json::Value> = all_items
                            .iter()
                            .filter_map(|item| {
                                // Cerca createdDateTime nell'oggetto (potrebbe essere a livello root o in fields)
                                let created_str = item.get("createdDateTime")
                                    .or_else(|| item.get("fields").and_then(|f| f.get("createdDateTime")))
                                    .and_then(|v| v.as_str());
                                
                                if let Some(created) = created_str {
                                    // Confronta le date (formato ISO 8601)
                                    if created >= oggi_start.as_str() {
                                        Some(item.clone())
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            })
                            .collect();
                        println!("✓ Filtrati {} elementi con createdDateTime >= {}", filtered.len(), oggi_start);
                        filtered
                    }
                    Err(e2) => {
                        eprintln!("✗ Errore anche senza filtro: {}", e2);
                        return Err(format!("Errore nel recupero elementi: {} (filtro: {})", e2, e));
                    }
                }
            }
        };
        
        let servizi: Vec<Servizio> = items
            .iter()
            .filter_map(|item| {
                serde_json::from_value(item.clone()).ok()
            })
            .collect();
        Ok(servizi)
    } else {
        get_servizi_inseriti_oggi_fallback()
    }
}

fn get_servizi_inseriti_oggi_fallback() -> Result<Vec<Servizio>, String> {
    Ok(vec![
        Servizio {
            id: 1159,
            operatore: "FRANCO FRANCESCO".to_string(),
            data: "30/12/2025".to_string(),
            nominativo: "BOTTARO UGO".to_string(),
            ora_sotto_casa: "09:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST".to_string(),
        },
        Servizio {
            id: 1157,
            operatore: "PASCARIELLO GIUSEPPE".to_string(),
            data: "24/12/2025".to_string(),
            nominativo: "CHIRONE FILIPPO".to_string(),
            ora_sotto_casa: "10:30".to_string(),
            ora_destinazione: "".to_string(),
            tipo_servizio: "TRASPORTO IN OSPEDALE CON MEZZO ATTREZ".to_string(),
        },
    ])
}

// Comando per ottenere tessere da fare
#[tauri::command]
async fn get_tessere_da_fare() -> Result<Vec<Tessera>, String> {
    println!("=== get_tessere_da_fare chiamato ===");
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return Ok(vec![
            Tessera {
                id: 712,
                descrizione: "LA VECCHIA (in carico all'ANTE".to_string(),
            },
        ]);
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return Ok(vec![
                Tessera {
                    id: 712,
                    descrizione: "LA VECCHIA (in carico all'ANTE".to_string(),
                },
            ]);
        }
    }
    
    // Costruisci il filtro per TIPOLOGIASOCIO = "NUOVO" o "ESTERNO"
    // Sintassi OData per Microsoft Graph API
    let filter = "fields/TIPOLOGIASOCIO eq 'NUOVO' or fields/TIPOLOGIASOCIO eq 'ESTERNO'";
    
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config (lista "tesserati")
        let list_name = get_list_name("tesserati").await;
        println!("📋 Usando lista: {}", list_name);
        
        // USA get_list_items_raw per ottenere i dati raw con "fields", non get_list_items che converte in formato Servizio
        // Prova prima con il filtro, se fallisce recuperiamo tutti gli elementi e filtriamo manualmente
        let items_result = client.get_list_items_raw(&list_name, Some(filter)).await;
        
        let items = match items_result {
            Ok(items) => {
                println!("✓ Filtro applicato con successo, recuperati {} elementi", items.len());
                items
            }
            Err(e) => {
                println!("⚠️ Filtro fallito, recupero tutti gli elementi: {}", e);
                match client.get_list_items_raw(&list_name, None).await {
                    Ok(all_items) => {
                        println!("✓ Recuperati {} elementi totali (senza filtro)", all_items.len());
                        all_items
                    }
                    Err(e2) => {
                        eprintln!("✗ Errore nel recupero elementi: {}", e2);
                        return Err(format!("Errore nel recupero elementi: {}", e2));
                    }
                }
            }
        };
        
        println!("✓ Ricevuti {} elementi da SharePoint dalla lista {}", items.len(), list_name);
        
        if items.is_empty() {
            println!("⚠️ Nessun elemento recuperato dalla lista {}", list_name);
            return Ok(vec![]);
        }
        
        // Converti in Tessera e filtra per TIPOLOGIASOCIO
        let mut tessere = Vec::new();
        
        for item in items.iter() {
            // Estrai l'id interno di SharePoint
            let id = if let Some(id_val) = item.get("id") {
                if let Some(id_str) = id_val.as_str() {
                    id_str.parse::<u32>().ok().unwrap_or(0)
                } else if let Some(id_num) = id_val.as_u64() {
                    id_num as u32
                } else {
                    0
                }
            } else {
                continue;
            };
            
            if let Some(fields) = item.get("fields") {
                // Helper per estrarre il valore di un campo
                let get_field_value = |field_name: &str| -> String {
                    if let Some(val) = fields.get(field_name) {
                        if let Some(s) = val.as_str() {
                            return s.to_string();
                        }
                        if val.is_null() {
                            return String::new();
                        }
                        // Gestisci oggetti annidati (es. {value: "..."})
                        if let Some(obj) = val.as_object() {
                            if let Some(value) = obj.get("value") {
                                if let Some(s) = value.as_str() {
                                    return s.to_string();
                                }
                            }
                        }
                        val.to_string()
                    } else {
                        String::new()
                    }
                };
                
                // Estrai TIPOLOGIASOCIO e filtra
                let tipologia_value = get_field_value("TIPOLOGIASOCIO");
                let tipologia_clean = tipologia_value.trim().to_uppercase();
                if tipologia_clean != "NUOVO" && tipologia_clean != "ESTERNO" {
                    continue;
                }
                
                // Costruisci la descrizione: prova Nominativo_SOCIO (dall'immagine), poi COGNOME NOME, altrimenti altri campi
                let nominativo_socio = get_field_value("Nominativo_SOCIO");
                let nominativo_socio_alt = get_field_value("NOMINATIVO_SOCIO");
                let cognome = get_field_value("COGNOME");
                let nome = get_field_value("NOME");
                
                let descrizione = if !nominativo_socio.is_empty() {
                    nominativo_socio
                } else if !nominativo_socio_alt.is_empty() {
                    nominativo_socio_alt
                } else if !cognome.is_empty() && !nome.is_empty() {
                    format!("{} {}", cognome, nome)
                } else if !cognome.is_empty() {
                    cognome
                } else if !nome.is_empty() {
                    nome
                } else {
                    // Prova altri campi comuni
                    let desc = get_field_value("DESCRIZIONE");
                    if !desc.is_empty() {
                        desc
                    } else {
                        get_field_value("TITOLO")
                    }
                };
                
                if descrizione.is_empty() {
                    // Se non abbiamo una descrizione, saltiamo questo elemento
                    continue;
                }
                
                tessere.push(Tessera {
                    id,
                    descrizione,
                });
            }
        }
        
        println!("✓ Convertiti {} elementi in Tessera (su {} totali recuperati)", tessere.len(), items.len());
        
        if tessere.is_empty() {
            println!("⚠️ Nessuna tessera trovata con TIPOLOGIASOCIO='NUOVO' o 'ESTERNO'");
            return Ok(vec![]);
        }
        
        Ok(tessere)
    } else {
        Err("Client SharePoint non disponibile".to_string())
    }
}

// Comando per ottenere tutti i tesserati
#[tauri::command]
async fn get_all_tesserati() -> Result<Vec<Tesserato>, String> {
    println!("=== get_all_tesserati chiamato ===");
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return Ok(vec![]);
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return Ok(vec![]);
        }
    }
    
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config (lista "tesserati")
        let list_name = get_list_name("tesserati").await;
        println!("📋 Usando lista: {}", list_name);
        
        // Recupera tutti gli elementi senza filtro
        let items_result = client.get_list_items_raw(&list_name, None).await;
        
        let items = match items_result {
            Ok(items) => {
                println!("✓ Recuperati {} elementi dalla lista {}", items.len(), list_name);
                items
            }
            Err(e) => {
                eprintln!("✗ Errore nel recupero elementi: {}", e);
                return Err(format!("Errore nel recupero elementi: {}", e));
            }
        };
        
        if items.is_empty() {
            println!("⚠️ Nessun elemento recuperato dalla lista {}", list_name);
            return Ok(vec![]);
        }
        
        // Converti in Tesserato
        let mut tesserati = Vec::new();
        
        // Log i campi del primo elemento per debug (solo una volta)
        let mut fields_logged = false;
        
        // Contatori per statistiche operatori
        let mut operatore_count = 0u32;
        let mut operatore_total = 0u32;
        
        for item in items.iter() {
            // Estrai l'id interno di SharePoint
            let id = if let Some(id_val) = item.get("id") {
                if let Some(id_str) = id_val.as_str() {
                    id_str.parse::<u32>().ok().unwrap_or(0)
                } else if let Some(id_num) = id_val.as_u64() {
                    id_num as u32
                } else {
                    0
                }
            } else {
                continue;
            };
            
            if let Some(fields) = item.get("fields") {
                // Helper per estrarre il valore di un campo
                let get_field_value = |field_name: &str| -> String {
                    if let Some(val) = fields.get(field_name) {
                        if let Some(s) = val.as_str() {
                            return s.to_string();
                        }
                        if val.is_null() {
                            return String::new();
                        }
                        // Gestisci array (campi di scelta multipla)
                        if let Some(arr) = val.as_array() {
                            let values: Vec<String> = arr.iter()
                                .filter_map(|v| {
                                    // Ogni elemento dell'array può essere una stringa o un oggetto con "value"
                                    if let Some(s) = v.as_str() {
                                        Some(s.to_string())
                                    } else if let Some(obj) = v.as_object() {
                                        if let Some(value) = obj.get("value") {
                                            value.as_str().map(|s| s.to_string())
                                        } else if let Some(lookup_value) = obj.get("LookupValue") {
                                            lookup_value.as_str().map(|s| s.to_string())
                                        } else {
                                            None
                                        }
                                    } else {
                                        None
                                    }
                                })
                                .collect();
                            if !values.is_empty() {
                                return values.join(" - ");
                            }
                            return String::new();
                        }
                        // Gestisci oggetti annidati (es. {value: "..."} o {value: [...]})
                        if let Some(obj) = val.as_object() {
                            // Prova prima con "value" (può essere un array)
                            if let Some(value) = obj.get("value") {
                                if let Some(arr) = value.as_array() {
                                    // È un array dentro un oggetto
                                    let values: Vec<String> = arr.iter()
                                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                        .collect();
                                    if !values.is_empty() {
                                        return values.join(" - ");
                                    }
                                } else if let Some(s) = value.as_str() {
                                    return s.to_string();
                                }
                            }
                            // Prova con "LookupValue" (per campi lookup multipli)
                            if let Some(lookup_value) = obj.get("LookupValue") {
                                if let Some(s) = lookup_value.as_str() {
                                    return s.to_string();
                                }
                            }
                        }
                        val.to_string()
                    } else {
                        String::new()
                    }
                };
                
                // Estrai tutti i campi richiesti
                // Prova varianti del nome per IDSOCIO
                let idsocio_val = get_field_value("IDSOCIO");
                let idsocio = if !idsocio_val.is_empty() {
                    idsocio_val
                } else {
                    // Prova varie combinazioni di nomi
                    let variants = vec![
                        "ID_SOCIO", "IdSocio", "idSocio", "Id_Socio", "IDSOCIO",
                        "SocioID", "SOCIO_ID", "Socio_Id", "socioId",
                        "ID", "Id", "Title" // Alcuni potrebbero usare Title o ID generico
                    ];
                    
                    let mut found_value = String::new();
                    let mut found_key = String::new();
                    
                    for variant in variants {
                        let val = get_field_value(variant);
                        if !val.is_empty() && (found_value.is_empty() || variant == "IDSOCIO" || variant == "ID_SOCIO") {
                            found_value = val;
                            found_key = variant.to_string();
                            break; // Usa il primo trovato
                        }
                    }
                    
                    if !found_value.is_empty() {
                        // Solo log una volta ogni 10 elementi per non intasare i log
                        if id % 10 == 0 {
                            println!("✓ IDSOCIO trovato come '{}': '{}' (ID interno: {})", found_key, found_value, id);
                        }
                        found_value
                            } else {
                                // Log i campi disponibili solo per il primo elemento se non ancora fatto
                                if !fields_logged {
                                    if let Some(fields_obj) = fields.as_object() {
                                        let mut all_keys: Vec<&String> = fields_obj.keys().collect();
                                        all_keys.sort();
                                        println!("⚠️ IDSOCIO non trovato nel primo elemento. Tutti i campi disponibili ({}): {:?}", all_keys.len(), all_keys);
                                        // Cerca campi che contengono "SOCIO", "ID", o numeri
                                        let matching_keys: Vec<&String> = all_keys.iter()
                                            .filter(|k| {
                                                let k_upper = k.to_uppercase();
                                                k_upper.contains("SOCIO") || 
                                                k_upper.contains("ID") || 
                                                (k_upper.len() <= 10 && k.chars().any(|c| c.is_numeric()))
                                            })
                                            .cloned()
                                            .collect();
                                        if !matching_keys.is_empty() {
                                            println!("  → Campi che potrebbero essere IDSOCIO: {:?}", matching_keys);
                                        }
                                    }
                                    fields_logged = true;
                                }
                                // Usa l'ID interno di SharePoint come IDSOCIO se il campo non esiste
                                id.to_string()
                            }
                };
                let nominativo_socio = get_field_value("Nominativo_SOCIO");
                let nominativo_socio_alt = get_field_value("NOMINATIVO_SOCIO");
                let cognome = get_field_value("COGNOME");
                let nome = get_field_value("NOME");
                
                // Costruisci il nominativo (prova Nominativo_SOCIO, poi COGNOME NOME)
                let nominativo = if !nominativo_socio.is_empty() {
                    nominativo_socio
                } else if !nominativo_socio_alt.is_empty() {
                    nominativo_socio_alt
                } else if !cognome.is_empty() && !nome.is_empty() {
                    format!("{} {}", cognome, nome)
                } else if !cognome.is_empty() {
                    cognome
                } else if !nome.is_empty() {
                    nome
                } else {
                    String::new()
                };
                
                // Estrai Codice Fiscale (prova varianti)
                // IMPORTANTE: "Codice Fiscale" con spazio è il nome corretto in SharePoint
                // SharePoint usa spesso il nome interno con spazio codificato come "Codice_x0020_Fiscale"
                let codicefiscale_variants = vec![
                    "Codice Fiscale",  // Nome visualizzato in SharePoint (con spazio)
                    "Codice_x0020_Fiscale",  // Nome interno SharePoint (spazio codificato)
                    "Codice_x0020_fiscale",
                    "CODICE FISCALE", 
                    "CODICE_X0020_FISCALE",
                    "CodiceFiscale",  // Senza spazio
                    "CODICE_FISCALE", 
                    "Codice_Fiscale",
                    "Codice fiscale",
                    "CF", "cf", "Cf", "C_F", "c_f",
                    "FISCALECODE", "FiscaleCode", "fiscaleCode",
                    "CODICEFISCALE", "codicefiscale"
                ];
                
                let mut codicefiscale_final = String::new();
                let mut codicefiscale_found_key = String::new();
                
                for variant in codicefiscale_variants {
                    let val = get_field_value(variant);
                    if !val.is_empty() {
                        codicefiscale_final = val;
                        codicefiscale_found_key = variant.to_string();
                        break;
                    }
                }
                
                // Log per debug (solo per il primo elemento se non ancora fatto)
                if !fields_logged {
                    if !codicefiscale_final.is_empty() {
                        println!("✓ Codice Fiscale trovato come '{}': '{}' (ID interno: {})", codicefiscale_found_key, codicefiscale_final, id);
                    } else {
                        // Log TUTTI i campi disponibili per capire qual è il nome corretto
                        if let Some(fields_obj) = fields.as_object() {
                            let mut all_keys: Vec<&String> = fields_obj.keys().collect();
                            all_keys.sort();
                            println!("⚠️ Codice Fiscale non trovato (ID interno: {}). TUTTI i campi disponibili ({}):", id, all_keys.len());
                            for key in &all_keys {
                                if let Some(val) = fields_obj.get(*key) {
                                    let val_str = if let Some(s) = val.as_str() {
                                        format!("'{}'", s)
                                    } else if val.is_null() {
                                        "null".to_string()
                                    } else if val.is_array() {
                                        format!("[array di {} elementi]", val.as_array().map(|a| a.len()).unwrap_or(0))
                                    } else {
                                        format!("{:?}", val)
                                    };
                                    println!("  - {}: {}", key, val_str.chars().take(100).collect::<String>());
                                }
                            }
                            // Cerca campi che contengono "FISCALE", "CF", "CODICE"
                            let matching_keys: Vec<&String> = all_keys.iter()
                                .filter(|k| {
                                    let k_upper = k.to_uppercase();
                                    k_upper.contains("FISCALE") || 
                                    k_upper.contains("CF") || 
                                    k_upper.contains("CODICE")
                                })
                                .cloned()
                                .collect();
                            if !matching_keys.is_empty() {
                                println!("  → Campi che potrebbero essere Codice Fiscale: {:?}", matching_keys);
                            }
                        }
                    }
                    fields_logged = true;
                }
                
                let numerotessera = get_field_value("NUMEROTESSERA");
                let scadenzatessera = get_field_value("SCADENZATESSERA");
                let telefono = get_field_value("TELEFONO");
                let tipologiasocio = get_field_value("TIPOLOGIASOCIO");
                
                // Prova varianti per OPERATORE
                // NOTA: In SharePoint, un campo checkbox/boolean viene restituito come "true" o "false" (stringa)
                // anche se visualizzato come "SI"/"NO" nell'interfaccia
                let operatore = get_field_value("OPERATORE");
                let operatore_final = if !operatore.is_empty() {
                    operatore
                } else {
                    // Prova altre varianti
                    let alt_op = get_field_value("Operatore");
                    if !alt_op.is_empty() {
                        alt_op
                    } else {
                        get_field_value("operatore")
                    }
                };
                
                // Se il campo è vuoto, potrebbe essere un campo boolean che non è ancora stato impostato
                // In quel caso restituisce null o empty string
                
                // Prova varianti per ATTIVO
                let attivo = get_field_value("ATTIVO");
                let attivo_final = if !attivo.is_empty() {
                    attivo
                } else {
                    // Prova altre varianti
                    let alt_att = get_field_value("Attivo");
                    if !alt_att.is_empty() {
                        alt_att
                    } else {
                        let alt_att2 = get_field_value("attivo");
                        if !alt_att2.is_empty() {
                            alt_att2
                        } else {
                            get_field_value("STATO") // Alcuni usano STATO invece di ATTIVO
                        }
                    }
                };
                
                // Log e statistiche per debug OPERATORE
                operatore_total += 1;
                let op_upper = operatore_final.trim().to_uppercase();
                let is_operatore = op_upper == "TRUE" || op_upper == "SI" || op_upper == "SÌ" || 
                                  op_upper == "S" || op_upper == "1" || op_upper == "YES" || op_upper == "Y";
                
                if is_operatore {
                    operatore_count += 1;
                    if operatore_count <= 3 {
                        println!("✓ OPERATORE TROVATO - ID {}: OPERATORE='{}' (trovati finora: {}/{})", 
                            id, operatore_final, operatore_count, operatore_total);
                    }
                }
                
                // Log dettagliato per i primi 10 elementi
                if id <= 10 {
                    println!("🔍 DEBUG elemento ID {}: OPERATORE='{}' (tipo: str, lunghezza: {}, isOperatore: {}), ATTIVO='{}'", 
                        id, operatore_final, operatore_final.len(), is_operatore, attivo_final);
                }
                
                let disponibilita = get_field_value("DISPONIBILITA");
                let notaaggiuntiva = get_field_value("NOTAAGGIUNTIVA");
                
                tesserati.push(Tesserato {
                    id,
                    idsocio,
                    nominativo,
                    codicefiscale: codicefiscale_final,
                    numerotessera,
                    scadenzatessera,
                    telefono,
                    tipologiasocio,
                    operatore: operatore_final,
                    attivo: attivo_final,
                    disponibilita,
                    notaaggiuntiva,
                });
            }
        }
        
        println!("✓ Convertiti {} elementi in Tesserato (su {} totali recuperati)", tesserati.len(), items.len());
        println!("📊 STATISTICHE OPERATORI: Trovati {}/{} tesserati con operatore = true/si", operatore_count, operatore_total);
        
        // Log di tutti i valori unici del campo operatore per capire cosa c'è
        use std::collections::HashSet;
        let mut valori_operatore: HashSet<String> = HashSet::new();
        for tesserato in &tesserati {
            if !tesserato.operatore.trim().is_empty() {
                valori_operatore.insert(tesserato.operatore.trim().to_uppercase());
            }
        }
        println!("📋 Valori unici del campo OPERATORE trovati: {:?}", valori_operatore);
        
        if operatore_count == 0 {
            println!("⚠️ ATTENZIONE: Nessun operatore trovato! Verifica i valori del campo OPERATORE in SharePoint.");
        } else if operatore_count != 2 {
            println!("⚠️ ATTENZIONE: Trovati {} operatori invece di 2.", operatore_count);
            println!("   Nota: Se il campo OPERATORE è una checkbox in SharePoint, i valori 'true'/'false' sono normali.");
            println!("   Verifica in SharePoint quali record hanno effettivamente la checkbox OPERATORE selezionata.");
        }
        
        Ok(tesserati)
    } else {
        Err("Client SharePoint non disponibile".to_string())
    }
}

// Comando per ottenere un servizio completo per ID
#[tauri::command]
async fn get_servizio_completo(servizio_id: u32) -> Result<ServizioCompleto, String> {
    println!("=== get_servizio_completo chiamato per ID: {} ===", servizio_id);
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return get_servizio_completo_fallback(servizio_id);
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return get_servizio_completo_fallback(servizio_id);
        }
    }
    
    if let Some(client) = client_guard.as_mut() {
        // Usa la stessa lista dei servizi del giorno
        let list_name = get_list_name("servizi_giorno").await;
        println!("📋 Usando lista: {}", list_name);
        
        // Recupera tutti gli elementi (filtriamo lato client per ID)
        let items_result = client.get_list_items(&list_name, None).await;
        
        let items = match items_result {
            Ok(items) => items,
            Err(e) => {
                println!("⚠️ Errore nel recupero elementi: {}", e);
                return get_servizio_completo_fallback(servizio_id);
            }
        };
        
        // Cerca l'elemento con IDSERVIZIO corrispondente
        for item in items.iter() {
            if let Some(fields) = item.get("fields") {
                let get_field_value = |field_name: &str| -> String {
                    if let Some(val) = fields.get(field_name) {
                        if let Some(s) = val.as_str() {
                            return s.to_string();
                        }
                        if let Some(n) = val.as_number() {
                            return n.to_string();
                        }
                        if val.is_null() {
                            return String::new();
                        }
                        // Gestisci oggetti annidati (es. {value: "..."})
                        if let Some(obj) = val.as_object() {
                            if let Some(value) = obj.get("value") {
                                if let Some(s) = value.as_str() {
                                    return s.to_string();
                                }
                                if let Some(n) = value.as_number() {
                                    return n.to_string();
                                }
                            }
                        }
                        val.to_string()
                    } else {
                        String::new()
                    }
                };
                
                // Estrai IDSERVIZIO
                let id = if let Some(idservizio_val) = fields.get("IDSERVIZIO") {
                    if let Some(n) = idservizio_val.as_number() {
                        n.as_u64().unwrap_or(0) as u32
                    } else if let Some(s) = idservizio_val.as_str() {
                        s.parse::<u32>().ok().unwrap_or(0)
                    } else {
                        0
                    }
                } else {
                    continue;
                };
                
                if id == servizio_id {
                    // Trovato! Converti in ServizioCompleto
                    let data_prelievo_val = fields.get("DATA_PRELIEVO");
                    let data_prelievo_raw = if let Some(val) = data_prelievo_val {
                        if let Some(s) = val.as_str() {
                            s.to_string()
                        } else if let Some(obj) = val.as_object() {
                            if let Some(value) = obj.get("value") {
                                if let Some(s) = value.as_str() {
                                    s.to_string()
                                } else {
                                    value.to_string()
                                }
                            } else {
                                serde_json::to_string(val).unwrap_or_else(|_| String::new())
                            }
                        } else {
                            val.to_string()
                        }
                    } else {
                        String::new()
                    };
                    let data_formattata = format_date_sharepoint_rust(&data_prelievo_raw);
                    
                    // Formatta DATABONIFICO e DATARICEVUTA
                    let data_bonifico_raw = get_field_value("DATABONIFICO");
                    let data_bonifico_formattata = format_date_sharepoint_rust(&data_bonifico_raw);
                    let data_ricevuta_raw = get_field_value("DATARICEVUTA");
                    let data_ricevuta_formattata = format_date_sharepoint_rust(&data_ricevuta_raw);
                    
                    return Ok(ServizioCompleto {
                        id: id.to_string(),
                        data_prelievo: data_formattata,
                        idsocio: get_field_value("IDSOCIO"),
                        socio_trasportato: get_field_value("TRASP"),
                        ora_inizio: get_field_value("ORA_PRELIEVO"),
                        comune_prelievo: get_field_value("COMUNE_PRELIEVO"),
                        luogo_prelievo: get_field_value("INDIRIZZO_PRELIEVO"),
                        tipo_servizio: get_field_value("TIPO_SERVIZIO"),
                        carrozzina: get_field_value("CARROZZINA"),
                        richiedente: get_field_value("RICHIEDENTE"),
                        motivazione: get_field_value("MOTIVAZIONE"),
                        ora_arrivo: get_field_value("ORA_DESTINAZIONE"),
                        comune_destinazione: get_field_value("COMUNE_DESTINAZIONE"),
                        luogo_destinazione: get_field_value("INDIRIZZO_DESTINAZIONE"),
                        pagamento: get_field_value("PAGAMENTO"),
                        stato_incasso: get_field_value("STATO_INCASSO"),
                        operatore: get_field_value("OPER"),
                        operatore_2: get_field_value("OPER2"),
                        mezzo_usato: get_field_value("MEZZO_USATO"),
                        tempo: get_field_value("TEMPO"),
                        km: get_field_value("KM"),
                        tipo_pagamento: get_field_value("TIPOPAGAMENTO"),
                        data_bonifico: data_bonifico_formattata, // Usa DATABONIFICO
                        data_ricevuta: data_ricevuta_formattata, // Usa DATARICEVUTA
                        stato_servizio: get_field_value("STATOSERVIZIO"), // Corretto: STATOSERVIZIO senza underscore
                        note_prelievo: get_field_value("PRELIEVO_NOTE"),
                        note_arrivo: get_field_value("note_destinazione"),
                        note_fine_servizio: get_field_value("NOTE_FINE_SERVIZIO"),
                    });
                }
            }
        }
        
        println!("⚠️ Servizio con ID {} non trovato", servizio_id);
        get_servizio_completo_fallback(servizio_id)
    } else {
        get_servizio_completo_fallback(servizio_id)
    }
}

fn get_servizio_completo_fallback(id: u32) -> Result<ServizioCompleto, String> {
    Ok(ServizioCompleto {
        id: id.to_string(),
        data_prelievo: "02/09/2025".to_string(),
        idsocio: "12345".to_string(),
        socio_trasportato: "ASTUTI GUIDO".to_string(),
        ora_inizio: "08:00".to_string(),
        comune_prelievo: "ROMA".to_string(),
        luogo_prelievo: "VIA ROMA 123".to_string(),
        tipo_servizio: "STANDARD".to_string(),
        carrozzina: "".to_string(),
        richiedente: "SOCIO".to_string(),
        motivazione: "Visita medica".to_string(),
        ora_arrivo: "09:30".to_string(),
        comune_destinazione: "ROMA".to_string(),
        luogo_destinazione: "OSPEDALE SANTO SPIRITO".to_string(),
        pagamento: "0,00 €".to_string(),
        stato_incasso: "DA INCASSARE".to_string(),
        operatore: "ANDREAZZA MARIA".to_string(),
        operatore_2: "".to_string(),
        mezzo_usato: "FIAT PANDA (3)".to_string(),
        tempo: "0".to_string(),
        km: "15".to_string(),
        tipo_pagamento: "CONTANTI".to_string(),
        data_bonifico: "".to_string(),
        data_ricevuta: "".to_string(),
        stato_servizio: "ESEGUITO".to_string(),
        note_prelievo: "".to_string(),
        note_arrivo: "".to_string(),
        note_fine_servizio: "".to_string(),
    })
}

// Comando per ottenere tutti i servizi completi ordinati per data e ora decrescente
#[tauri::command]
async fn get_all_servizi_completi() -> Result<Vec<ServizioCompleto>, String> {
    println!("=== get_all_servizi_completi chiamato ===");
    
    let mut client_guard = get_sharepoint_client().lock().await;
    
    if client_guard.is_none() {
        println!("⚠️ Client SharePoint non presente, uso dati di esempio");
        return get_all_servizi_completi_fallback();
    }
    
    // Verifica autenticazione
    if let Some(client) = client_guard.as_ref() {
        let is_auth = client.is_authenticated();
        println!("Stato autenticazione: {}", is_auth);
        if !is_auth {
            println!("⚠️ Client non autenticato, uso dati di esempio");
            return get_all_servizi_completi_fallback();
        }
    }
    
    if let Some(client) = client_guard.as_mut() {
        let list_name = get_list_name("servizi_giorno").await;
        println!("📋 Usando lista: {}", list_name);
        
        // Recupera tutti gli elementi raw (senza filtro) per avere accesso ai fields
        let items_result = client.get_list_items_raw(&list_name, None).await;
        
        let items = match items_result {
            Ok(items) => items,
            Err(e) => {
                println!("⚠️ Errore nel recupero elementi: {}", e);
                return get_all_servizi_completi_fallback();
            }
        };
        
        println!("✓ Recuperati {} elementi da SharePoint", items.len());
        
        // Log del primo elemento per debug
        if !items.is_empty() {
            println!("🔍 DEBUG - Primo elemento (primi 500 caratteri): {}", 
                serde_json::to_string(&items[0]).unwrap_or_default().chars().take(500).collect::<String>());
            println!("🔍 DEBUG - Chiavi del primo elemento: {:?}", 
                items[0].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
            if let Some(fields) = items[0].get("fields") {
                println!("🔍 DEBUG - Fields presente nel primo elemento");
                if let Some(fields_obj) = fields.as_object() {
                    println!("🔍 DEBUG - Chiavi nei fields del primo elemento: {:?}", 
                        fields_obj.keys().take(20).cloned().collect::<Vec<_>>());
                    // Controlla IDSERVIZIO e Title
                    if let Some(idservizio) = fields_obj.get("IDSERVIZIO") {
                        println!("🔍 DEBUG - IDSERVIZIO trovato: {:?}", idservizio);
                    } else {
                        println!("🔍 DEBUG - IDSERVIZIO NON trovato nei fields");
                    }
                    if let Some(title) = fields_obj.get("Title") {
                        println!("🔍 DEBUG - Title trovato: {:?}", title);
                    } else {
                        println!("🔍 DEBUG - Title NON trovato nei fields");
                    }
                }
            } else {
                println!("🔍 DEBUG - Fields NON presente nel primo elemento");
            }
        }
        
        // Converti tutti gli elementi in ServizioCompleto
        let mut servizi: Vec<ServizioCompleto> = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                if let Some(fields) = item.get("fields") {
                    let get_field_value = |field_name: &str| -> String {
                        if let Some(val) = fields.get(field_name) {
                            if let Some(s) = val.as_str() {
                                return s.to_string();
                            }
                            if let Some(n) = val.as_number() {
                                return n.to_string();
                            }
                            if val.is_null() {
                                return String::new();
                            }
                            if let Some(obj) = val.as_object() {
                                if let Some(value) = obj.get("value") {
                                    if let Some(s) = value.as_str() {
                                        return s.to_string();
                                    }
                                    if let Some(n) = value.as_number() {
                                        return n.to_string();
                                    }
                                }
                            }
                            val.to_string()
                        } else {
                            String::new()
                        }
                    };
                    
                    // Log dei nomi dei campi per il primo elemento (debug)
                    if index == 0 {
                        println!("🔍 DEBUG - Chiavi disponibili nei fields (primo elemento):");
                        if let Some(fields_obj) = fields.as_object() {
                            let mut keys: Vec<&String> = fields_obj.keys().collect();
                            keys.sort();
                            for key in keys.iter().take(80) {
                                println!("  - {}", key);
                            }
                            // Cerca specificamente STATO_SERVIZIO, stato_servizio, statoservizio, etc.
                            for pattern in &["STATO_SERVIZIO", "statoservizio", "STATOSERVIZIO", "StatoServizio", "stato_servizio", "STATO_Servizio"] {
                                if fields_obj.contains_key(*pattern) {
                                    println!("  ✓ Trovato campo per stato servizio: {} = {:?}", pattern, fields_obj.get(*pattern));
                                }
                            }
                            for pattern in &["DATA_BONIFICO", "databonifico", "DATABONIFICO", "DataBonifico", "data_bonifico", "DATA_Bonifico"] {
                                if fields_obj.contains_key(*pattern) {
                                    println!("  ✓ Trovato campo per data bonifico: {} = {:?}", pattern, fields_obj.get(*pattern));
                                }
                            }
                        }
                    }
                    
                    // Estrai IDSERVIZIO
                    let id = if let Some(idservizio_val) = fields.get("IDSERVIZIO") {
                        if let Some(n) = idservizio_val.as_number() {
                            n.as_u64().unwrap_or(0) as u32
                        } else if let Some(s) = idservizio_val.as_str() {
                            s.parse::<u32>().ok().unwrap_or(0)
                        } else {
                            0
                        }
                    } else {
                        // IDSERVIZIO non presente - prova a usare Title come fallback
                        if let Some(title_val) = fields.get("Title") {
                            if let Some(title_str) = title_val.as_str() {
                                title_str.parse::<u32>().ok().unwrap_or(0)
                            } else if let Some(title_num) = title_val.as_number() {
                                title_num.as_u64().unwrap_or(0) as u32
                            } else {
                                0
                            }
                        } else {
                            0
                        }
                    };
                    
                    if id == 0 {
                        // Log per debug quando l'ID è 0
                        println!("⚠️ Elemento senza ID valido (IDSERVIZIO/Title non valido): {:?}", 
                            fields.get("IDSERVIZIO").or_else(|| fields.get("Title")));
                        return None; // ID non valido, salta questo elemento
                    }
                    
                    let data_prelievo_val = fields.get("DATA_PRELIEVO");
                    let data_prelievo_raw = if let Some(val) = data_prelievo_val {
                        if let Some(s) = val.as_str() {
                            s.to_string()
                        } else if let Some(obj) = val.as_object() {
                            if let Some(value) = obj.get("value") {
                                if let Some(s) = value.as_str() {
                                    s.to_string()
                                } else {
                                    value.to_string()
                                }
                            } else {
                                serde_json::to_string(val).unwrap_or_else(|_| String::new())
                            }
                        } else {
                            val.to_string()
                        }
                    } else {
                        String::new()
                    };
                    let data_formattata = format_date_sharepoint_rust(&data_prelievo_raw);
                    
                    // Formatta DATABONIFICO e DATARICEVUTA
                    let data_bonifico_raw = get_field_value("DATABONIFICO");
                    let data_bonifico_formattata = format_date_sharepoint_rust(&data_bonifico_raw);
                    let data_ricevuta_raw = get_field_value("DATARICEVUTA");
                    let data_ricevuta_formattata = format_date_sharepoint_rust(&data_ricevuta_raw);
                    
                    Some(ServizioCompleto {
                        id: id.to_string(),
                        data_prelievo: data_formattata,
                        idsocio: get_field_value("IDSOCIO"),
                        socio_trasportato: get_field_value("TRASP"),
                        ora_inizio: get_field_value("ORA_PRELIEVO"),
                        comune_prelievo: get_field_value("COMUNE_PRELIEVO"),
                        luogo_prelievo: get_field_value("INDIRIZZO_PRELIEVO"),
                        tipo_servizio: get_field_value("TIPO_SERVIZIO"),
                        carrozzina: get_field_value("CARROZZINA"),
                        richiedente: get_field_value("RICHIEDENTE"),
                        motivazione: get_field_value("MOTIVAZIONE"),
                        ora_arrivo: get_field_value("ORA_DESTINAZIONE"),
                        comune_destinazione: get_field_value("COMUNE_DESTINAZIONE"),
                        luogo_destinazione: get_field_value("INDIRIZZO_DESTINAZIONE"),
                        pagamento: get_field_value("PAGAMENTO"),
                        stato_incasso: get_field_value("STATO_INCASSO"),
                        operatore: get_field_value("OPER"),
                        operatore_2: get_field_value("OPER2"),
                        mezzo_usato: get_field_value("MEZZO_USATO"),
                        tempo: get_field_value("TEMPO"),
                        km: get_field_value("KM"),
                        tipo_pagamento: get_field_value("TIPOPAGAMENTO"),
                        data_bonifico: data_bonifico_formattata, // Usa DATABONIFICO
                        data_ricevuta: data_ricevuta_formattata, // Usa DATARICEVUTA
                        stato_servizio: get_field_value("STATOSERVIZIO"), // Corretto: STATOSERVIZIO senza underscore
                        note_prelievo: get_field_value("PRELIEVO_NOTE"),
                        note_arrivo: get_field_value("note_destinazione"),
                        note_fine_servizio: get_field_value("NOTE_FINE_SERVIZIO"),
                    })
                } else {
                    None
                }
            })
            .collect();
        
        println!("✓ Convertiti {} servizi", servizi.len());
        
        if servizi.is_empty() {
            println!("⚠️ Nessun servizio convertito, uso fallback");
            return get_all_servizi_completi_fallback();
        }
        
        // Ordina per data decrescente e poi per ora decrescente
        servizi.sort_by(|a, b| {
            use chrono::NaiveDate;
            use chrono::NaiveTime;
            
            // Parse date (formato dd/mm/yyyy)
            let parse_date = |date_str: &str| -> Option<NaiveDate> {
                if date_str.is_empty() {
                    return None;
                }
                NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()
            };
            
            // Parse time (formato HH:MM o HH:MM:SS)
            let parse_time = |time_str: &str| -> Option<NaiveTime> {
                if time_str.is_empty() {
                    return None;
                }
                NaiveTime::parse_from_str(time_str, "%H:%M").ok()
                    .or_else(|| NaiveTime::parse_from_str(time_str, "%H:%M:%S").ok())
            };
            
            let date_a = parse_date(&a.data_prelievo);
            let date_b = parse_date(&b.data_prelievo);
            
            // Prima ordina per data (decrescente)
            match (date_a, date_b) {
                (Some(da), Some(db)) => {
                    match db.cmp(&da) {
                        std::cmp::Ordering::Equal => {
                            // Se le date sono uguali, ordina per ora (decrescente)
                            let time_a = parse_time(&a.ora_inizio);
                            let time_b = parse_time(&b.ora_inizio);
                            match (time_a, time_b) {
                                (Some(ta), Some(tb)) => tb.cmp(&ta),
                                (Some(_), None) => std::cmp::Ordering::Less,
                                (None, Some(_)) => std::cmp::Ordering::Greater,
                                (None, None) => std::cmp::Ordering::Equal,
                            }
                        }
                        other => other,
                    }
                }
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
        
        println!("✓ Servizi ordinati per data e ora decrescente");
        Ok(servizi)
    } else {
        get_all_servizi_completi_fallback()
    }
}

fn get_all_servizi_completi_fallback() -> Result<Vec<ServizioCompleto>, String> {
    Ok(vec![
        ServizioCompleto {
            id: "159".to_string(),
            data_prelievo: "02/09/2025".to_string(),
            idsocio: "12345".to_string(),
            socio_trasportato: "ASTUTI GUIDO".to_string(),
            ora_inizio: "08:00".to_string(),
            comune_prelievo: "ROMA".to_string(),
            luogo_prelievo: "VIA ROMA 123".to_string(),
            tipo_servizio: "STANDARD".to_string(),
            carrozzina: "".to_string(),
            richiedente: "SOCIO".to_string(),
            motivazione: "Visita medica".to_string(),
            ora_arrivo: "09:30".to_string(),
            comune_destinazione: "ROMA".to_string(),
            luogo_destinazione: "OSPEDALE SANTO SPIRITO".to_string(),
            pagamento: "0,00 €".to_string(),
            stato_incasso: "DA INCASSARE".to_string(),
            operatore: "ANDREAZZA MARIA".to_string(),
            operatore_2: "".to_string(),
            mezzo_usato: "FIAT PANDA (3)".to_string(),
            tempo: "0".to_string(),
            km: "15".to_string(),
            tipo_pagamento: "CONTANTI".to_string(),
            data_bonifico: "".to_string(),
            data_ricevuta: "".to_string(),
            stato_servizio: "ESEGUITO".to_string(),
            note_prelievo: "".to_string(),
            note_arrivo: "".to_string(),
            note_fine_servizio: "".to_string(),
        },
    ])
}

// Helper per formattare la data (versione Rust)
fn format_date_sharepoint_rust(date_str: &str) -> String {
    if date_str.is_empty() {
        return String::new();
    }
    
    // Prova a parsare come ISO 8601 (RFC3339)
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(date_str) {
        let local_time = parsed.with_timezone(&Local);
        return local_time.format("%d/%m/%Y").to_string();
    }
    
    // Prova formato ISO senza timezone
    if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S") {
        return parsed.format("%d/%m/%Y").to_string();
    }
    
    // Prova formato YYYY-MM-DD
    if let Ok(parsed) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return parsed.format("%d/%m/%Y").to_string();
    }
    
    // Se già in formato con /, restituisci così com'è
    if date_str.contains('/') {
        return date_str.to_string();
    }
    
    date_str.to_string()
}

// Comando per stampare servizio
#[tauri::command]
async fn stampa_servizio(id: u32) -> Result<(), String> {
    println!("Stampa servizio {}", id);
    // TODO: Implementare logica di stampa
    Ok(())
}

// Comando per modificare servizio
#[tauri::command]
async fn modifica_servizio(id: u32) -> Result<(), String> {
    println!("Modifica servizio {}", id);
    // TODO: Implementare logica di modifica
    Ok(())
}

// Comando per completare servizio
#[tauri::command]
async fn completa_servizio(id: u32) -> Result<(), String> {
    println!("Completa servizio {}", id);
    // TODO: Implementare logica di completamento e aggiornamento SharePoint
    Ok(())
}

// Comando per nuova tessera
#[tauri::command]
async fn nuova_tessera(id: u32) -> Result<(), String> {
    println!("Nuova tessera {}", id);
    // TODO: Implementare logica di creazione tessera
    Ok(())
}

// Comando per aprire tessera
#[tauri::command]
async fn apri_tessera(id: u32) -> Result<(), String> {
    println!("Apri tessera {}", id);
    // TODO: Implementare logica di apertura tessera
    Ok(())
}

// Comando per autenticazione SharePoint
#[tauri::command]
async fn authenticate_sharepoint(
    username: String,
    password: String,
    sharepoint_url: String,
) -> Result<serde_json::Value, String> {
    println!("Autenticazione SharePoint per {}", username);
    
    // Per ora usiamo un token di esempio
    // In produzione, implementare OAuth2 flow con Microsoft Identity Platform
    // o usare SharePoint REST API con autenticazione di base
    
    let token = "example_token".to_string();
    
    // Crea il client SharePoint
    let config = SharePointConfig {
        site_url: sharepoint_url.clone(),
        access_token: Some(token.clone()),
        refresh_token: None,
        expires_at: None,
        tenant_id: None,
        client_id: None,
        client_secret: None,
    };
    
    let client = SharePointClient::new(config);
    
    // Salva il client nello stato globale
    {
        let mut client_guard = get_sharepoint_client().lock().await;
        *client_guard = Some(client);
    }
    
    Ok(serde_json::json!({
        "success": true,
        "token": token
    }))
}

// Comando per salvare credenziali e configurare SharePoint
#[tauri::command]
async fn save_credentials(sharepoint_url: String, token: String) -> Result<(), String> {
    println!("Salvataggio credenziali per {}", sharepoint_url);
    
    let config = SharePointConfig {
        site_url: sharepoint_url,
        access_token: Some(token),
        refresh_token: None,
        expires_at: None,
        tenant_id: None,
        client_id: None,
        client_secret: None,
    };
    
    let client = SharePointClient::new(config);
    
    // Salva il client nello stato globale
    {
        let mut client_guard = get_sharepoint_client().lock().await;
        *client_guard = Some(client);
    }
    
    Ok(())
}

// Comando per aggiornare un servizio su SharePoint
#[tauri::command]
async fn update_servizio_sharepoint(
    id: u32,
    operatore: Option<String>,
    data: Option<String>,
    nominativo: Option<String>,
    ora_sotto_casa: Option<String>,
    ora_destinazione: Option<String>,
    tipo_servizio: Option<String>,
) -> Result<(), String> {
    // Prepara i dati prima di acquisire il lock
    let mut data_map = HashMap::new();
    
    if let Some(op) = operatore {
        data_map.insert("operatore".to_string(), serde_json::json!(op));
    }
    if let Some(d) = data {
        data_map.insert("data".to_string(), serde_json::json!(d));
    }
    if let Some(nom) = nominativo {
        data_map.insert("nominativo".to_string(), serde_json::json!(nom));
    }
    if let Some(ora_sc) = ora_sotto_casa {
        data_map.insert("ora_sotto_casa".to_string(), serde_json::json!(ora_sc));
    }
    if let Some(ora_dest) = ora_destinazione {
        data_map.insert("ora_destinazione".to_string(), serde_json::json!(ora_dest));
    }
    if let Some(tipo) = tipo_servizio {
        data_map.insert("tipo_servizio".to_string(), serde_json::json!(tipo));
    }
    
    // Acquisisci il lock, verifica che il client esista, poi rilascia il lock prima di await
    let has_client = {
        let client_guard = get_sharepoint_client().lock().await;
        client_guard.is_some()
    };
    
    if !has_client {
        return Err("Client SharePoint non configurato".to_string());
    }
    
    // Acquisisci di nuovo il lock per l'operazione async
    let mut client_guard = get_sharepoint_client().lock().await;
    if let Some(client) = client_guard.as_mut() {
        // Ottieni il nome della lista dal config (usa servizi_giorno come default per gli aggiornamenti)
        let list_name = get_list_name("servizi_giorno").await;
        println!("📋 Aggiornamento servizio - Usando lista: {}", list_name);
        client
            .update_list_item(&list_name, id, &data_map)
            .await
    } else {
        Err("Client SharePoint non configurato".to_string())
    }
}

// Comando per caricare configurazione da file
#[tauri::command]
async fn load_config_file() -> Result<serde_json::Value, String> {
    use std::path::PathBuf;
    
    // Prova diversi path possibili per config.json
    let mut possible_paths = vec![
        PathBuf::from("config.json"),  // Nella directory corrente
        PathBuf::from("../config.json"),  // Una directory sopra (se siamo in src-tauri)
    ];
    
    // Aggiungi anche il path assoluto basato sulla directory corrente
    if let Ok(current_dir) = std::env::current_dir() {
        // Se siamo in src-tauri, vai alla root
        let root_path = if current_dir.ends_with("src-tauri") {
            current_dir.parent().map(|p| p.join("config.json"))
        } else {
            Some(current_dir.join("config.json"))
        };
        
        if let Some(path) = root_path {
            possible_paths.push(path);
        }
    }
    
    let mut last_error = None;
    println!("Tentativo di caricare config.json. Directory corrente: {:?}", std::env::current_dir());
    
    for config_path in &possible_paths {
        println!("Tentativo path: {:?}", config_path);
        match fs::read_to_string(config_path) {
            Ok(contents) => {
                println!("✓ config.json trovato in: {:?}", config_path);
                let config: AppConfig = serde_json::from_str(&contents)
                    .map_err(|e| format!("Errore nel parsing config.json: {}", e))?;
            
                return Ok(serde_json::json!({
                    "sharepoint": {
                        "site_url": config.sharepoint.site_url,
                        "client_id": config.sharepoint.client_id,
                        "tenant_id": config.sharepoint.tenant_id,
                        "client_secret": config.sharepoint.client_secret
                    },
                    "github": config.github,
                    "lists": config.lists
                }));
            }
            Err(e) => {
                println!("✗ Errore nel path {:?}: {}", config_path, e);
                last_error = Some(format!("Errore nella lettura {:?}: {}", config_path, e));
                continue; // Prova il prossimo path
            }
        }
    }
    
    // Se nessun path ha funzionato, restituisci l'ultimo errore
    Err(last_error.unwrap_or_else(|| "config.json non trovato in nessuna posizione".to_string()))
}

// Comando per inizializzare client SharePoint da configurazione
#[tauri::command]
async fn init_sharepoint_from_config() -> Result<(), String> {
    use std::path::PathBuf;
    
    // Prova diversi path possibili per config.json
    let mut possible_paths = vec![
        PathBuf::from("config.json"),
        PathBuf::from("../config.json"),
    ];
    
    // Aggiungi anche il path assoluto basato sulla directory corrente
    if let Ok(current_dir) = std::env::current_dir() {
        // Se siamo in src-tauri, vai alla root
        let root_path = if current_dir.ends_with("src-tauri") {
            current_dir.parent().map(|p| p.join("config.json"))
        } else {
            Some(current_dir.join("config.json"))
        };
        
        if let Some(path) = root_path {
            possible_paths.push(path);
        }
    }
    
    let mut last_error = None;
    println!("Tentativo di inizializzare SharePoint da config.json. Directory corrente: {:?}", std::env::current_dir());
    
    for config_path in &possible_paths {
        println!("Tentativo path: {:?}", config_path);
        match fs::read_to_string(config_path) {
            Ok(contents) => {
                println!("✓ config.json trovato in: {:?}", config_path);
                let config: AppConfig = serde_json::from_str(&contents)
                    .map_err(|e| format!("Errore nel parsing config.json: {}", e))?;
            
                // Controlla se esiste già un client autenticato
                let mut client_guard = get_sharepoint_client().lock().await;
                
                // Se il client esiste ed è autenticato, preservalo e aggiorna solo la configurazione base
                if let Some(existing_client) = client_guard.as_ref() {
                    if existing_client.is_authenticated() {
                        println!("✓ Client SharePoint già autenticato, preservo il token esistente");
                        // Aggiorna solo i campi di configurazione senza perdere il token
                        let mut updated_config = existing_client.config.clone();
                        updated_config.site_url = config.sharepoint.site_url.clone();
                        if updated_config.tenant_id.is_none() {
                            updated_config.tenant_id = config.sharepoint.tenant_id.clone();
                        }
                        if updated_config.client_id.is_none() {
                            updated_config.client_id = config.sharepoint.client_id.clone();
                        }
                        if updated_config.client_secret.is_none() {
                        updated_config.client_secret = config.sharepoint.client_secret.clone();
                    }
                    *client_guard = Some(SharePointClient::new(updated_config));
                    
                    // Aggiorna anche la configurazione delle liste
                    if let Some(lists) = config.lists {
                        let mut lists_guard = get_lists_config().lock().await;
                        *lists_guard = Some(lists);
                        println!("✓ Configurazione liste aggiornata");
                    }
                    
                    println!("✓ Configurazione aggiornata preservando l'autenticazione");
                    return Ok(());
                    }
                }
                
                // Se non c'è un client autenticato, crea un nuovo client
                let sharepoint_config = SharePointConfig {
                    site_url: config.sharepoint.site_url,
                    access_token: None,
                    refresh_token: None,
                    expires_at: None,
                    tenant_id: config.sharepoint.tenant_id,
                    client_id: config.sharepoint.client_id,
                    client_secret: config.sharepoint.client_secret,
                };
                
                let client = SharePointClient::new(sharepoint_config);
                *client_guard = Some(client);
                
                // Salva anche la configurazione delle liste
                if let Some(lists) = config.lists {
                    let mut lists_guard = get_lists_config().lock().await;
                    *lists_guard = Some(lists);
                    println!("✓ Configurazione liste salvata");
                }
                
                println!("✓ Client SharePoint inizializzato con successo");
                return Ok(());
            }
            Err(e) => {
                println!("✗ Errore nel path {:?}: {}", config_path, e);
                last_error = Some(format!("Errore nella lettura {:?}: {}", config_path, e));
                continue; // Prova il prossimo path
            }
        }
    }
    
    // Se nessun path ha funzionato, restituisci l'ultimo errore
    Err(last_error.unwrap_or_else(|| "config.json non trovato in nessuna posizione. Il client SharePoint non sarà inizializzato.".to_string()))
}

// Comando per ottenere URL di autorizzazione OAuth2
#[tauri::command]
async fn get_oauth_authorization_url(
    tenant_id: String,
    client_id: String,
    sharepoint_url: String,
    redirect_uri: String,
) -> Result<String, String> {
    use rand::Rng;
    
    // Genera uno state random per sicurezza
    let state: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    
    // Salva lo state
    {
        let mut state_guard = get_oauth_state().lock().await;
        *state_guard = Some(state.clone());
    }
    
    // Crea configurazione temporanea per generare l'URL
    let config = SharePointConfig {
        site_url: sharepoint_url,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        tenant_id: Some(tenant_id),
        client_id: Some(client_id),
        client_secret: None,
    };
    
    let client = SharePointClient::new(config);
    let auth_url = client.get_authorization_url(&redirect_uri, &state)?;
    
    Ok(auth_url)
}

// Comando per completare autenticazione OAuth2 con authorization code
#[tauri::command]
async fn complete_oauth_authentication(
    code: String,
    tenant_id: String,
    client_id: String,
    client_secret: String,
    sharepoint_url: String,
    redirect_uri: String,
) -> Result<serde_json::Value, String> {
    let mut config = SharePointConfig {
        site_url: sharepoint_url.clone(),
        access_token: None,
        refresh_token: None,
        expires_at: None,
        tenant_id: Some(tenant_id),
        client_id: Some(client_id),
        client_secret: Some(client_secret),
    };
    
    let mut client = SharePointClient::new(config);
    
    // Ottieni il token usando il codice di autorizzazione
    client.get_token_from_code(&code, &redirect_uri).await?;
    
    // Salva la configurazione aggiornata
    let config = SharePointConfig {
        site_url: sharepoint_url,
        access_token: client.config.access_token.clone(),
        refresh_token: client.config.refresh_token.clone(),
        expires_at: client.config.expires_at,
        tenant_id: client.config.tenant_id.clone(),
        client_id: client.config.client_id.clone(),
        client_secret: client.config.client_secret.clone(),
    };
    
    // Salva il client nello stato globale
    {
        let mut client_guard = get_sharepoint_client().lock().await;
        *client_guard = Some(SharePointClient::new(config.clone()));
    }
    
    Ok(serde_json::json!({
        "success": true,
        "access_token": config.access_token.unwrap_or_default(),
        "expires_at": config.expires_at.map(|d| d.to_rfc3339()).unwrap_or_default()
    }))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_servizi_giorno,
            get_prossimi_servizi,
            get_servizi_inseriti_oggi,
            get_tessere_da_fare,
            get_all_tesserati,
            get_servizio_completo,
            get_all_servizi_completi,
            stampa_servizio,
            modifica_servizio,
            completa_servizio,
            nuova_tessera,
            apri_tessera,
            authenticate_sharepoint,
            save_credentials,
            update_servizio_sharepoint,
            get_oauth_authorization_url,
            complete_oauth_authentication,
            load_config_file,
            init_sharepoint_from_config,
            check_authentication
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


