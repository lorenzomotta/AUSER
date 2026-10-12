// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::OnceLock;
use std::fs;

mod sharepoint;
mod supabase;
use sharepoint::{SharePointClient, SharePointConfig};
use supabase::{
    SupabaseClient, SupabaseConfig, SupabaseTablesConfig, format_date_iso, format_time_iso,
    get_bool_field, get_field, json_to_string,
};

use chrono::{Local, Datelike};

#[derive(Debug, Serialize, Deserialize)]
struct AppConfig {
    sharepoint: SharePointConfigSection,
    supabase: Option<SupabaseConfigSection>,
    github: Option<GithubConfigSection>,
    lists: Option<ListsConfigSection>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SupabaseConfigSection {
    url: String,
    /// Chiave anon legacy (eyJ...) — può essere invalida se ruotate le JWT Signing Keys
    anon_key: String,
    /// Consigliata: chiave da Supabase → Settings → API Keys → Publishable (sb_publishable_...)
    publishable_key: Option<String>,
    /// Solo app desktop Tauri (backend Rust): Secret key (sb_secret_...) o service_role JWT
    /// config.json è in .gitignore — NON condividere questa chiave
    secret_key: Option<String>,
    /// Compatibilità: singola tabella tesserati (sostituita da tables.tesserati)
    #[serde(alias = "table_soci")]
    table_tesserati: Option<String>,
    tables: Option<SupabaseTablesConfigSection>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SupabaseTablesConfigSection {
    tesserati: Option<String>,
    servizi: Option<String>,
    automezzi: Option<String>,
    dotazioni_mezzi: Option<String>,
    impostazioni: Option<String>,
    motivazioni_trasporto: Option<String>,
    motorizzazioni: Option<String>,
    richiedenti: Option<String>,
    stato_del_servizio: Option<String>,
    telefoni: Option<String>,
    email: Option<String>,
    tipo_pagamenti: Option<String>,
    tipo_socio: Option<String>,
    tipologia_socio: Option<String>,
    tratte: Option<String>,
    user_permissions: Option<String>,
    /// Storico annuale: tabella dedicata (Tesseramenti_supa), più righe per IdSocio
    #[serde(default)]
    tesseramenti: Option<String>,
    #[serde(default)]
    mansioni: Option<String>,
    /// Appunti personali (agenda) per utente
    #[serde(default)]
    appunti: Option<String>,
    #[serde(default)]
    appunti_destinatari: Option<String>,
    #[serde(default)]
    appunti_risposte: Option<String>,
    /// Legacy: non esiste tabella operatori — filtrare tesserati.Operatore
    #[serde(alias = "operatori")]
    operatori: Option<String>,
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

// Stato globale per il client Supabase (tabella tesserati_supa)
static SUPABASE_CLIENT: OnceLock<Mutex<Option<SupabaseClient>>> = OnceLock::new();

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

fn get_supabase_client() -> &'static Mutex<Option<SupabaseClient>> {
    SUPABASE_CLIENT.get_or_init(|| Mutex::new(None))
}

/// Converte una riga Supabase (tabella Tesserati) nel struct Tesserato del frontend
fn supabase_row_to_tesserato(row: &serde_json::Value) -> Option<Tesserato> {
    let id = row
        .get("id")
        .and_then(|v| {
            v.as_u64()
                .map(|n| n as u32)
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or_else(|| {
            get_field(row, "IdSocio")
                .parse::<u32>()
                .unwrap_or(0)
        });

    let nominativo = get_field_any(
        row,
        &[
            "NominativoSocio",
            "NOMINATIVOSOCIO",
            "Nominativo",
            "NOMINATIVO",
            "nominativo_socio",
        ],
    );
    if id == 0 && nominativo.is_empty() {
        return None;
    }

    let tesseramento_anno = get_field(row, "Tesseramento_Anno");
    let scadenzatessera = if !tesseramento_anno.is_empty() {
        format!("31/12/{}", tesseramento_anno)
    } else {
        format_date_iso(&get_field(row, "Tesseramento_Data"))
    };

    let (nascita_comune, nascita_data) = get_nascita_fields(row);
    let (residenza_indirizzo, residenza_civico, residenza_cap, residenza_comune, residenza_provincia) =
        get_residenza_fields(row);

    Some(Tesserato {
        id,
        idsocio: get_field(row, "IdSocio"),
        nominativo,
        codicefiscale: get_field(row, "CodiceFiscale"),
        numerotessera: get_field(row, "Tesseramento_Numero"),
        scadenzatessera,
        telefono: get_field_any(row, &["Telefono", "TELEFONO", "telefono"]),
        tipologiasocio: get_field(row, "TipologiaSocio"),
        operatore: get_bool_field(row, &["Operatore", "OPERATORE", "operatore"]),
        attivo: get_bool_field(row, &["Attivo", "ATTIVO", "attivo"]),
        archivia: get_bool_field(
            row,
            &[
                "Archiviato",
                "ARCHIVIATO",
                "archiviato",
                "Archiviazione",
                "ARCHIVIAZIONE",
                "archiviazione",
                "Archivia",
                "ARCHIVIA",
                "archivia",
            ],
        ),
        disponibilita: get_field_any(row, &["Disponibilita", "DISPONIBILITA", "disponibilita"]),
        notaaggiuntiva: get_field_any(row, &["NoteAggiuntive", "NotaAggiuntiva", "NOTAAGGIUNTIVA"]),
        sesso: get_sesso_field(row),
        nascita_comune,
        nascita_data,
        residenza_indirizzo,
        residenza_civico,
        residenza_cap,
        residenza_comune,
        residenza_provincia,
    })
}

fn get_nascita_fields(row: &serde_json::Value) -> (String, String) {
    (
        get_field_any(row, &["Nascita_Comune", "NASCITA_COMUNE", "ComuneNascita"]),
        format_date_iso(&get_field_any(row, &["Nascita_Data", "NASCITA_DATA", "DataNascita"])),
    )
}

fn get_sesso_field(row: &serde_json::Value) -> String {
    get_field_any(row, &["Sesso", "SESSO", "sesso"])
}

fn get_residenza_fields(row: &serde_json::Value) -> (String, String, String, String, String) {
    (
        get_field_any(
            row,
            &[
                "Residenza_Indirizzo",
                "RESIDENZA_INDIRIZZO",
                "IndirizzoResidenza",
                "ViaResidenza",
            ],
        ),
        get_field_any(
            row,
            &[
                "Residenza_Civico",
                "RESIDENZA_CIVICO",
                "CivicoResidenza",
                "NumeroCivico",
            ],
        ),
        get_field_any(row, &["CAP", "Residenza_CAP", "RESIDENZA_CAP", "CapResidenza"]),
        get_field_any(
            row,
            &["Residenza_Comune", "RESIDENZA_COMUNE", "ComuneResidenza"],
        ),
        get_field_any(
            row,
            &[
                "Residenza_Provincia",
                "RESIDENZA_PROVINCIA",
                "ProvinciaResidenza",
                "Prov",
            ],
        ),
    )
}

/// Prova più nomi colonna Supabase (PascalCase o legacy SharePoint)
fn get_field_any(row: &serde_json::Value, names: &[&str]) -> String {
    for name in names {
        let value = get_field(row, name);
        if !value.is_empty() {
            return value;
        }
    }
    // Fallback case-insensitive (Postgres/Supabase può restituire nomi colonna diversi)
    if let Some(obj) = row.as_object() {
        for name in names {
            let name_lower = name.to_lowercase();
            for (key, val) in obj {
                if key.to_lowercase() == name_lower {
                    let s = json_to_string(val);
                    if !s.is_empty() {
                        return s;
                    }
                }
            }
        }
    }
    String::new()
}

/// Valore testo da tabella lookup stati servizio (StatoDelServizio_supa)
fn lookup_stato_servizio_value(row: &serde_json::Value) -> String {
    let value = get_field_any(
        row,
        &[
            "Stato_Servizio",
            "STATO_SERVIZIO",
            "StatoServizio",
            "STATOSERVIZIO",
            "stato_servizio",
            "Stato_Del_Servizio",
            "StatoDelServizio",
            "STATO_DEL_SERVIZIO",
            "stato_del_servizio",
            "Descrizione",
            "DESCRIZIONE",
            "descrizione",
            "Nome",
            "NOME",
            "nome",
        ],
    );
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    if let Some(obj) = row.as_object() {
        for (key, val) in obj {
            let lower = key.to_lowercase();
            if lower.contains("id") || lower.ends_with("_at") {
                continue;
            }
            let s = json_to_string(val).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }

    String::new()
}

fn row_has_column(row: &serde_json::Value, name: &str) -> bool {
    row.as_object()
        .map(|obj| obj.contains_key(name))
        .unwrap_or(false)
}

/// Primo nome colonna effettivamente presente nella riga (per PATCH Supabase)
fn resolve_column_key(row: &serde_json::Value, candidates: &[&str]) -> Option<String> {
    for name in candidates {
        if row_has_column(row, name) {
            return Some((*name).to_string());
        }
    }
    if let Some(obj) = row.as_object() {
        for name in candidates {
            let name_lower = name.to_lowercase();
            for key in obj.keys() {
                if key.to_lowercase() == name_lower {
                    return Some(key.clone());
                }
            }
        }
    }
    None
}

fn insert_patch_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: &serde_json::Value,
    candidates: &[&str],
    value: serde_json::Value,
) {
    if let Some(key) = resolve_column_key(row, candidates) {
        body.insert(key, value);
    } else {
        println!(
            "⚠️ PATCH skip: nessuna colonna tra {:?} in tesserati",
            candidates
        );
    }
}

/// Valore booleano compatibile con il tipo già usato nella colonna Supabase
fn json_for_bool_patch(row: &serde_json::Value, column_key: &str, value: bool) -> serde_json::Value {
    match row.get(column_key) {
        Some(serde_json::Value::Bool(_)) => serde_json::json!(value),
        Some(serde_json::Value::Number(_)) => {
            serde_json::json!(if value { 1 } else { 0 })
        }
        Some(serde_json::Value::String(s)) => {
            let upper = s.trim().to_uppercase();
            if upper == "SI" || upper == "NO" || upper == "SÌ" {
                serde_json::json!(bool_to_db_flag(value))
            } else {
                serde_json::json!(value)
            }
        }
        _ => serde_json::json!(value),
    }
}

fn insert_patch_bool_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: &serde_json::Value,
    candidates: &[&str],
    value: bool,
) {
    if let Some(key) = resolve_column_key(row, candidates) {
        let json_val = json_for_bool_patch(row, &key, value);
        body.insert(key, json_val);
    } else {
        println!(
            "⚠️ PATCH skip bool: nessuna colonna tra {:?} in tesserati",
            candidates
        );
    }
}

/// Converte una riga Supabase (tabella Automezzi_Supa) nel struct Automezzo del frontend
/// Mappatura SharePoint → Supabase:
/// ID_AUTOMEZZO → IdAutomezzo | NR_AUTOMEZZO → Numero_Mezzo | MARCA → Marca | MODELLO → Modello
/// TARGA → Targa | DOTAZIONE → Dotazione | SCADENZA ZTL → Scadenza_ZTL
/// SCADENZA ASSICURAZIONE → Scadenza_Assicurazione | INSERVIZIO → InServizio
/// NOTE → Note_mezzo | SCADENZA BOLLO → Scadenza_Bollo
fn supabase_row_to_automezzo(row: &serde_json::Value) -> Option<Automezzo> {
    let id_automezzo = get_field_any(row, &["IdAutomezzo", "ID_AUTOMEZZO", "id_automezzo"])
        .parse::<u32>()
        .unwrap_or(0);

    let id = if id_automezzo > 0 {
        id_automezzo
    } else {
        row.get("id")
            .and_then(|v| {
                v.as_u64()
                    .map(|n| n as u32)
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            })
            .unwrap_or(0)
    };

    // Numero_Mezzo = NR_AUTOMEZZO (numero visualizzato, es. "3" per FIAT PANDA)
    let nr_automezzo = get_field_any(
        row,
        &[
            "Numero_Mezzo",
            "NR_AUTOMEZZO",
            "Nr_Automezzo",
            "NrAutomezzo",
            "NumeroAutomezzo",
            "nr_automezzo",
        ],
    );

    if id == 0 && nr_automezzo.trim().is_empty() {
        return None;
    }

    let scadenza_ztl_raw = get_field_any(row, &["Scadenza_ZTL", "SCADENZA ZTL", "ScadenzaZTL"]);
    let scadenza_assicurazione_raw = get_field_any(
        row,
        &[
            "Scadenza_Assicurazione",
            "SCADENZA ASSICURAZIONE",
            "ScadenzaAssicurazione",
        ],
    );
    let scadenza_bollo_raw =
        get_field_any(row, &["Scadenza_Bollo", "SCADENZA BOLLO", "ScadenzaBollo"]);

    Some(Automezzo {
        id,
        nr_automezzo,
        marca: get_field_any(row, &["Marca", "MARCA"]),
        modello: get_field_any(row, &["Modello", "MODELLO"]),
        targa: get_field_any(row, &["Targa", "TARGA"]),
        dotazione: get_field_any(row, &["Dotazione", "DOTAZIONE"]),
        scadenza_ztl: format_date_iso(&scadenza_ztl_raw),
        scadenza_assicurazione: format_date_iso(&scadenza_assicurazione_raw),
        in_servizio: get_field_any(row, &["InServizio", "INSERVIZIO", "In_Servizio"]),
        note_mezzo: get_field_any(row, &["Note_mezzo", "NOTE", "Note_Mezzo"]),
        scadenza_bollo: format_date_iso(&scadenza_bollo_raw),
    })
}

async fn setup_supabase_from_config(config: &AppConfig) {
    if let Some(supabase) = &config.supabase {
        let has_key = !supabase.anon_key.is_empty()
            || supabase
                .publishable_key
                .as_ref()
                .map(|k| !k.is_empty())
                .unwrap_or(false)
            || supabase
                .secret_key
                .as_ref()
                .map(|k| !k.is_empty())
                .unwrap_or(false);

        if supabase.url.is_empty() || !has_key {
            println!("⚠️ Config Supabase incompleta (url o chiave API mancanti)");
            return;
        }

        // App desktop Tauri (backend Rust): preferisci secret_key per bypassare RLS
        // publishable/anon restano soggetti alle policy RLS → spesso 0 righe
        let api_key = supabase
            .secret_key
            .clone()
            .filter(|k| !k.is_empty() && !k.contains("your-"))
            .or_else(|| {
                supabase
                    .publishable_key
                    .clone()
                    .filter(|k| !k.is_empty() && !k.contains("your-"))
            })
            .unwrap_or_else(|| supabase.anon_key.clone());

        if api_key.contains("your-anon-key") || api_key.is_empty() {
            println!("⚠️ Chiave API non configurata in config.json");
            return;
        }

        let key_type = if api_key.starts_with("sb_publishable_") {
            "publishable"
        } else if api_key.starts_with("sb_secret_") {
            "secret"
        } else if api_key.starts_with("eyJ") {
            if supabase.secret_key.as_ref().map(|k| k == &api_key).unwrap_or(false) {
                "service_role-jwt"
            } else {
                "anon-jwt"
            }
        } else {
            "custom"
        };
        if key_type.starts_with("secret") || key_type == "service_role-jwt" {
            println!("⚠️ Uso chiave SECRET (accesso completo DB) — solo per app desktop interna");
        }
        println!(
            "🔑 Supabase API key: tipo={}, prefisso={}...",
            key_type,
            &api_key.chars().take(16).collect::<String>()
        );

        let cfg = supabase.tables.as_ref();

        let tables = SupabaseTablesConfig {
            tesserati: cfg
                .and_then(|t| t.tesserati.clone())
                .or_else(|| supabase.table_tesserati.clone())
                .unwrap_or_else(|| "tesserati_supa".to_string()),
            servizi: cfg
                .and_then(|t| t.servizi.clone())
                .unwrap_or_else(|| "Servizi_supa".to_string()),
            automezzi: cfg
                .and_then(|t| t.automezzi.clone())
                .unwrap_or_else(|| "Automezzi_Supa".to_string()),
            dotazioni_mezzi: cfg
                .and_then(|t| t.dotazioni_mezzi.clone())
                .unwrap_or_else(|| "DotazioniMezzi_supa".to_string()),
            impostazioni: cfg
                .and_then(|t| t.impostazioni.clone())
                .unwrap_or_else(|| "Impostazioni_supa".to_string()),
            motivazioni_trasporto: cfg
                .and_then(|t| t.motivazioni_trasporto.clone())
                .unwrap_or_else(|| "Motivazioni_trasporto_supa".to_string()),
            motorizzazioni: cfg
                .and_then(|t| t.motorizzazioni.clone())
                .unwrap_or_else(|| "Motorizzazioni_supa".to_string()),
            richiedenti: cfg
                .and_then(|t| t.richiedenti.clone())
                .unwrap_or_else(|| "Richiedenti_supa".to_string()),
            stato_del_servizio: cfg
                .and_then(|t| t.stato_del_servizio.clone())
                .unwrap_or_else(|| "StatoDelServizio_supa".to_string()),
            telefoni: cfg
                .and_then(|t| t.telefoni.clone())
                .unwrap_or_else(|| "Telefoni_supa".to_string()),
            email: cfg
                .and_then(|t| t.email.clone())
                .unwrap_or_else(|| "Email_supa".to_string()),
            tipo_pagamenti: cfg
                .and_then(|t| t.tipo_pagamenti.clone())
                .unwrap_or_else(|| "TipoPagamenti_supa".to_string()),
            tipo_socio: cfg
                .and_then(|t| t.tipo_socio.clone())
                .unwrap_or_else(|| "TipoSocio_supa".to_string()),
            tipologia_socio: cfg
                .and_then(|t| t.tipologia_socio.clone())
                .or_else(|| cfg.and_then(|t| t.tipo_socio.clone()))
                .unwrap_or_else(|| "TipoSocio_supa".to_string()),
            tratte: cfg
                .and_then(|t| t.tratte.clone())
                .unwrap_or_else(|| "Tratte_supa".to_string()),
            user_permissions: cfg
                .and_then(|t| t.user_permissions.clone())
                .unwrap_or_else(|| "user_permissions".to_string()),
            tesseramenti: cfg
                .and_then(|t| t.tesseramenti.clone())
                .unwrap_or_else(|| "Tesseramenti_supa".to_string()),
            mansioni: cfg
                .and_then(|t| t.mansioni.clone())
                .unwrap_or_else(|| "Mansioni_supa".to_string()),
            appunti: cfg
                .and_then(|t| t.appunti.clone())
                .unwrap_or_else(|| "appunti_utente".to_string()),
            appunti_destinatari: cfg
                .and_then(|t| t.appunti_destinatari.clone())
                .unwrap_or_else(|| "appunti_destinatari".to_string()),
            appunti_risposte: cfg
                .and_then(|t| t.appunti_risposte.clone())
                .unwrap_or_else(|| "appunti_risposte".to_string()),
        };

        let sb_config = SupabaseConfig {
            url: supabase.url.clone(),
            anon_key: api_key,
            tables: tables.clone(),
        };
        let mut guard = get_supabase_client().lock().await;
        *guard = Some(SupabaseClient::new(sb_config));
        println!(
            "✓ Client Supabase inizializzato ({} tabelle configurate)",
            20
        );
        println!(
            "  tesserati={}, tesseramenti={}, servizi={}, automezzi={}, tipo_socio={}",
            tables.tesserati,
            tables.tesseramenti,
            tables.servizi,
            tables.automezzi,
            tables.tipo_socio
        );
    }
}

fn config_json_paths() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;

    let mut possible_paths = Vec::new();

    // 1) Accanto all'eseguibile (app installata / portable)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            possible_paths.push(dir.join("config.json"));
            possible_paths.push(dir.join("resources").join("config.json"));
            // Tauri 1 su Windows a volte mette le risorse in una sottocartella
            possible_paths.push(dir.join("_up_").join("config.json"));
        }
    }

    // 2) Directory di lavoro (sviluppo / avvio da cartella progetto)
    possible_paths.push(PathBuf::from("config.json"));
    possible_paths.push(PathBuf::from("../config.json"));

    if let Ok(current_dir) = std::env::current_dir() {
        let root_path = if current_dir.ends_with("src-tauri") {
            current_dir.parent().map(|p| p.join("config.json"))
        } else {
            Some(current_dir.join("config.json"))
        };
        if let Some(path) = root_path {
            possible_paths.push(path);
        }
    }

    // Rimuovi duplicati mantenendo l'ordine
    let mut visti = std::collections::HashSet::new();
    possible_paths
        .into_iter()
        .filter(|p| visti.insert(p.clone()))
        .collect()
}

async fn load_app_config_from_file() -> Result<AppConfig, String> {
    let mut last_error = None;

    for config_path in config_json_paths() {
        match fs::read_to_string(&config_path) {
            Ok(contents) => {
                println!("✓ config.json caricato da: {:?}", config_path);
                let config: AppConfig = serde_json::from_str(&contents)
                    .map_err(|e| format!("Errore parsing config.json: {}", e))?;
                return Ok(config);
            }
            Err(e) => {
                last_error = Some(format!("{:?}: {}", config_path, e));
            }
        }
    }

    // Fallback: config inclusa nella build (app installata)
    match load_embedded_config() {
        Ok(config) => {
            println!("✓ config.json caricato da risorsa incorporata nella build");
            Ok(config)
        }
        Err(e) => Err(last_error.unwrap_or(e)),
    }
}

/// Config compilata dentro l'eseguibile (stesso file usato in sviluppo)
fn load_embedded_config() -> Result<AppConfig, String> {
    const RAW: &str = include_str!("../../config.json");
    serde_json::from_str(RAW).map_err(|e| format!("Errore parsing config incorporata: {}", e))
}

async fn ensure_supabase_client() -> Result<(), String> {
    {
        let guard = get_supabase_client().lock().await;
        if guard.is_some() {
            return Ok(());
        }
    }

    let config = load_app_config_from_file().await?;
    setup_supabase_from_config(&config).await;

    let guard = get_supabase_client().lock().await;
    if guard.is_none() {
        return Err(
            "Supabase non inizializzato. Controlla url e anon_key in config.json (Settings → API in Supabase)."
                .to_string(),
        );
    }

    Ok(())
}

async fn fetch_servizi_supabase(filter: Option<&str>) -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi(filter)
        .await
        .map_err(|e| format_supabase_error(&e))
}

async fn fetch_servizi_anteprima(filter: &str, limit: usize) -> Result<Vec<serde_json::Value>, String> {
    const COLONNE: &str = "idservizio,Prelievo_Data,Prelievo_Ora,Prelievo_Comune,Prelievo_Indirizzo,Prelievo_Note,IdSocio,Trasportato,Sollevatore,Standard,Carrozzina,Richiedente,Motivazione,Destinazione_Data,Destinazione_Comune,Destinazione_Indirizzo,Destinazione_Note,Donazioni,Incassato,TipoPagamento,Oper,IdOperatore,Oper2,IdOperatore2,Mezzo,Km,Km_uscita,Km_rientro,Tempo,Bonifico_Data,Ricevuta_Data,Ricevuta_numero,StatoServizio,NoteFineServizio,Archiviazione,CreatoDa,ModificatoDa,created_at,update_at";
    ensure_supabase_client().await?;
    let tentativi = [
        (COLONNE, "Prelievo_Data.desc"),
        ("*", "Prelievo_Data.desc"),
        ("*", "DATA_PRELIEVO.desc"),
    ];
    let mut ultimo_errore = String::new();
    for (colonne, order) in tentativi {
        let esito = {
            let guard = get_supabase_client().lock().await;
            let client = guard
                .as_ref()
                .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
            client
                .fetch_servizi_limit(filter, order, limit, colonne)
                .await
        };
        match esito {
            Ok(rows) => return Ok(rows),
            Err(e) => ultimo_errore = format_supabase_error(&e),
        }
    }
    Err(ultimo_errore)
}

async fn fetch_servizi_ilike_colonna(
    colonna: &str,
    valore: &str,
    order: &str,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi_ilike_colonna(colonna, valore, order, limit)
        .await
        .map_err(|e| format_supabase_error(&e))
}

async fn fetch_motivazioni_servizi_supabase() -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi_motivazioni()
        .await
        .map_err(|e| format_supabase_error(&e))
}

async fn fetch_comuni_prelievo_servizi_supabase() -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi_comuni_prelievo()
        .await
        .map_err(|e| format_supabase_error(&e))
}

async fn fetch_localita_autocomplete_servizi_supabase() -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi_localita_autocomplete()
        .await
        .map_err(|e| format_supabase_error(&e))
}

async fn fetch_servizi_idsocio_supabase() -> Result<Vec<serde_json::Value>, String> {
    ensure_supabase_client().await?;
    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
    client
        .fetch_servizi_idsocio()
        .await
        .map_err(|e| format_supabase_error(&e))
}

fn format_supabase_error(err: &str) -> String {
    if err.contains("401") || err.contains("Invalid API key") {
        return format!(
            "{}\n\n🔧 SOLUZIONE — la anon key (eyJ...) nel config NON funziona più.\n\
            Apri Supabase → il tuo progetto → Settings → API Keys:\n\
            • SOLUZIONE A (consigliata): copia la Publishable key (inizia con sb_publishable_)\n\
              e incollala in config.json come \"publishable_key\": \"sb_publishable_...\"\n\
            • SOLUZIONE B: clicca Regenerate sulla anon key e aggiorna \"anon_key\"\n\
            • SOLUZIONE C (app desktop): copia Secret key (sb_secret_...) in \"secret_key\"\n\
            Poi riavvia l'app (npm run tauri dev).",
            err
        );
    }
    err.to_string()
}

// Test connessione Supabase (utile per verificare la chiave API)
#[tauri::command]
async fn test_supabase_connection() -> Result<serde_json::Value, String> {
    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    match client.fetch_tesserati(None, None).await {
        Ok(rows) => Ok(serde_json::json!({
            "success": true,
            "message": format!("Connessione OK. Trovati {} record in tesserati_supa.", rows.len()),
            "count": rows.len()
        })),
        Err(e) => Err(format_supabase_error(&e)),
    }
}

// Helper per ottenere l'oauth state lock
fn get_oauth_state() -> &'static Mutex<Option<String>> {
    OAUTH_STATE.get_or_init(|| Mutex::new(None))
}

// Comando per verificare se l'app è pronta (Supabase configurato — SharePoint non più richiesto)
#[tauri::command]
async fn check_authentication() -> Result<bool, String> {
    match ensure_supabase_client().await {
        Ok(()) => {
            let guard = get_supabase_client().lock().await;
            let ready = guard.is_some();
            println!("Controllo autenticazione (Supabase): ready = {}", ready);
            Ok(ready)
        }
        Err(e) => {
            println!("Controllo autenticazione: Supabase non disponibile — {}", e);
            Ok(false)
        }
    }
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

/// Riga informativa: mezzo già usato in un altro servizio nella stessa data
#[derive(Debug, Serialize, Deserialize)]
struct ServizioMezzoOccupato {
    ora: String,
    operatore: String,
    trasportato: String,
    comune_destinazione: String,
    luogo_destinazione: String,
}

/// Riga informativa: servizi già registrati verso lo stesso luogo di destinazione
#[derive(Debug, Serialize, Deserialize)]
struct ServizioStessoLuogoDest {
    data_prelievo: String,
    comune_prelievo: String,
    luogo_prelievo: String,
    trasportato: String,
    donazione: String,
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
    #[serde(default)]
    id_operatore: String,
    #[serde(default)]
    id_operatore_2: String,
    /// Testo originale colonna Oper (anche se IdOperatore punta altrove)
    #[serde(default)]
    operatore_testo: String,
    mezzo_usato: String,
    mezzo: String, // Campo MEZZO che contiene il riferimento NR_AUTOMEZZO
    tempo: String,
    km: String,
    km_uscita: String,
    km_rientro: String,
    tipo_pagamento: String,
    data_bonifico: String,
    data_ricevuta: String,
    numero_ricevuta: String,
    stato_servizio: String,
    note_prelievo: String,
    note_arrivo: String,
    note_fine_servizio: String,
    archivia: String,
    #[serde(default)]
    creato_da: String,
    #[serde(default)]
    modificato_da: String,
    /// Timestamp creazione (colonna Supabase: created_at)
    #[serde(default)]
    created_at: String,
    /// Timestamp ultima modifica (colonna Supabase: update_at)
    #[serde(default)]
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tessera {
    id: u32,
    idsocio: String,
    descrizione: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tesserato {
    id: u32, // ID riga Supabase (o IdSocio)
    idsocio: String,
    nominativo: String,
    codicefiscale: String,
    numerotessera: String,
    scadenzatessera: String,
    telefono: String,
    tipologiasocio: String,
    operatore: String,
    attivo: String,
    archivia: String,
    disponibilita: String,
    notaaggiuntiva: String,
    #[serde(default)]
    sesso: String,
    #[serde(default)]
    nascita_comune: String,
    #[serde(default)]
    nascita_data: String,
    #[serde(default)]
    residenza_indirizzo: String,
    #[serde(default)]
    residenza_civico: String,
    #[serde(default)]
    residenza_cap: String,
    #[serde(default)]
    residenza_comune: String,
    #[serde(default)]
    residenza_provincia: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SocioAnagrafica {
    id: u32,
    idsocio: String,
    nominativo: String,
    codicefiscale: String,
    sesso: String,
    nascita_comune: String,
    nascita_data: String,
    residenza_indirizzo: String,
    residenza_civico: String,
    residenza_cap: String,
    residenza_comune: String,
    residenza_provincia: String,
    telefono: String,
    tipologiasocio: String,
    operatore: bool,
    attivo: bool,
    archivia: bool,
    disponibilita: String,
    notaaggiuntiva: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TesseramentoRecord {
    id: Option<String>,
    idsocio: String,
    anno: String,
    numero: String,
    data: String,
    scadenza: String,
    tipologia: String,
    quota: String,
    note: String,
}

/// Tesseramento + nominativo socio (per verifiche anomalie)
#[derive(Debug, Serialize, Deserialize, Clone)]
struct TesseramentoListaItem {
    id: Option<String>,
    idsocio: String,
    nominativo: String,
    /// true se IdSocio esiste in anagrafica tesserati
    #[serde(default)]
    collegato: bool,
    anno: String,
    numero: String,
    data: String,
    scadenza: String,
    tipologia: String,
    quota: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SocioTelefono {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    idsocio: String,
    telefono: String,
    riferimento: String,
    principale: bool,
    ordine_utilizzo: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SocioEmail {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    idsocio: String,
    email: String,
    riferimento: String,
    principale: bool,
    ordine_utilizzo: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SocioAnagraficaCompleta {
    anagrafica: SocioAnagrafica,
    tesseramenti: Vec<TesseramentoRecord>,
    #[serde(default)]
    telefoni: Vec<SocioTelefono>,
    #[serde(default)]
    email: Vec<SocioEmail>,
}

fn bool_to_db_flag(value: bool) -> String {
    if value {
        "SI".to_string()
    } else {
        "NO".to_string()
    }
}

fn supabase_row_to_anagrafica(row: &serde_json::Value) -> Option<SocioAnagrafica> {
    let tesserato = supabase_row_to_tesserato(row)?;
    let (nascita_comune, nascita_data) = get_nascita_fields(row);
    let (residenza_indirizzo, residenza_civico, residenza_cap, residenza_comune, residenza_provincia) =
        get_residenza_fields(row);
    Some(SocioAnagrafica {
        id: tesserato.id,
        idsocio: tesserato.idsocio,
        nominativo: tesserato.nominativo,
        codicefiscale: tesserato.codicefiscale,
        sesso: get_sesso_field(row),
        nascita_comune,
        nascita_data,
        residenza_indirizzo,
        residenza_civico,
        residenza_cap,
        residenza_comune,
        residenza_provincia,
        telefono: tesserato.telefono,
        tipologiasocio: tesserato.tipologiasocio,
        operatore: is_truthy_str(&tesserato.operatore),
        attivo: is_truthy_str(&tesserato.attivo),
        archivia: is_truthy_str(&tesserato.archivia),
        disponibilita: tesserato.disponibilita,
        notaaggiuntiva: tesserato.notaaggiuntiva,
    })
}

fn is_truthy_str(value: &str) -> bool {
    let v = value.trim().to_lowercase();
    v == "true" || v == "si" || v == "sì" || v == "1" || v == "yes" || v == "attivo"
}

fn supabase_row_to_telefono(row: &serde_json::Value) -> SocioTelefono {
    let id = row
        .get("id")
        .or_else(|| row.get("Id"))
        .map(json_to_string)
        .filter(|s| !s.trim().is_empty());
    SocioTelefono {
        id,
        idsocio: get_field_any(row, &["IdSocio", "IDSocio", "idsocio"]),
        telefono: get_field_any(row, &["Telefono", "TELEFONO", "telefono"]),
        riferimento: get_field_any(row, &["Riferimento", "RIFERIMENTO", "riferimento"]),
        principale: get_bool_from_row(row, &["Principale", "PRINCIPALE", "principale"]),
        ordine_utilizzo: get_field_any(
            row,
            &["OrdineUtilizzo", "Ordine_Utilizzo", "ordineutilizzo"],
        ),
        note: get_field_any(
            row,
            &["NoteTelefono", "Note_Telefono", "Note", "note"],
        ),
    }
}

fn supabase_row_to_email(row: &serde_json::Value) -> SocioEmail {
    let id = row
        .get("id")
        .or_else(|| row.get("Id"))
        .map(json_to_string)
        .filter(|s| !s.trim().is_empty());
    SocioEmail {
        id,
        idsocio: get_field_any(row, &["IdSocio", "IDSocio", "idsocio"]),
        email: get_field_any(row, &["Email", "EMAIL", "email"]),
        riferimento: get_field_any(
            row,
            &["Riferimento_Email", "RiferimentoEmail", "Riferimento", "riferimento"],
        ),
        principale: get_bool_from_row(row, &["Principale", "PRINCIPALE", "principale"]),
        ordine_utilizzo: get_field_any(
            row,
            &["OrdineUtilizzo", "Ordine_Utilizzo", "ordineutilizzo"],
        ),
        note: get_field_any(row, &["NoteEmail", "Note_Email", "Note", "note"]),
    }
}

/// Testo per il campo "Telefono principale": numero + (riferimento) se presente.
fn format_telefono_principale(telefoni: &[SocioTelefono]) -> Option<String> {
    let principale = telefoni.iter().find(|t| t.principale && !t.telefono.trim().is_empty());
    let chosen = principale.or_else(|| {
        telefoni
            .iter()
            .find(|t| !t.telefono.trim().is_empty())
    })?;
    let num = chosen.telefono.trim();
    let rif = chosen.riferimento.trim();
    if rif.is_empty() {
        Some(num.to_string())
    } else {
        Some(format!("{} ({})", num, rif))
    }
}

/// Mappa IdSocio → telefono principale formattato (da righe Telefoni_supa).
fn build_telefoni_principali_map(rows: &[serde_json::Value]) -> HashMap<String, String> {
    let mut by_socio: HashMap<String, Vec<SocioTelefono>> = HashMap::new();

    for row in rows {
        let idsocio = get_field_any(row, &["IdSocio", "IDSocio", "idsocio"])
            .trim()
            .to_string();
        if idsocio.is_empty() {
            continue;
        }
        by_socio
            .entry(idsocio)
            .or_default()
            .push(supabase_row_to_telefono(row));
    }

    let mut map = HashMap::new();
    for (idsocio, telefoni) in by_socio {
        if let Some(formatted) = format_telefono_principale(&telefoni) {
            map.insert(idsocio, formatted);
        }
    }
    map
}

/// Sostituisce il campo telefono dei tesserati con quello principale da Telefoni_supa.
fn apply_telefoni_principali(tesserati: &mut [Tesserato], principali: &HashMap<String, String>) {
    for t in tesserati.iter_mut() {
        let key = t.idsocio.trim();
        if let Some(tel) = principali.get(key) {
            t.telefono = tel.clone();
        }
    }
}

fn supabase_row_to_tesseramento(row: &serde_json::Value) -> TesseramentoRecord {
    let data_raw = get_field_any(
        row,
        &[
            "DataTesseramento",
            "Data_Tesseramento",
            "Tesseramento_Data",
            "Data",
        ],
    );
    let mut anno = get_field_any(row, &["Anno", "Tesseramento_Anno", "ANNO"]);
    // In Tesseramenti_supa a volte Anno è vuoto: si ricava dalla data
    if anno.is_empty() && data_raw.len() >= 4 {
        let year_candidate = if data_raw.contains('-') {
            data_raw.chars().take(4).collect::<String>()
        } else if data_raw.contains('/') {
            data_raw
                .rsplit('/')
                .next()
                .unwrap_or("")
                .chars()
                .take(4)
                .collect::<String>()
        } else {
            String::new()
        };
        if year_candidate.chars().all(|c| c.is_ascii_digit()) && year_candidate.len() == 4 {
            anno = year_candidate;
        }
    }

    let scadenza = if !anno.is_empty() {
        format!("31/12/{}", anno)
    } else {
        format_date_iso(&get_field_any(row, &["Scadenza", "Scadenza_Tessera"]))
    };

    TesseramentoRecord {
        id: row
            .get("id")
            .map(|v| {
                v.as_u64()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| v.to_string())
            }),
        idsocio: get_field_any(row, &["IdSocio", "IDSOCIO"]),
        anno,
        numero: get_field_any(
            row,
            &[
                "Tessera_Numero",
                "Numero",
                "Tesseramento_Numero",
                "Numero_Tessera",
            ],
        ),
        data: format_date_iso(&data_raw),
        scadenza,
        tipologia: get_field_any(row, &["TipologiaSocio", "Tipologia"]),
        quota: get_field_any(row, &["Quota", "Quota_Versata"]),
        note: get_field_any(row, &["Note", "Note_Tesseramento"]),
    }
}

fn tesseramento_from_tesserato_row(row: &serde_json::Value) -> Option<TesseramentoRecord> {
    let idsocio = get_field(row, "IdSocio");
    let anno = get_field(row, "Tesseramento_Anno");
    let numero = get_field(row, "Tesseramento_Numero");
    let data_raw = get_field(row, "Tesseramento_Data");

    if idsocio.is_empty() || (anno.is_empty() && data_raw.is_empty() && numero.is_empty()) {
        return None;
    }

    let anno_eff = if anno.is_empty() {
        data_raw
            .split('-')
            .next()
            .unwrap_or("")
            .to_string()
    } else {
        anno
    };

    Some(TesseramentoRecord {
        id: None,
        idsocio,
        anno: anno_eff.clone(),
        numero,
        data: format_date_iso(&data_raw),
        scadenza: if anno_eff.is_empty() {
            String::new()
        } else {
            format!("31/12/{}", anno_eff)
        },
        tipologia: get_field(row, "TipologiaSocio"),
        quota: String::new(),
        note: String::new(),
    })
}

fn italian_date_to_iso(date_str: &str) -> Option<String> {
    let parts: Vec<&str> = date_str.trim().split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    Some(format!("{}-{}-{}", parts[2], parts[1], parts[0]))
}

#[derive(Debug, Serialize, Deserialize)]
struct Automezzo {
    id: u32,              // IdAutomezzo (ID_AUTOMEZZO)
    nr_automezzo: String, // Numero_Mezzo (NR_AUTOMEZZO)
    marca: String,        // Marca
    modello: String,      // Modello
    targa: String,        // Targa
    dotazione: String,    // Dotazione
    scadenza_ztl: String, // Scadenza_ZTL
    scadenza_assicurazione: String, // Scadenza_Assicurazione
    in_servizio: String,  // InServizio (boolean → stringa)
    note_mezzo: String,   // Note_mezzo
    scadenza_bollo: String, // Scadenza_Bollo
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Tratta {
    id: u32,
    comune: String,
    provincia: String,
    localita: String,
    km: String,
    costo_km: String,
    costo: String,
    pedaggio: String,
    totale: String,
    note_aggiuntive: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TratteElenco {
    costo_al_km: f64,
    tratte: Vec<Tratta>,
}

fn supabase_row_to_tratta(row: &serde_json::Value, costo_al_km: f64) -> Option<Tratta> {
    let id_tratta = get_field_any(row, &["IdTratta", "ID_TRATTA", "id_tratta"])
        .parse::<u32>()
        .unwrap_or(0);

    let id = if id_tratta > 0 {
        id_tratta
    } else {
        row.get("id")
            .and_then(|v| {
                v.as_u64()
                    .map(|n| n as u32)
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            })
            .unwrap_or(0)
    };

    if id == 0 {
        return None;
    }

    let km_ar = get_numeric_any(row, &["Tratta_KmAr", "TRATTA_KMAR"]);
    let pedaggio = get_numeric_any(row, &["Tratta_Pedaggio", "TRATTA_PEDAGGIO"]);
    let tariffa_eff = if costo_al_km > 0.0 {
        costo_al_km
    } else {
        get_numeric_any(row, &["Tratta_TariffaKm", "TRATTA_TARIFFAKM"])
    };
    let costo = km_ar * tariffa_eff;
    let totale = costo + pedaggio;

    Some(Tratta {
        id,
        comune: get_field_any(row, &["Tratta_Comune", "TRATTA_COMUNE"]),
        provincia: get_field_any(row, &["Tratta_Provincia", "TRATTA_PROVINCIA"]),
        localita: get_field_any(row, &["Tratta_Localita", "TRATTA_LOCALITA"]),
        km: format_tratta_decimal(km_ar, 0, false),
        costo_km: format_tratta_decimal(tariffa_eff, 2, true),
        costo: format_tratta_decimal(costo, 1, false),
        pedaggio: format_tratta_decimal(pedaggio, 2, true),
        totale: format_tratta_decimal(totale, 2, false),
        note_aggiuntive: get_field_any(row, &["Tratta_Note", "TRATTA_NOTE"]),
    })
}

fn costo_al_km_da_impostazioni(rows: &[serde_json::Value]) -> f64 {
    for row in rows {
        let chiave = get_field_any(
            row,
            &[
                "Impostazione",
                "IMPOSTAZIONE",
                "Nome",
                "Chiave",
                "Impostazione_Nome",
            ],
        );
        if !chiave.eq_ignore_ascii_case("CostoAlKm") {
            continue;
        }
        let valore = get_numeric_any(
            row,
            &[
                "Valore",
                "VALORE",
                "Valore_Impostazione",
                "Impostazione_Valore",
                "ValoreNumerico",
                "CostoAlKm",
            ],
        );
        if valore > 0.0 {
            return valore;
        }
    }
    0.70
}

async fn fetch_costo_al_km(client: &supabase::SupabaseClient) -> Result<f64, String> {
    let filter = "Impostazione=eq.CostoAlKm";
    let rows = client
        .fetch_impostazioni(Some(filter))
        .await
        .map_err(|e| format_supabase_error(&e))?;

    if !rows.is_empty() {
        let v = costo_al_km_da_impostazioni(&rows);
        if v > 0.0 {
            return Ok(v);
        }
    }

    let all = client
        .fetch_impostazioni(None)
        .await
        .map_err(|e| format_supabase_error(&e))?;
    Ok(costo_al_km_da_impostazioni(&all))
}

const NOME_IMP_ULTIMI_SERVIZI_POPUP: &str = "ULTIMI SERVIZI NEL POPUP";
const DEFAULT_ULTIMI_SERVIZI_POPUP: usize = 5;
const MAX_ULTIMI_SERVIZI_POPUP: usize = 50;

fn parse_limite_ultimi_servizi_popup(valore: &str) -> Option<usize> {
    let t = valore.trim().replace(',', ".");
    if t.is_empty() {
        return None;
    }
    if let Ok(n) = t.parse::<usize>() {
        return Some(n.clamp(1, MAX_ULTIMI_SERVIZI_POPUP));
    }
    if let Ok(n) = t.parse::<f64>() {
        if n.is_finite() && n >= 1.0 {
            return Some((n.round() as usize).clamp(1, MAX_ULTIMI_SERVIZI_POPUP));
        }
    }
    None
}

fn ultimi_servizi_popup_da_impostazioni(rows: &[serde_json::Value]) -> usize {
    let attesa = NOME_IMP_ULTIMI_SERVIZI_POPUP;
    for row in rows {
        let chiave = get_field_any(
            row,
            &[
                "Impostazione",
                "IMPOSTAZIONE",
                "Nome",
                "Chiave",
                "Impostazione_Nome",
            ],
        );
        if normalizza_luogo_dest(&chiave) != attesa {
            continue;
        }
        let valore = get_field_any(
            row,
            &[
                "ValoreImpostazione",
                "Valore",
                "VALORE",
                "Valore_Impostazione",
                "Impostazione_Valore",
            ],
        );
        if let Some(n) = parse_limite_ultimi_servizi_popup(&valore) {
            return n;
        }
        let num = get_numeric_any(
            row,
            &[
                "ValoreImpostazione",
                "Valore",
                "VALORE",
                "Valore_Impostazione",
                "Impostazione_Valore",
            ],
        );
        if num >= 1.0 {
            return (num.round() as usize).clamp(1, MAX_ULTIMI_SERVIZI_POPUP);
        }
    }
    DEFAULT_ULTIMI_SERVIZI_POPUP
}

async fn fetch_limite_ultimi_servizi_popup() -> usize {
    if ensure_supabase_client().await.is_err() {
        return DEFAULT_ULTIMI_SERVIZI_POPUP;
    }
    let guard = get_supabase_client().lock().await;
    let Some(client) = guard.as_ref() else {
        return DEFAULT_ULTIMI_SERVIZI_POPUP;
    };
    match client.fetch_impostazioni(None).await {
        Ok(rows) => {
            let n = ultimi_servizi_popup_da_impostazioni(&rows);
            println!("✓ Impostazione {} = {}", NOME_IMP_ULTIMI_SERVIZI_POPUP, n);
            n
        }
        Err(e) => {
            println!(
                "⚠️ Lettura {}: {} — uso default {}",
                NOME_IMP_ULTIMI_SERVIZI_POPUP, e, DEFAULT_ULTIMI_SERVIZI_POPUP
            );
            DEFAULT_ULTIMI_SERVIZI_POPUP
        }
    }
}

async fn sync_tratte_tariffa_km(
    client: &supabase::SupabaseClient,
    rows: &[serde_json::Value],
    costo_al_km: f64,
) {
    if costo_al_km <= 0.0 {
        return;
    }

    for row in rows {
        let id = get_field_any(row, &["IdTratta", "ID_TRATTA"])
            .parse::<u32>()
            .unwrap_or(0);
        if id == 0 {
            continue;
        }

        let attuale = get_numeric_any(row, &["Tratta_TariffaKm", "TRATTA_TARIFFAKM"]);
        if (attuale - costo_al_km).abs() < 0.000_1 {
            continue;
        }

        let mut body = serde_json::Map::new();
        insert_patch_field(
            &mut body,
            row,
            &["Tratta_TariffaKm", "TRATTA_TARIFFAKM"],
            serde_json::json!(costo_al_km),
        );
        if body.is_empty() {
            body.insert("Tratta_TariffaKm".to_string(), serde_json::json!(costo_al_km));
        }

        if let Err(e) = client.patch_tratta(id, &body).await {
            println!(
                "⚠️ Sync tariffa km tratta IdTratta={} fallita: {}",
                id, e
            );
        }
    }
}

fn get_numeric_any(row: &serde_json::Value, names: &[&str]) -> f64 {
    if let Some(obj) = row.as_object() {
        for name in names {
            for (key, val) in obj {
                if key.eq_ignore_ascii_case(name) {
                    return match val {
                        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
                        serde_json::Value::String(s) => parse_decimal_for_db(s),
                        _ => 0.0,
                    };
                }
            }
        }
    }
    0.0
}

fn format_tratta_decimal(value: f64, decimals: u32, with_euro: bool) -> String {
    let prec = decimals as usize;
    let formatted = format!("{:.prec$}", value, prec = prec).replace('.', ",");
    if with_euro {
        format!("{} €", formatted)
    } else {
        formatted
    }
}

fn build_tratta_body(
    tratta: &Tratta,
    row: Option<&serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut body = serde_json::Map::new();

    let put_field = |body: &mut serde_json::Map<String, serde_json::Value>,
                     row: Option<&serde_json::Value>,
                     candidates: &[&str],
                     default_key: &str,
                     value: serde_json::Value| {
        if let Some(r) = row {
            insert_patch_field(body, r, candidates, value);
        } else {
            body.insert(default_key.to_string(), value);
        }
    };

    put_field(
        &mut body,
        row,
        &["Tratta_Comune", "TRATTA_COMUNE"],
        "Tratta_Comune",
        serde_json::json!(tratta.comune),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_Provincia", "TRATTA_PROVINCIA"],
        "Tratta_Provincia",
        serde_json::json!(tratta.provincia),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_Localita", "TRATTA_LOCALITA"],
        "Tratta_Localita",
        serde_json::json!(tratta.localita),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_KmAr", "TRATTA_KMAR"],
        "Tratta_KmAr",
        serde_json::json!(parse_decimal_for_db(&tratta.km)),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_TariffaKm", "TRATTA_TARIFFAKM"],
        "Tratta_TariffaKm",
        serde_json::json!(parse_decimal_for_db(&tratta.costo_km)),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_Pedaggio", "TRATTA_PEDAGGIO"],
        "Tratta_Pedaggio",
        serde_json::json!(parse_decimal_for_db(&tratta.pedaggio)),
    );
    put_field(
        &mut body,
        row,
        &["Tratta_Note", "TRATTA_NOTE"],
        "Tratta_Note",
        serde_json::json!(tratta.note_aggiuntive),
    );

    body
}

fn parse_decimal_for_db(value: &str) -> f64 {
    let cleaned = value
        .trim()
        .replace('€', "")
        .replace(' ', "")
        .replace('.', "")
        .replace(',', ".");
    cleaned.parse::<f64>().unwrap_or(0.0)
}

fn servizio_id_from_row(row: &serde_json::Value) -> u32 {
    get_field_any(
        row,
        &[
            "idservizio",
            "IdServizio",
            "Id_Servizio",
            "IDSERVIZIO",
            "id_servizio",
        ],
    )
    .parse::<u32>()
    .unwrap_or(0)
}

fn servizio_data_raw(row: &serde_json::Value) -> String {
    get_field_any(row, &["Prelievo_Data", "DATA_PRELIEVO", "Data_Prelievo"])
}

fn servizio_data_italiana(row: &serde_json::Value) -> String {
    format_date_sharepoint_rust(&servizio_data_raw(row))
}

/// Filtro PostgREST: servizi con Prelievo_Data nell'anno indicato
fn servizi_filter_anno(anno: u32) -> String {
    format!(
        "Prelievo_Data=gte.{}-01-01&Prelievo_Data=lte.{}-12-31",
        anno, anno
    )
}

/// Null e false restano. I servizi con Archiviazione = true non partono nello scarico.
fn servizi_filter_senza_archiviati(base: &str) -> String {
    format!(
        "{}&or=(Archiviazione.is.null,Archiviazione.eq.false)",
        base
    )
}

fn servizio_e_archiviato(archivia: &str) -> bool {
    matches!(
        archivia.trim().to_lowercase().as_str(),
        "true" | "si" | "sì" | "1" | "yes" | "y" | "s"
    )
}

fn oggi_iso_local() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn domani_iso_local() -> String {
    (Local::now() + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string()
}

/// Solo il giorno corrente (home: servizi del giorno)
fn servizi_filter_solo_oggi() -> String {
    format!(
        "Prelievo_Data=gte.{}&Prelievo_Data=lt.{}",
        oggi_iso_local(),
        domani_iso_local()
    )
}

/// Dalla data odierna in poi (home: niente archivio pregresso)
fn servizi_filter_da_oggi() -> String {
    format!("Prelievo_Data=gte.{}", oggi_iso_local())
}

/// Da domani in poi (home: prossimi servizi)
fn servizi_filter_da_domani() -> String {
    format!("Prelievo_Data=gte.{}", domani_iso_local())
}

/// Servizi creati oggi (home: inseriti oggi)
fn servizi_filter_creati_oggi() -> String {
    format!("created_at=gte.{}", oggi_iso_local())
}

/// Fetch servizi per la home con filtro; se fallisce prova da oggi in poi
async fn fetch_servizi_home(filter_primario: &str) -> Result<Vec<serde_json::Value>, String> {
    match fetch_servizi_supabase(Some(filter_primario)).await {
        Ok(rows) => Ok(rows),
        Err(e) => {
            let fallback = servizi_filter_da_oggi();
            println!(
                "⚠️ Filtro home '{}' fallito ({}), provo '{}'",
                filter_primario, e, fallback
            );
            fetch_servizi_supabase(Some(&fallback)).await
        }
    }
}

fn servizio_ora_prelievo(row: &serde_json::Value) -> String {
    format_time_iso(&get_field_any(
        row,
        &["Prelievo_Ora", "ORA_PRELIEVO", "OraPrelievo", "Ora_Prelievo"],
    ))
}

// Cache nominativi IdSocio → NominativoSocio (evita di riscaricare 900+ tesserati ogni volta)
static NOMINATIVI_CACHE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();

fn nominativi_cache() -> &'static Mutex<Option<HashMap<String, String>>> {
    NOMINATIVI_CACHE.get_or_init(|| Mutex::new(None))
}

fn nominativi_load_lock() -> &'static Mutex<()> {
    static CELL: OnceLock<Mutex<()>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(()))
}

async fn fetch_idsocio_nominativo_map() -> HashMap<String, String> {
    let _load = nominativi_load_lock().lock().await;
    {
        let guard = nominativi_cache().lock().await;
        if let Some(ref map) = *guard {
            return map.clone();
        }
    }

    let mut map = HashMap::new();
    if ensure_supabase_client().await.is_err() {
        return map;
    }
    let guard = get_supabase_client().lock().await;
    if let Some(client) = guard.as_ref() {
        let rows = match client
            .fetch_tesserati(None, Some("id,IdSocio,NominativoSocio"))
            .await
        {
            Ok(r) if !r.is_empty() => r,
            _ => client
                .fetch_tesserati(None, None)
                .await
                .unwrap_or_default(),
        };
        for row in rows {
            let nom = get_field_any(
                &row,
                &[
                    "NominativoSocio",
                    "NOMINATIVOSOCIO",
                    "Nominativo",
                    "nominativo_socio",
                ],
            );
            if nom.is_empty() {
                continue;
            }
            let id_socio = get_field_any(&row, &["IdSocio", "IDSOCIO", "idsocio"]);
            let id_riga = get_field_any(&row, &["id", "Id", "ID"]);
            for key in [id_socio, id_riga] {
                if key.is_empty() {
                    continue;
                }
                map.insert(key.clone(), nom.clone());
                let norm = normalize_idsocio_key(&key);
                if !norm.is_empty() && norm != key {
                    map.insert(norm, nom.clone());
                }
            }
        }
        println!(
            "✓ Mappa nominativi operatori: {} chiavi (IdSocio + id riga)",
            map.len()
        );
    }

    let mut cache = nominativi_cache().lock().await;
    *cache = Some(map.clone());
    map
}

fn normalize_idsocio_key(id: &str) -> String {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .parse::<u64>()
        .map(|n| n.to_string())
        .unwrap_or_else(|_| trimmed.to_string())
}

fn lookup_nominativo_by_idsocio(
    nominativi: &HashMap<String, String>,
    id_raw: &str,
) -> Option<String> {
    let trimmed = id_raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(nom) = nominativi.get(trimmed) {
        return Some(nom.clone());
    }
    let normalized = normalize_idsocio_key(trimmed);
    if normalized.is_empty() {
        return None;
    }
    if let Some(nom) = nominativi.get(&normalized) {
        return Some(nom.clone());
    }
    for (k, v) in nominativi {
        if normalize_idsocio_key(k) == normalized {
            return Some(v.clone());
        }
    }
    None
}

fn nome_operatore_chiave(s: &str) -> String {
    let upper = s.trim().to_uppercase();
    let mut cleaned = String::new();
    for ch in upper.chars() {
        let mapped = match ch {
            'À' | 'Á' | 'Â' | 'Ä' => 'A',
            'È' | 'É' | 'Ê' | 'Ë' => 'E',
            'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
            'Ò' | 'Ó' | 'Ô' | 'Ö' => 'O',
            'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
            '\'' | '`' | '.' | ',' | '-' | '/' => ' ',
            c if c.is_alphanumeric() || c.is_whitespace() => c,
            _ => ' ',
        };
        cleaned.push(mapped);
    }
    let mut tokens: Vec<&str> = cleaned.split_whitespace().collect();
    tokens.sort_unstable();
    tokens.join(" ")
}

fn flag_vero(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "t" | "1" | "si" | "sì" | "s" | "yes" | "y"
    )
}

fn find_colonna_esatta(row: &serde_json::Value, names: &[&str]) -> Option<String> {
    let obj = row.as_object()?;
    for name in names {
        if obj.contains_key(*name) {
            return Some((*name).to_string());
        }
    }
    for name in names {
        let lower = name.to_lowercase();
        for key in obj.keys() {
            if key.to_lowercase() == lower {
                return Some(key.clone());
            }
        }
    }
    None
}

fn allineamento_id_operatore_eseguito() -> &'static Mutex<bool> {
    static CELL: OnceLock<Mutex<bool>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(false))
}

fn tesserati_firma_allineamento() -> &'static Mutex<(usize, usize)> {
    static CELL: OnceLock<Mutex<(usize, usize)>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new((0, 0)))
}

#[derive(Clone)]
struct CandidatoOperatore {
    idsocio: String,
    is_operatore: bool,
    nominativo: String,
}

fn scegli_idsocio_da_nome(
    chiave: &str,
    mappa: &HashMap<String, Vec<CandidatoOperatore>>,
) -> Option<CandidatoOperatore> {
    let candidati = mappa.get(chiave)?;
    if candidati.is_empty() {
        return None;
    }
    let operatori: Vec<&CandidatoOperatore> = candidati.iter().filter(|c| c.is_operatore).collect();
    if operatori.len() == 1 {
        return Some(CandidatoOperatore {
            idsocio: operatori[0].idsocio.clone(),
            is_operatore: true,
            nominativo: operatori[0].nominativo.clone(),
        });
    }
    if operatori.len() > 1 {
        return None;
    }
    if candidati.len() == 1 {
        return Some(CandidatoOperatore {
            idsocio: candidati[0].idsocio.clone(),
            is_operatore: candidati[0].is_operatore,
            nominativo: candidati[0].nominativo.clone(),
        });
    }
    None
}

#[allow(dead_code)]
fn postgrest_eq_filtro(colonna: &str, valore: &str) -> String {
    let escaped = valore.replace('\\', "\\\\").replace('"', "\\\"");
    let quoted = format!("eq.\"{}\"", escaped);
    format!("{}={}", colonna, urlencoding::encode(&quoted))
}

// Controllo su tutti i servizi: non parte più aprendo home o elenco.
// Il numero operatore si sistema solo sulla riga aperta.
#[allow(dead_code)]
async fn allinea_id_operatore_da_oper_una_volta() -> Result<(), String> {
    {
        let mut fatto = allineamento_id_operatore_eseguito().lock().await;
        if *fatto {
            return Ok(());
        }
        *fatto = true;
    }

    let risultato = allinea_id_operatore_da_oper_interno().await;
    if let Err(ref e) = risultato {
        println!("⚠️ Allineamento IdOperatore da Oper: {}", e);
        let mut fatto = allineamento_id_operatore_eseguito().lock().await;
        *fatto = false;
    }
    risultato
}

#[allow(dead_code)]
async fn allinea_id_operatore_da_oper_interno() -> Result<(), String> {
    println!("=== Allineamento IdOperatore da colonna Oper ===");
    ensure_supabase_client().await?;

    let tesserati = {
        let guard = get_supabase_client().lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
        client
            .fetch_tesserati(None, Some("id,IdSocio,NominativoSocio,Operatore"))
            .await
            .map_err(|e| format_supabase_error(&e))?
    };

    let mut mappa: HashMap<String, Vec<CandidatoOperatore>> = HashMap::new();
    for row in &tesserati {
        let nominativo = get_field_any(
            row,
            &[
                "NominativoSocio",
                "NOMINATIVOSOCIO",
                "Nominativo",
                "nominativo_socio",
            ],
        );
        let chiave = nome_operatore_chiave(&nominativo);
        if chiave.is_empty() {
            continue;
        }
        let idsocio = normalize_idsocio_key(&get_field_any(row, &["IdSocio", "IDSOCIO", "idsocio"]));
        if idsocio.is_empty() {
            continue;
        }
        let is_operatore = flag_vero(&get_bool_field(
            row,
            &["Operatore", "OPERATORE", "operatore"],
        ));
        mappa.entry(chiave).or_default().push(CandidatoOperatore {
            idsocio,
            is_operatore,
            nominativo,
        });
    }

    let servizi = fetch_servizi_supabase(None).await?;
    if servizi.is_empty() {
        println!("⚠️ Allineamento: nessun servizio trovato");
        return Ok(());
    }

    let col_oper = find_colonna_esatta(&servizi[0], &["Oper", "OPER", "oper"]);
    let col_id = find_colonna_esatta(
        &servizi[0],
        &["IdOperatore", "IDOPERATORE", "Id_Operatore", "idoperatore"],
    );
    let mut keys: Vec<&String> = servizi[0]
        .as_object()
        .map(|o| o.keys().collect())
        .unwrap_or_default();
    keys.sort();
    println!(
        "  colonne servizi: {} — Oper={:?} IdOperatore={:?}",
        keys.len(),
        col_oper,
        col_id
    );

    let Some(col_oper) = col_oper else {
        println!("⚠️ Colonna Oper non trovata dopo il reimport. Colonne: {:?}", keys);
        let mut fatto = allineamento_id_operatore_eseguito().lock().await;
        *fatto = false;
        return Ok(());
    };
    let col_id = col_id.unwrap_or_else(|| "IdOperatore".to_string());

    let mut con_oper = 0usize;
    let mut gia_ok = 0usize;
    let mut da_aggiornare: HashMap<String, (String, String, usize)> = HashMap::new();
    let mut non_trovati: HashMap<String, usize> = HashMap::new();
    let mut esempi: Vec<String> = Vec::new();

    for row in &servizi {
        let oper = get_field_any(row, &["Oper", "OPER", "oper"]);
        let trimmed = oper.trim();
        if trimmed.is_empty() || trimmed.parse::<i64>().is_ok() {
            continue;
        }
        con_oper += 1;
        if esempi.len() < 8 {
            esempi.push(format!(
                "Oper='{}' IdOperatore='{}'",
                trimmed,
                get_field_any(row, &["IdOperatore", "IDOPERATORE", "Id_Operatore"])
            ));
        }
        let chiave = nome_operatore_chiave(trimmed);
        let Some(candidato) = scegli_idsocio_da_nome(&chiave, &mappa) else {
            *non_trovati.entry(trimmed.to_string()).or_insert(0) += 1;
            continue;
        };
        let id_attuale = normalize_idsocio_key(&get_field_any(
            row,
            &["IdOperatore", "IDOPERATORE", "Id_Operatore"],
        ));
        if id_attuale == candidato.idsocio {
            gia_ok += 1;
            continue;
        }
        let entry = da_aggiornare
            .entry(trimmed.to_string())
            .or_insert((candidato.idsocio.clone(), candidato.nominativo.clone(), 0));
        entry.2 += 1;
    }

    println!(
        "  servizi con nome in Oper: {} / {} — già allineati: {} — da aggiornare: {} nomi",
        con_oper,
        servizi.len(),
        gia_ok,
        da_aggiornare.len()
    );
    for es in &esempi {
        println!("    es. {}", es);
    }

    let mut aggiornati = 0usize;
    let mut errori = 0usize;
    for (oper_nome, (idsocio, nominativo, quanti)) in &da_aggiornare {
        let id_num: i64 = match idsocio.parse() {
            Ok(n) => n,
            Err(_) => {
                println!("  ⚠️ IdSocio non numerico per '{}': {}", oper_nome, idsocio);
                errori += 1;
                continue;
            }
        };
        let mut body = serde_json::Map::new();
        body.insert(col_id.clone(), serde_json::json!(id_num));
        let filtro = postgrest_eq_filtro(&col_oper, oper_nome);
        let patch_ok = {
            let guard = get_supabase_client().lock().await;
            match guard.as_ref() {
                Some(client) => client.patch_servizi_filtro(&filtro, &body).await,
                None => Err("Client Supabase non disponibile".to_string()),
            }
        };
        match patch_ok {
            Ok(()) => {
                aggiornati += *quanti;
                println!(
                    "  ✓ {} servizi: Oper='{}' → IdOperatore={} ({})",
                    quanti, oper_nome, idsocio, nominativo
                );
            }
            Err(e) => {
                errori += 1;
                println!("  ❌ PATCH Oper='{}': {}", oper_nome, e);
            }
        }
    }

    let mut non_trovati_list: Vec<(String, usize)> = non_trovati.into_iter().collect();
    non_trovati_list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    if !non_trovati_list.is_empty() {
        println!(
            "  ℹ️ {} nomi in Oper non ancora in anagrafica tesserati (si allineeranno dopo l'aggiornamento):",
            non_trovati_list.len()
        );
        for (nome, n) in non_trovati_list.iter().take(15) {
            println!("    - '{}' ({} servizi)", nome, n);
        }
    }

    println!(
        "✓ Allineamento IdOperatore terminato: {} servizi aggiornati, {} già ok, {} errori",
        aggiornati, gia_ok, errori
    );

    if errori > 0 {
        let mut fatto = allineamento_id_operatore_eseguito().lock().await;
        *fatto = false;
    }
    Ok(())
}

fn mappa_candidati_operatore_cache(
) -> &'static Mutex<Option<HashMap<String, Vec<CandidatoOperatore>>>> {
    static CELL: OnceLock<Mutex<Option<HashMap<String, Vec<CandidatoOperatore>>>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

/// Nome operatore → soci candidati. Si scarica una volta per sessione, solo se serve.
async fn mappa_candidati_operatore() -> Result<HashMap<String, Vec<CandidatoOperatore>>, String> {
    {
        let guard = mappa_candidati_operatore_cache().lock().await;
        if let Some(ref map) = *guard {
            return Ok(map.clone());
        }
    }

    ensure_supabase_client().await?;
    let tesserati = {
        let guard = get_supabase_client().lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
        client
            .fetch_tesserati(None, Some("id,IdSocio,NominativoSocio,Operatore"))
            .await
            .map_err(|e| format_supabase_error(&e))?
    };

    let mut mappa: HashMap<String, Vec<CandidatoOperatore>> = HashMap::new();
    for row in &tesserati {
        let nominativo = get_field_any(
            row,
            &[
                "NominativoSocio",
                "NOMINATIVOSOCIO",
                "Nominativo",
                "nominativo_socio",
            ],
        );
        let chiave = nome_operatore_chiave(&nominativo);
        if chiave.is_empty() {
            continue;
        }
        let idsocio = normalize_idsocio_key(&get_field_any(row, &["IdSocio", "IDSOCIO", "idsocio"]));
        if idsocio.is_empty() {
            continue;
        }
        let is_operatore = flag_vero(&get_bool_field(
            row,
            &["Operatore", "OPERATORE", "operatore"],
        ));
        mappa.entry(chiave).or_default().push(CandidatoOperatore {
            idsocio,
            is_operatore,
            nominativo,
        });
    }

    let mut cache = mappa_candidati_operatore_cache().lock().await;
    *cache = Some(mappa.clone());
    Ok(mappa)
}

/// Sistema IdOperatore solo sulla riga aperta, se in Oper c'è un nome e il numero non coincide.
async fn allinea_id_operatore_riga(row: &mut serde_json::Value) {
    let oper = get_field_any(row, &["Oper", "OPER", "oper"]);
    let trimmed = oper.trim();
    if trimmed.is_empty() || trimmed.parse::<i64>().is_ok() {
        return;
    }
    let chiave = nome_operatore_chiave(trimmed);
    if chiave.is_empty() {
        return;
    }

    let id_attuale = normalize_idsocio_key(&get_field_any(
        row,
        &["IdOperatore", "IDOPERATORE", "Id_Operatore"],
    ));
    if !id_attuale.is_empty() {
        let nominativi = fetch_idsocio_nominativo_map().await;
        if let Some(nom) = lookup_nominativo_by_idsocio(&nominativi, &id_attuale) {
            if nome_operatore_chiave(&nom) == chiave {
                return;
            }
        }
    }

    let mappa = match mappa_candidati_operatore().await {
        Ok(m) => m,
        Err(e) => {
            println!("⚠️ Allineamento servizio aperto: {}", e);
            return;
        }
    };
    let Some(candidato) = scegli_idsocio_da_nome(&chiave, &mappa) else {
        println!(
            "ℹ️ Servizio {}: operatore '{}' non univoco in anagrafica, IdOperatore non aggiornato",
            servizio_id_from_row(row),
            trimmed
        );
        return;
    };
    if id_attuale == candidato.idsocio {
        return;
    }
    let id_num: i64 = match candidato.idsocio.parse() {
        Ok(n) => n,
        Err(_) => {
            println!(
                "⚠️ IdSocio non numerico per '{}': {}",
                trimmed, candidato.idsocio
            );
            return;
        }
    };
    let id_servizio = servizio_id_from_row(row);
    if id_servizio == 0 {
        return;
    }
    let col_id = find_colonna_esatta(
        row,
        &["IdOperatore", "IDOPERATORE", "Id_Operatore", "idoperatore"],
    )
    .unwrap_or_else(|| "IdOperatore".to_string());

    let mut body = serde_json::Map::new();
    body.insert(col_id.clone(), serde_json::json!(id_num));

    let patch = {
        if ensure_supabase_client().await.is_err() {
            println!("⚠️ Allineamento servizio {}: Supabase non disponibile", id_servizio);
            return;
        }
        let guard = get_supabase_client().lock().await;
        match guard.as_ref() {
            Some(client) => client.patch_servizio(id_servizio, &body).await,
            None => Err("Client Supabase non disponibile".to_string()),
        }
    };
    match patch {
        Ok(()) => {
            println!(
                "✓ Servizio {}: Oper='{}' → IdOperatore={} ({})",
                id_servizio, trimmed, id_num, candidato.nominativo
            );
            if let Some(obj) = row.as_object_mut() {
                obj.insert(col_id, serde_json::json!(id_num));
            }
        }
        Err(e) => println!("⚠️ PATCH servizio {}: {}", id_servizio, e),
    }
}

fn resolve_operatore_nome(row: &serde_json::Value, nominativi: &HashMap<String, String>) -> String {
    // Il nome in Oper è la fonte più affidabile dopo un reimport:
    // IdOperatore può ancora puntare a un id vecchio (es. 44 → altra persona).
    let oper_text = get_field_any(row, &["Oper", "OPER", "Operatore"]);
    let trimmed = oper_text.trim();
    if !trimmed.is_empty() && trimmed.parse::<i64>().is_err() {
        return oper_text;
    }
    let id_op = get_field_any(row, &["IdOperatore", "IDOPERATORE", "Id_Operatore"]);
    if !id_op.is_empty() {
        if let Some(nom) = lookup_nominativo_by_idsocio(nominativi, &id_op) {
            return nom;
        }
    }
    oper_text
}

fn resolve_trasportato_nome(row: &serde_json::Value, nominativi: &HashMap<String, String>) -> String {
    let diretto = get_field_any(row, &["Trasportato", "TRASP", "Trasp"]);
    if !diretto.trim().is_empty() {
        return diretto;
    }
    let id = get_field_any(row, &["IdSocio", "IDSOCIO"]);
    lookup_nominativo_by_idsocio(nominativi, &id).unwrap_or_default()
}

fn normalize_mezzo_key(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        return String::new();
    }
    let cleaned = if t.ends_with(".0") {
        &t[..t.len().saturating_sub(2)]
    } else {
        t
    };
    cleaned
        .parse::<u64>()
        .map(|n| n.to_string())
        .unwrap_or_else(|_| cleaned.to_uppercase())
}

fn iso_date_to_italiana(iso: &str) -> Option<String> {
    let s = iso.trim();
    let date_part = if s.len() >= 10 { &s[..10] } else { s };
    let parts: Vec<&str> = date_part.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    Some(format!("{}/{}/{}", parts[2], parts[1], parts[0]))
}

fn next_day_iso(iso: &str) -> Option<String> {
    let date_part = if iso.len() >= 10 { &iso[..10] } else { iso };
    let d = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
    Some((d + chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
}

fn parse_italian_date(date_str: &str) -> Option<chrono::NaiveDate> {
    if date_str.is_empty() {
        return None;
    }
    chrono::NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()
}

fn get_bool_from_row(row: &serde_json::Value, names: &[&str]) -> bool {
    for name in names {
        if let Some(v) = row.get(*name) {
            if let Some(b) = v.as_bool() {
                if b {
                    return true;
                }
            } else if let Some(s) = v.as_str() {
                let u = s.to_uppercase();
                if u == "TRUE" || u == "1" || u == "SI" || u == "SÌ" {
                    return true;
                }
            } else if let Some(n) = v.as_number() {
                if n.as_f64().unwrap_or(0.0) != 0.0 {
                    return true;
                }
            }
        }
    }
    false
}

fn build_tipo_servizio_row(row: &serde_json::Value) -> String {
    if get_bool_from_row(row, &["Sollevatore", "SOLLEVATORE"]) {
        return "SOLLEVATORE".to_string();
    }
    if get_bool_from_row(row, &["Standard", "STANDARD"]) {
        return "STANDARD".to_string();
    }
    let tipo = get_field_any(row, &["Tipo_Servizio", "TIPO_SERVIZIO", "TipoServizio"]);
    if !tipo.is_empty() {
        return tipo.to_uppercase();
    }
    String::new()
}

fn build_tempo_row(row: &serde_json::Value) -> String {
    // TEMPO_ORE (SharePoint) → Tempo (Supabase, tipo time)
    let tempo = get_field_any(row, &["Tempo", "TEMPO", "TEMPO_ORE", "Tempo_Ore"]);
    let formatted = format_time_iso(&tempo);
    if !formatted.is_empty() {
        return formatted;
    }
    // Fallback legacy: ore + minuti separati
    let tempo_ore = get_field_any(row, &["Tempo_Ore", "TEMPO_ORE"]);
    let tempo_minuti = get_field_any(row, &["Tempo_Minuti", "TEMPO_MINUTI"]);
    let ore_num = tempo_ore.trim().parse::<u32>().unwrap_or(0);
    let minuti_num = tempo_minuti.trim().parse::<u32>().unwrap_or(0);
    if ore_num > 0 || minuti_num > 0 {
        return format!("{:02}:{:02}", ore_num, minuti_num);
    }
    String::new()
}

fn supabase_row_to_servizio(
    row: &serde_json::Value,
    nominativi: &HashMap<String, String>,
) -> Option<Servizio> {
    let id = servizio_id_from_row(row);
    if id == 0 {
        return None;
    }
    Some(Servizio {
        id,
        operatore: resolve_operatore_nome(row, nominativi),
        data: servizio_data_italiana(row),
        nominativo: get_field_any(row, &["Trasportato", "TRASP", "Trasp"]),
        ora_sotto_casa: servizio_ora_prelievo(row),
        ora_destinazione: format_date_iso(&get_field_any(
            row,
            &["Destinazione_Data", "DATA_DESTINAZIONE", "Data_Destinazione"],
        )),
        tipo_servizio: get_field_any(row, &["Motivazione", "MOTIVAZIONE"]),
    })
}

fn supabase_row_to_servizio_completo(
    row: &serde_json::Value,
    nominativi: &HashMap<String, String>,
) -> Option<ServizioCompleto> {
    let id = servizio_id_from_row(row);
    if id == 0 {
        return None;
    }

    let data_bonifico_raw =
        get_field_any(row, &["Bonifico_Data", "DATABONIFICO", "DataBonifico"]);
    let data_ricevuta_raw =
        get_field_any(row, &["Ricevuta_Data", "DATARICEVUTA", "DataRicevuta"]);
    let donazioni_raw = get_field_any(row, &["Donazioni", "DONAZIONI"]);
    let incassato = get_field_any(row, &["Incassato", "INCASSATO"]);

    Some(ServizioCompleto {
        id: id.to_string(),
        data_prelievo: servizio_data_italiana(row),
        idsocio: get_field_any(row, &["IdSocio", "IDSOCIO"]),
        socio_trasportato: get_field_any(row, &["Trasportato", "TRASP", "Trasp"]),
        ora_inizio: servizio_ora_prelievo(row),
        comune_prelievo: get_field_any(row, &["Prelievo_Comune", "PRELIEVO_COMUNE"]),
        luogo_prelievo: get_field_any(row, &["Prelievo_Indirizzo", "PRELIEVO_INDIRIZZO"]),
        tipo_servizio: build_tipo_servizio_row(row),
        carrozzina: get_field_any(row, &["Carrozzina", "CARROZZINA"]),
        richiedente: get_field_any(row, &["Richiedente", "RICHIEDENTE"]),
        motivazione: get_field_any(row, &["Motivazione", "MOTIVAZIONE"]),
        ora_arrivo: format_date_iso(&get_field_any(
            row,
            &["Destinazione_Data", "DATA_DESTINAZIONE"],
        )),
        comune_destinazione: get_field_any(row, &["Destinazione_Comune", "DESTINAZIONE_COMUNE"]),
        luogo_destinazione: get_field_any(
            row,
            &["Destinazione_Indirizzo", "DESTINAZIONE_INDIRIZZO"],
        ),
        pagamento: format_euro_italiano(&donazioni_raw),
        stato_incasso: if incassato.is_empty() {
            "DA INCASSARE".to_string()
        } else {
            incassato
        },
        operatore: resolve_operatore_nome(row, nominativi),
        operatore_2: {
            let raw = get_field_any(row, &["Oper2", "OPER2", "operatore_2", "IdOperatore2"]);
            if raw.is_empty() {
                String::new()
            } else if let Some(nom) = lookup_nominativo_by_idsocio(nominativi, &raw) {
                nom
            } else {
                raw
            }
        },
        id_operatore: get_field_any(row, &["IdOperatore", "IDOPERATORE", "Id_Operatore"]),
        id_operatore_2: {
            let id2 = get_field_any(row, &["IdOperatore2", "IDOPERATORE2", "Id_Operatore_2"]);
            if !id2.is_empty() {
                id2
            } else {
                let raw = get_field_any(row, &["Oper2", "OPER2"]);
                if raw.trim().parse::<u64>().is_ok() {
                    raw
                } else {
                    String::new()
                }
            }
        },
        operatore_testo: get_field_any(row, &["Oper", "OPER", "Operatore"]),
        mezzo_usato: String::new(),
        mezzo: get_field_any(row, &["Mezzo", "MEZZO"]),
        tempo: build_tempo_row(row),
        km: get_field_any(row, &["Km", "KM"]),
        km_uscita: get_field_any(
            row,
            &[
                "Km_uscita",
                "KM_USCITA",
                "km_uscita",
                "KmUscita",
                "Km_Partenza",
                "KM_PARTENZA",
                "km_partenza",
                "Chiusura_Km_Partenza",
            ],
        ),
        km_rientro: get_field_any(
            row,
            &[
                "Km_rientro",
                "KM_RIENTRO",
                "km_rientro",
                "KmRientro",
                "Km_Arrivo",
                "KM_ARRIVO",
                "km_arrivo",
                "Chiusura_Km_Arrivo",
            ],
        ),
        tipo_pagamento: get_field_any(row, &["TipoPagamento", "TIPOPAGAMENTO"]),
        data_bonifico: format_date_sharepoint_rust(&data_bonifico_raw),
        data_ricevuta: format_date_sharepoint_rust(&data_ricevuta_raw),
        numero_ricevuta: get_field_any(
            row,
            &[
                "Ricevuta_numero",
                "Ricevuta_Numero",
                "RICEVUTA_NUMERO",
                "NumeroRicevuta",
                "Numero_Ricevuta",
                "ricevuta_numero",
            ],
        ),
        stato_servizio: get_field_any(
            row,
            &[
                "StatoServizio",
                "STATOSERVIZIO",
                "stato_servizio",
                "Stato_Servizio",
                "STATO_SERVIZIO",
                "Stato_Del_Servizio",
                "StatoDelServizio",
            ],
        ),
        note_prelievo: get_field_any(row, &["Prelievo_Note", "PRELIEVO_NOTE"]),
        note_arrivo: get_field_any(row, &["Destinazione_Note", "DESTINAZIONE_NOTE"]),
        note_fine_servizio: get_field_any(
            row,
            &["NoteFineServizio", "NOTAFINESERVIZIO", "NOTE_FINE_SERVIZIO"],
        ),
        archivia: get_bool_field(row, &["Archiviazione", "ARCHIVIAZIONE", "archiviazione"]),
        creato_da: get_field_any(
            row,
            &["CreatoDa", "creato_da", "Creato_Da", "CREATODA"],
        ),
        modificato_da: get_field_any(
            row,
            &[
                "ModificatoDa",
                "modificato_da",
                "Modificato_Da",
                "MODIFICATODA",
            ],
        ),
        created_at: get_field_any(
            row,
            &[
                "created_at",
                "Created_At",
                "Created",
                "created",
                "CREATED",
            ],
        ),
        updated_at: get_field_any(
            row,
            &[
                "update_at",
                "Update_At",
                "updated_at",
                "Updated_At",
                "Updated",
                "updated",
                "UPDATED",
                "modificated",
                "Modificated",
                "modified",
                "Modified",
            ],
        ),
    })
}

/// Ordina servizi home per data prelievo crescente, poi ora sotto casa crescente
fn sort_servizi_crescente(servizi: &mut [Servizio]) {
    use chrono::NaiveTime;

    servizi.sort_by(|a, b| {
        let parse_time = |time_str: &str| -> Option<NaiveTime> {
            NaiveTime::parse_from_str(time_str, "%H:%M")
                .ok()
                .or_else(|| NaiveTime::parse_from_str(time_str, "%H:%M:%S").ok())
        };

        let date_a = parse_italian_date(&a.data);
        let date_b = parse_italian_date(&b.data);

        match (date_a, date_b) {
            (Some(da), Some(db)) => match da.cmp(&db) {
                std::cmp::Ordering::Equal => {
                    let time_a = parse_time(&a.ora_sotto_casa);
                    let time_b = parse_time(&b.ora_sotto_casa);
                    match (time_a, time_b) {
                        (Some(ta), Some(tb)) => ta.cmp(&tb),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (None, None) => std::cmp::Ordering::Equal,
                    }
                }
                other => other,
            },
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });
}

fn sort_servizi_completi(servizi: &mut [ServizioCompleto]) {
    use chrono::{NaiveDate, NaiveTime};

    servizi.sort_by(|a, b| {
        let parse_date = |date_str: &str| -> Option<NaiveDate> {
            parse_italian_date(date_str)
        };
        let parse_time = |time_str: &str| -> Option<NaiveTime> {
            NaiveTime::parse_from_str(time_str, "%H:%M")
                .ok()
                .or_else(|| NaiveTime::parse_from_str(time_str, "%H:%M:%S").ok())
        };

        let date_a = parse_date(&a.data_prelievo);
        let date_b = parse_date(&b.data_prelievo);

        match (date_a, date_b) {
            (Some(da), Some(db)) => match db.cmp(&da) {
                std::cmp::Ordering::Equal => {
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
            },
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });
}

// Comando per ottenere servizi del giorno (Supabase / Servizi_supa)
#[tauri::command]
async fn get_servizi_giorno() -> Result<Vec<Servizio>, String> {
    println!("=== get_servizi_giorno chiamato (Supabase, solo oggi) ===");

    let filter = servizi_filter_solo_oggi();
    let rows = fetch_servizi_home(&filter).await?;
    let nominativi = fetch_idsocio_nominativo_map().await;
    let oggi_iso = oggi_iso_local();
    let oggi_italiano = format!(
        "{:02}/{:02}/{}",
        Local::now().day(),
        Local::now().month(),
        Local::now().year()
    );

    let mut servizi: Vec<Servizio> = rows
        .iter()
        .filter_map(|row| {
            let raw = servizio_data_raw(row);
            let stessa_data =
                raw.starts_with(&oggi_iso) || servizio_data_italiana(row) == oggi_italiano;
            if !stessa_data {
                return None;
            }
            supabase_row_to_servizio(row, &nominativi)
        })
        .collect();

    sort_servizi_crescente(&mut servizi);

    println!(
        "✓ Trovati {} servizi del giorno ({}) da Supabase",
        servizi.len(),
        oggi_italiano
    );
    Ok(servizi)
}

/// Servizi di un solo giorno, per il report giornaliero (non scarica l'anno intero).
#[tauri::command]
async fn get_servizi_report_giorno(data: String) -> Result<Vec<ServizioCompleto>, String> {
    let trimmed = data.trim();
    let iso = if trimmed.contains('/') {
        italian_date_to_iso(trimmed).ok_or_else(|| format!("Data non valida: {}", trimmed))?
    } else if trimmed.len() >= 10 {
        trimmed[..10].to_string()
    } else {
        return Err(format!("Data non valida: {}", trimmed));
    };
    let giorno_dopo = next_day_iso(&iso).ok_or_else(|| format!("Data non valida: {}", iso))?;
    let data_it = iso_date_to_italiana(&iso).unwrap_or_default();
    println!("=== get_servizi_report_giorno {} ===", data_it);

    let filter = format!(
        "Prelievo_Data=gte.{}&Prelievo_Data=lt.{}",
        iso, giorno_dopo
    );
    let rows = fetch_servizi_home(&filter).await?;
    let nominativi = fetch_idsocio_nominativo_map().await;

    let mut servizi: Vec<ServizioCompleto> = rows
        .iter()
        .filter_map(|row| {
            let raw = servizio_data_raw(row);
            let stessa_data = raw.starts_with(&iso) || servizio_data_italiana(row) == data_it;
            if !stessa_data {
                return None;
            }
            supabase_row_to_servizio_completo(row, &nominativi)
        })
        .collect();

    servizi.sort_by(|a, b| a.ora_inizio.cmp(&b.ora_inizio));
    println!("✓ Report giorno {}: {} servizi", data_it, servizi.len());
    Ok(servizi)
}

/// Servizi da lunedì a domenica, per il report settimanale (non scarica l'anno intero).
#[tauri::command]
async fn get_servizi_report_settimana(dal: String, al: String) -> Result<Vec<ServizioCompleto>, String> {
    let iso_dal = italian_date_to_iso(dal.trim())
        .ok_or_else(|| format!("Data iniziale non valida: {}", dal.trim()))?;
    let iso_al = italian_date_to_iso(al.trim())
        .ok_or_else(|| format!("Data finale non valida: {}", al.trim()))?;
    let iso_fine = next_day_iso(&iso_al)
        .ok_or_else(|| format!("Data finale non valida: {}", al.trim()))?;
    println!(
        "=== get_servizi_report_settimana {} → {} ===",
        dal.trim(),
        al.trim()
    );

    let filter = format!(
        "Prelievo_Data=gte.{}&Prelievo_Data=lt.{}",
        iso_dal, iso_fine
    );
    let rows = fetch_servizi_home(&filter).await?;
    let nominativi = fetch_idsocio_nominativo_map().await;

    let mut servizi: Vec<ServizioCompleto> = rows
        .iter()
        .filter_map(|row| {
            let raw = servizio_data_raw(row);
            let iso_riga = if raw.len() >= 10 && raw.as_bytes().get(4) == Some(&b'-') {
                raw[..10].to_string()
            } else {
                italian_date_to_iso(&servizio_data_italiana(row)).unwrap_or_default()
            };
            if iso_riga.as_str() < iso_dal.as_str() || iso_riga.as_str() >= iso_fine.as_str() {
                return None;
            }
            supabase_row_to_servizio_completo(row, &nominativi)
        })
        .collect();

    println!(
        "✓ Report settimana {}–{}: {} servizi",
        dal.trim(),
        al.trim(),
        servizi.len()
    );
    Ok(servizi)
}

/// Servizi che usano già il mezzo indicato nella data di prelievo (info per Nuovo/Modifica Servizio)
#[tauri::command]
async fn get_servizi_mezzo_nella_data(
    mezzo: String,
    data_prelievo: String,
    escludi_id_servizio: Option<u32>,
) -> Result<Vec<ServizioMezzoOccupato>, String> {
    println!(
        "=== get_servizi_mezzo_nella_data mezzo='{}' data='{}' escludi={:?} ===",
        mezzo, data_prelievo, escludi_id_servizio
    );

    let mezzo_key = normalize_mezzo_key(&mezzo);
    if mezzo_key.is_empty() {
        return Ok(Vec::new());
    }

    let data_iso = data_prelievo.trim();
    if data_iso.len() < 10 {
        return Ok(Vec::new());
    }
    let data_iso = &data_iso[..10];
    let data_it = match iso_date_to_italiana(data_iso) {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };
    let giorno_dopo = next_day_iso(data_iso).unwrap_or_else(|| data_iso.to_string());

    let filter = format!(
        "Prelievo_Data=gte.{}&Prelievo_Data=lt.{}",
        data_iso, giorno_dopo
    );

    let rows = match fetch_servizi_supabase(Some(&filter)).await {
        Ok(rows) => rows,
        Err(e) => {
            println!(
                "⚠️ Filtro giorno fallito ({}), provo eq.{}",
                e, data_iso
            );
            let filter_eq = format!("Prelievo_Data=eq.{}", data_iso);
            fetch_servizi_supabase(Some(&filter_eq)).await?
        }
    };

    let nominativi = fetch_idsocio_nominativo_map().await;

    let mut servizi: Vec<ServizioMezzoOccupato> = rows
        .iter()
        .filter(|row| {
            if let Some(escludi) = escludi_id_servizio {
                if servizio_id_from_row(row) == escludi {
                    return false;
                }
            }
            let raw = servizio_data_raw(row);
            let stessa_data =
                raw.starts_with(data_iso) || servizio_data_italiana(row) == data_it;
            if !stessa_data {
                return false;
            }
            let m = normalize_mezzo_key(&get_field_any(row, &["Mezzo", "MEZZO"]));
            m == mezzo_key
        })
        .map(|row| ServizioMezzoOccupato {
            ora: servizio_ora_prelievo(row),
            operatore: resolve_operatore_nome(row, &nominativi),
            trasportato: resolve_trasportato_nome(row, &nominativi),
            comune_destinazione: get_field_any(
                row,
                &["Destinazione_Comune", "DESTINAZIONE_COMUNE"],
            ),
            luogo_destinazione: get_field_any(
                row,
                &["Destinazione_Indirizzo", "DESTINAZIONE_INDIRIZZO"],
            ),
        })
        .collect();

    servizi.sort_by(|a, b| a.ora.cmp(&b.ora));

    println!(
        "✓ Mezzo {} usato in {} servizi il {}",
        mezzo_key,
        servizi.len(),
        data_it
    );
    Ok(servizi)
}

fn normalizza_luogo_dest(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

fn servizio_chiave_ord_prelievo(row: &serde_json::Value) -> String {
    let raw = servizio_data_raw(row);
    let data = raw.trim();
    let iso = if data.len() >= 10 && data.as_bytes().get(4) == Some(&b'-') {
        data[..10].to_string()
    } else {
        italian_date_to_iso(data).unwrap_or_else(|| data.to_string())
    };
    format!("{} {}", iso, servizio_ora_prelievo(row))
}

/// Ultimi servizi già registrati verso lo stesso luogo di destinazione (popup Nuovo Servizio)
#[tauri::command]
async fn get_servizi_stesso_luogo_destinazione(
    luogo_destinazione: String,
) -> Result<Vec<ServizioStessoLuogoDest>, String> {
    let luogo = luogo_destinazione.trim();
    if luogo.is_empty() {
        return Ok(Vec::new());
    }
    let luogo_norm = normalizza_luogo_dest(luogo);
    if luogo_norm.is_empty() {
        return Ok(Vec::new());
    }

    println!(
        "=== get_servizi_stesso_luogo_destinazione luogo='{}' ===",
        luogo
    );

    let limite = fetch_limite_ultimi_servizi_popup().await;
    let fetch_limit = limite.saturating_mul(8).clamp(limite.max(10), 200);

    let colonne = ["Destinazione_Indirizzo", "DESTINAZIONE_INDIRIZZO"];
    let ordini = ["Prelievo_Data.desc", "DATA_PRELIEVO.desc"];

    let mut rows: Vec<serde_json::Value> = Vec::new();
    let mut last_err: Option<String> = None;
    'outer: for colonna in &colonne {
        for ordine in &ordini {
            match fetch_servizi_ilike_colonna(colonna, luogo, ordine, fetch_limit).await {
                Ok(r) => {
                    rows = r;
                    break 'outer;
                }
                Err(e) => last_err = Some(e),
            }
        }
    }

    if rows.is_empty() {
        if let Some(e) = last_err {
            println!("⚠️ get_servizi_stesso_luogo_destinazione: {}", e);
        }
    }

    let nominativi = fetch_idsocio_nominativo_map().await;

    let mut servizi: Vec<(String, ServizioStessoLuogoDest)> = rows
        .iter()
        .filter(|row| {
            let dest = get_field_any(
                row,
                &["Destinazione_Indirizzo", "DESTINAZIONE_INDIRIZZO"],
            );
            normalizza_luogo_dest(&dest) == luogo_norm
        })
        .map(|row| {
            let donazioni_raw = get_field_any(row, &["Donazioni", "DONAZIONI"]);
            let item = ServizioStessoLuogoDest {
                data_prelievo: servizio_data_italiana(row),
                comune_prelievo: get_field_any(
                    row,
                    &["Prelievo_Comune", "PRELIEVO_COMUNE"],
                ),
                luogo_prelievo: get_field_any(
                    row,
                    &["Prelievo_Indirizzo", "PRELIEVO_INDIRIZZO"],
                ),
                trasportato: resolve_trasportato_nome(row, &nominativi),
                donazione: format_euro_italiano(&donazioni_raw),
            };
            (servizio_chiave_ord_prelievo(row), item)
        })
        .collect();

    servizi.sort_by(|a, b| b.0.cmp(&a.0));
    servizi.truncate(limite);

    let result: Vec<ServizioStessoLuogoDest> = servizi.into_iter().map(|(_, s)| s).collect();
    println!(
        "✓ Trovati {} servizi verso '{}' (limite impostazione={}, righe supabase={})",
        result.len(),
        luogo,
        limite,
        rows.len()
    );
    Ok(result)
}

// Comando per ottenere prossimi servizi (Supabase / Servizi_supa)
#[tauri::command]
async fn get_prossimi_servizi() -> Result<Vec<Servizio>, String> {
    println!("=== get_prossimi_servizi chiamato (Supabase, da domani in poi) ===");

    let filter = servizi_filter_da_domani();
    let rows = fetch_servizi_home(&filter).await?;
    let nominativi = fetch_idsocio_nominativo_map().await;
    let domani = Local::now() + chrono::Duration::days(1);
    let domani_date = chrono::NaiveDate::from_ymd_opt(domani.year(), domani.month(), domani.day())
        .ok_or_else(|| "Errore calcolo data domani".to_string())?;

    let mut servizi: Vec<Servizio> = rows
        .iter()
        .filter_map(|row| {
            let s = supabase_row_to_servizio(row, &nominativi)?;
            parse_italian_date(&s.data)
                .filter(|d| *d >= domani_date)
                .map(|_| s)
        })
        .collect();

    sort_servizi_crescente(&mut servizi);

    println!("✓ Trovati {} prossimi servizi da Supabase", servizi.len());
    Ok(servizi)
}

// Comando per ottenere servizi inseriti oggi (Supabase / Servizi_supa)
#[tauri::command]
async fn get_servizi_inseriti_oggi() -> Result<Vec<Servizio>, String> {
    println!("=== get_servizi_inseriti_oggi chiamato (Supabase, creati oggi) ===");

    let filter = servizi_filter_creati_oggi();
    let rows = match fetch_servizi_supabase(Some(&filter)).await {
        Ok(rows) => rows,
        Err(e) => {
            // Se created_at non è filtrabile, limita almeno ai prelievi da oggi in poi
            println!(
                "⚠️ Filtro created_at fallito ({}), uso Prelievo_Data da oggi",
                e
            );
            let fallback = servizi_filter_da_oggi();
            fetch_servizi_home(&fallback).await?
        }
    };
    let nominativi = fetch_idsocio_nominativo_map().await;
    let oggi_iso = oggi_iso_local();

    let servizi: Vec<Servizio> = rows
        .iter()
        .filter_map(|row| {
            let created = get_field_any(
                row,
                &["created_at", "Created_At", "DataInserimento", "Data_Inserimento"],
            );
            if created.starts_with(&oggi_iso) || created.contains(&oggi_iso) {
                supabase_row_to_servizio(row, &nominativi)
            } else {
                None
            }
        })
        .collect();

    println!("✓ Trovati {} servizi inseriti oggi da Supabase", servizi.len());
    Ok(servizi)
}

// Comando per ottenere tessere da fare (da Supabase, filtro TipologiaSocio)
#[tauri::command]
async fn get_tessere_da_fare() -> Result<Vec<Tessera>, String> {
    println!("=== get_tessere_da_fare chiamato ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;

    if let Some(client) = client_guard.as_ref() {
        let filter = "TipologiaSocio=in.(NUOVO,ESTERNO)";
        let rows = match client.fetch_tesserati(Some(filter), None).await {
            Ok(rows) => rows,
            Err(e) => {
                println!("⚠️ Filtro Supabase fallito, recupero tutti i tesserati: {}", e);
                client
                    .fetch_tesserati(None, None)
                    .await
                    .map_err(|e2| format_supabase_error(&e2))?
            }
        };

        let mut tessere = Vec::new();

        for row in rows.iter() {
            let tipologia = get_field(row, "TipologiaSocio").trim().to_uppercase();
            if tipologia != "NUOVO" && tipologia != "ESTERNO" {
                continue;
            }

            let idsocio = get_field(row, "IdSocio").trim().to_string();
            let id = idsocio
                .parse::<u32>()
                .unwrap_or_else(|_| {
                    row.get("id")
                        .and_then(|v| v.as_u64().map(|n| n as u32))
                        .unwrap_or(0)
                });

            if idsocio.is_empty() && id == 0 {
                continue;
            }

            let descrizione = get_field(row, "NominativoSocio");
            if descrizione.is_empty() {
                continue;
            }

            tessere.push(Tessera {
                id,
                idsocio: if idsocio.is_empty() {
                    id.to_string()
                } else {
                    idsocio
                },
                descrizione,
            });
        }

        println!("✓ Trovate {} tessere da fare da Supabase", tessere.len());
        Ok(tessere)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn tesserato_e_archiviato(archivia: &str) -> bool {
    matches!(
        archivia.trim().to_lowercase().as_str(),
        "true" | "si" | "sì" | "1" | "yes" | "y" | "s"
    )
}

/// Prova la colonna booleana, poi quella testuale (SI/NO). La prima che risponde viene usata.
async fn fetch_tesserati_per_archivio(
    client: &supabase::SupabaseClient,
    solo_archiviati: bool,
) -> Result<Vec<serde_json::Value>, String> {
    const COLONNE: &[&str] = &["Archiviato", "Archivia", "Archiviazione"];
    let mut ultimo = String::from("Nessun filtro archivio applicabile");
    for colonna in COLONNE {
        let filtri = if solo_archiviati {
            vec![
                format!(
                    "or=({colonna}.eq.true,{colonna}.eq.SI,{colonna}.eq.si,{colonna}.eq.1,{colonna}.eq.yes)"
                ),
                format!("{colonna}=eq.true"),
            ]
        } else {
            vec![
                format!(
                    "or=({colonna}.is.null,{colonna}.eq.false,{colonna}.eq.NO,{colonna}.eq.no,{colonna}.eq.0)"
                ),
                format!("or=({colonna}.is.null,{colonna}.eq.false)"),
            ]
        };
        for filtro in filtri {
            match client.fetch_tesserati(Some(&filtro), None).await {
                Ok(rows) => {
                    println!(
                        "✓ Tesserati filtro archivio ({} righe): {}",
                        rows.len(),
                        filtro
                    );
                    return Ok(rows);
                }
                Err(e) => {
                    println!("⚠️ Filtro tesserati '{}' fallito: {}", filtro, e);
                    ultimo = e;
                }
            }
        }
    }
    Err(ultimo)
}

// Comando per ottenere tutti i tesserati da Supabase (Elenco Soci)
#[tauri::command]
async fn get_all_tesserati(
    escludi_archiviati: Option<bool>,
    solo_archiviati: Option<bool>,
) -> Result<Vec<Tesserato>, String> {
    let solo = solo_archiviati.unwrap_or(false);
    let escludi = escludi_archiviati.unwrap_or(false) && !solo;
    println!(
        "=== get_all_tesserati chiamato (Supabase / tesserati_supa){} ===",
        if solo {
            ", solo archiviati"
        } else if escludi {
            ", senza archiviati"
        } else {
            ""
        }
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let mut riallinea_oper = false;

    let result = if let Some(client) = client_guard.as_ref() {
        let (rows, filtro_archivio_ok) = if solo || escludi {
            match fetch_tesserati_per_archivio(client, solo).await {
                Ok(rows) => (rows, true),
                Err(e) => {
                    println!(
                        "⚠️ Filtro archiviati non applicato ({}), scarico tutti e filtro in locale",
                        e
                    );
                    (
                        client
                            .fetch_tesserati(None, None)
                            .await
                            .map_err(|e| format_supabase_error(&e))?,
                        false,
                    )
                }
            }
        } else {
            (
                client
                    .fetch_tesserati(None, None)
                    .await
                    .map_err(|e| format_supabase_error(&e))?,
                false,
            )
        };

        if rows.is_empty() && !solo && !escludi {
            println!("⚠️ Nessun tesserato trovato in Supabase");
            return Ok(vec![]);
        }

        let mut tesserati: Vec<Tesserato> = rows
            .iter()
            .filter_map(supabase_row_to_tesserato)
            .collect();

        if (solo || escludi) && !filtro_archivio_ok {
            let before = tesserati.len();
            tesserati.retain(|t| solo == tesserato_e_archiviato(&t.archivia));
            println!(
                "  Filtro archiviati lato Rust: {} → {} soci",
                before,
                tesserati.len()
            );
        } else if solo || escludi {
            // Se il filtro SQL ha usato una colonna vuota, togli comunque chi risulta archiviato.
            let before = tesserati.len();
            tesserati.retain(|t| {
                let arch = tesserato_e_archiviato(&t.archivia);
                if solo { arch } else { !arch }
            });
            if tesserati.len() != before {
                println!(
                    "  Filtro archiviati di sicurezza: {} → {} soci",
                    before,
                    tesserati.len()
                );
            }
        }

        // Telefono in elenco = telefono principale da Telefoni_supa (con riferimento)
        match client.fetch_telefoni(None).await {
            Ok(tel_rows) => {
                let principali = build_telefoni_principali_map(&tel_rows);
                println!(
                    "✓ Telefoni_supa: {} riga/e, {} soci con telefono principale",
                    tel_rows.len(),
                    principali.len()
                );
                apply_telefoni_principali(&mut tesserati, &principali);
            }
            Err(e) => {
                println!(
                    "⚠️ Telefoni_supa non disponibile per elenco soci ({}), uso Telefono su tesserati",
                    e
                );
            }
        }

        // Ordine alfabetico per nominativo (Elenco Soci / Elenco Operatori)
        tesserati.sort_by(|a, b| {
            a.nominativo
                .to_lowercase()
                .trim()
                .cmp(&b.nominativo.to_lowercase().trim())
        });

        let operatore_count = tesserati
            .iter()
            .filter(|t| {
                let v = t.operatore.trim().to_lowercase();
                v == "true" || v == "si" || v == "sì" || v == "1" || v == "yes"
            })
            .count();

        let attivo_count = tesserati
            .iter()
            .filter(|t| {
                let v = t.attivo.trim().to_lowercase();
                v == "true" || v == "si" || v == "sì" || v == "1" || v == "yes" || v == "attivo"
            })
            .count();

        let archiviati_count = tesserati
            .iter()
            .filter(|t| {
                let v = t.archivia.trim().to_lowercase();
                v == "true" || v == "si" || v == "sì" || v == "1" || v == "yes"
            })
            .count();

        if let Some(first) = tesserati.first() {
            println!(
                "  📋 Esempio socio: Operatore='{}', Attivo='{}', Archivia='{}'",
                first.operatore, first.attivo, first.archivia
            );
        }

        println!(
            "✓ Convertiti {} soci da Supabase (operatori: {}, attivi: {}, archiviati: {})",
            tesserati.len(),
            operatore_count,
            attivo_count,
            archiviati_count
        );

        let firma_nuova = (tesserati.len(), operatore_count);
        if !solo && !escludi {
            riallinea_oper = {
                let mut firma = tesserati_firma_allineamento().lock().await;
                let changed = *firma != (0, 0) && *firma != firma_nuova;
                *firma = firma_nuova;
                changed
            };
        }

        Ok(tesserati)
    } else {
        Err("Client Supabase non disponibile".to_string())
    };
    drop(client_guard);

    if riallinea_oper {
        println!(
            "ℹ️ Anagrafica tesserati aggiornata: al prossimo caricamento servizi riallineo Oper → IdOperatore"
        );
        *allineamento_id_operatore_eseguito().lock().await = false;
        *nominativi_cache().lock().await = None;
        *mappa_candidati_operatore_cache().lock().await = None;
    }

    result
}

/// Risolve IdSocio → (id canonico in tesserati, nominativo).
/// Usa chiavi normalizzate (trim / senza zeri iniziali) per allineare Access/Supabase.
fn build_idsocio_anagrafica_map(
    tesserati_rows: &[serde_json::Value],
) -> HashMap<String, (String, String)> {
    let mut map: HashMap<String, (String, String)> = HashMap::new();
    for row in tesserati_rows {
        let id_raw = get_field_any(row, &["IdSocio", "IDSOCIO", "idsocio"]);
        if id_raw.trim().is_empty() {
            continue;
        }
        let id_canon = id_raw.trim().to_string();
        let nom = get_field_any(
            row,
            &[
                "NominativoSocio",
                "NOMINATIVOSOCIO",
                "Nominativo",
                "NOMINATIVO",
                "nominativo_socio",
            ],
        );
        let entry = (id_canon.clone(), nom);
        // Inserisci sia grezzo che normalizzato, così "0123" e "123" trovano lo stesso socio
        map.insert(id_canon.clone(), entry.clone());
        let norm = normalize_idsocio_key(&id_canon);
        if !norm.is_empty() {
            map.insert(norm, entry);
        }
    }
    map
}

fn resolve_tesseramento_socio(
    idsocio_raw: &str,
    anag: &HashMap<String, (String, String)>,
) -> (String, String, bool) {
    let trimmed = idsocio_raw.trim();
    if trimmed.is_empty() {
        return (String::new(), String::new(), false);
    }
    if let Some((canon, nom)) = anag.get(trimmed) {
        return (canon.clone(), nom.clone(), true);
    }
    let norm = normalize_idsocio_key(trimmed);
    if !norm.is_empty() {
        if let Some((canon, nom)) = anag.get(&norm) {
            return (canon.clone(), nom.clone(), true);
        }
    }
    // Nessun match in anagrafica: restituisci comunque l'id normalizzato (meglio di zeri iniziali)
    let fallback = if norm.is_empty() {
        trimmed.to_string()
    } else {
        norm
    };
    (fallback, String::new(), false)
}

/// Tutti i tesseramenti (storico) con nominativo, per la videata verifica anomalie.
#[tauri::command]
async fn get_all_tesseramenti() -> Result<Vec<TesseramentoListaItem>, String> {
    println!("=== get_all_tesseramenti chiamato ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;

    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_tesseramenti(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let anag_map = match client.fetch_tesserati(None, None).await {
            Ok(tesserati_rows) => build_idsocio_anagrafica_map(&tesserati_rows),
            Err(e) => {
                println!(
                    "⚠️ Impossibile caricare nominativi tesserati per arricchire tesseramenti: {}",
                    e
                );
                HashMap::new()
            }
        };

        let mut list: Vec<TesseramentoListaItem> = rows
            .iter()
            .map(|row| {
                let tess = supabase_row_to_tesseramento(row);
                let (idsocio, nominativo, collegato) =
                    resolve_tesseramento_socio(&tess.idsocio, &anag_map);
                TesseramentoListaItem {
                    id: tess.id,
                    idsocio,
                    nominativo,
                    collegato,
                    anno: tess.anno,
                    numero: tess.numero,
                    data: tess.data,
                    scadenza: tess.scadenza,
                    tipologia: tess.tipologia,
                    quota: tess.quota,
                    note: tess.note,
                }
            })
            .collect();

        let orfani = list.iter().filter(|t| !t.collegato).count();
        list.sort_by(|a, b| {
            a.nominativo
                .to_lowercase()
                .cmp(&b.nominativo.to_lowercase())
                .then_with(|| {
                    let ya = a.anno.parse::<i32>().unwrap_or(0);
                    let yb = b.anno.parse::<i32>().unwrap_or(0);
                    yb.cmp(&ya)
                })
        });

        println!(
            "✓ get_all_tesseramenti: {} riga/e (non collegati ad anagrafica: {})",
            list.len(),
            orfani
        );
        Ok(list)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

/// Cerca un tesserato per IdSocio (prova grezzo + normalizzato, es. 0123 → 123).
async fn fetch_tesserato_row_by_idsocio(
    client: &SupabaseClient,
    idsocio: &str,
) -> Result<Option<serde_json::Value>, String> {
    let trimmed = idsocio.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let mut tried = Vec::new();
    for candidate in [trimmed.to_string(), normalize_idsocio_key(trimmed)] {
        if candidate.is_empty() || tried.iter().any(|t| t == &candidate) {
            continue;
        }
        tried.push(candidate.clone());
        let filter = format!("IdSocio=eq.{}", candidate);
        let rows = client
            .fetch_tesserati(Some(&filter), None)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        if let Some(row) = rows.into_iter().next() {
            return Ok(Some(row));
        }
    }
    Ok(None)
}

// Anagrafica completa di un socio (dati + storico tesseramenti)
#[tauri::command]
async fn get_socio_anagrafica(idsocio: String) -> Result<SocioAnagraficaCompleta, String> {
    println!("=== get_socio_anagrafica IdSocio={} ===", idsocio);

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;

    if let Some(client) = client_guard.as_ref() {
        let richiesto = idsocio.trim().to_string();
        let row = fetch_tesserato_row_by_idsocio(client, &richiesto)
            .await?
            .ok_or_else(|| format!("Socio IdSocio={} non trovato", richiesto))?;

        // Usa l'IdSocio reale della riga anagrafica per telefoni / tesseramenti
        let idsocio = get_field_any(&row, &["IdSocio", "IDSOCIO", "idsocio"]);
        if idsocio.is_empty() {
            return Err(format!(
                "Socio trovato ma senza IdSocio valido (richiesto: {})",
                richiesto
            ));
        }

        let anagrafica = supabase_row_to_anagrafica(&row)
            .ok_or_else(|| format!("Dati anagrafici non validi per IdSocio={}", idsocio))?;

        let contatti_filter = format!("IdSocio=eq.{}", idsocio);

        let mut telefoni: Vec<SocioTelefono> = match client.fetch_telefoni(Some(&contatti_filter)).await {
            Ok(rows) => {
                println!(
                    "✓ Telefoni_supa: {} riga/e per IdSocio={}",
                    rows.len(),
                    idsocio
                );
                rows.iter().map(supabase_row_to_telefono).collect()
            }
            Err(e) => {
                println!("⚠️ Telefoni non disponibili ({}): {}", idsocio, e);
                Vec::new()
            }
        };

        let mut email: Vec<SocioEmail> = match client.fetch_email_socio(Some(&contatti_filter)).await {
            Ok(rows) => {
                println!(
                    "✓ Email_supa: {} riga/e per IdSocio={}",
                    rows.len(),
                    idsocio
                );
                rows.iter().map(supabase_row_to_email).collect()
            }
            Err(e) => {
                println!("⚠️ Email socio non disponibili ({}): {}", idsocio, e);
                Vec::new()
            }
        };

        // Principale prima, poi OrdineUtilizzo
        telefoni.sort_by(|a, b| {
            match b.principale.cmp(&a.principale) {
                std::cmp::Ordering::Equal => {
                    let oa = a.ordine_utilizzo.parse::<f64>().unwrap_or(9999.0);
                    let ob = b.ordine_utilizzo.parse::<f64>().unwrap_or(9999.0);
                    if oa < ob {
                        std::cmp::Ordering::Less
                    } else if oa > ob {
                        std::cmp::Ordering::Greater
                    } else {
                        std::cmp::Ordering::Equal
                    }
                }
                other => other,
            }
        });
        email.sort_by(|a, b| {
            match b.principale.cmp(&a.principale) {
                std::cmp::Ordering::Equal => {
                    let oa = a.ordine_utilizzo.parse::<f64>().unwrap_or(9999.0);
                    let ob = b.ordine_utilizzo.parse::<f64>().unwrap_or(9999.0);
                    if oa < ob {
                        std::cmp::Ordering::Less
                    } else if oa > ob {
                        std::cmp::Ordering::Greater
                    } else {
                        std::cmp::Ordering::Equal
                    }
                }
                other => other,
            }
        });

        let mut anagrafica = anagrafica;
        if let Some(tel_princ) = format_telefono_principale(&telefoni) {
            anagrafica.telefono = tel_princ;
        }

        // Storico: prova IdSocio canonico e (se diverso) quello richiesto (es. 0123 vs 123)
        let mut tesseramenti: Vec<TesseramentoRecord> = Vec::new();
        let mut seen_tess = std::collections::HashSet::new();
        let mut id_varianti = vec![idsocio.clone()];
        if !richiesto.is_empty() && richiesto != idsocio {
            id_varianti.push(richiesto.clone());
        }
        let norm_rich = normalize_idsocio_key(&richiesto);
        if !norm_rich.is_empty()
            && !id_varianti.iter().any(|v| v == &norm_rich)
        {
            id_varianti.push(norm_rich);
        }

        for id_var in &id_varianti {
            let tess_filter = format!("IdSocio=eq.{}", id_var);
            match client.fetch_tesseramenti(Some(&tess_filter)).await {
                Ok(rows) => {
                    println!(
                        "✓ Storico Tesseramenti_supa: {} riga/e per IdSocio={}",
                        rows.len(),
                        id_var
                    );
                    for r in rows {
                        let tess = supabase_row_to_tesseramento(&r);
                        let key = tess
                            .id
                            .clone()
                            .unwrap_or_else(|| {
                                format!("{}|{}|{}|{}", tess.idsocio, tess.anno, tess.numero, tess.data)
                            });
                        if seen_tess.insert(key) {
                            tesseramenti.push(tess);
                        }
                    }
                }
                Err(e) => {
                    println!(
                        "⚠️ Storico tesseramenti non disponibile per IdSocio={} ({})",
                        id_var, e
                    );
                }
            }
        }

        // Se lo storico è vuoto (tabella assente o non ancora popolata),
        // mostra almeno il tesseramento corrente dalle colonne su tesserati
        if tesseramenti.is_empty() {
            if let Some(legacy) = tesseramento_from_tesserato_row(&row) {
                tesseramenti.push(legacy);
            }
        } else if let Some(legacy) = tesseramento_from_tesserato_row(&row) {
            // Completa numero tessera dall'anagrafica se manca sullo storico
            for tess in &mut tesseramenti {
                if tess.numero.is_empty() && tess.anno == legacy.anno {
                    tess.numero = legacy.numero.clone();
                }
            }
        }

        tesseramenti.sort_by(|a, b| {
            let ya = a.anno.parse::<i32>().unwrap_or(0);
            let yb = b.anno.parse::<i32>().unwrap_or(0);
            yb.cmp(&ya)
        });

        Ok(SocioAnagraficaCompleta {
            anagrafica,
            tesseramenti,
            telefoni,
            email,
        })
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn build_socio_anagrafica_body(
    anagrafica: &SocioAnagrafica,
    row: Option<&serde_json::Value>,
    for_insert: bool,
) -> serde_json::Map<String, serde_json::Value> {
    let mut body = serde_json::Map::new();

    let put_field = |body: &mut serde_json::Map<String, serde_json::Value>,
                     row: Option<&serde_json::Value>,
                     candidates: &[&str],
                     default_key: &str,
                     value: serde_json::Value| {
        if let Some(r) = row {
            insert_patch_field(body, r, candidates, value);
        } else {
            body.insert(default_key.to_string(), value);
        }
    };

    let put_bool = |body: &mut serde_json::Map<String, serde_json::Value>,
                    row: Option<&serde_json::Value>,
                    candidates: &[&str],
                    default_key: &str,
                    value: bool| {
        if let Some(r) = row {
            insert_patch_bool_field(body, r, candidates, value);
        } else {
            body.insert(default_key.to_string(), serde_json::json!(value));
        }
    };

    if for_insert {
        put_field(
            &mut body,
            row,
            &["IdSocio", "IDSOCIO"],
            "IdSocio",
            serde_json::json!(anagrafica.idsocio),
        );
    }

    put_field(
        &mut body,
        row,
        &["NominativoSocio"],
        "NominativoSocio",
        serde_json::json!(anagrafica.nominativo),
    );
    put_field(
        &mut body,
        row,
        &["CodiceFiscale"],
        "CodiceFiscale",
        serde_json::json!(anagrafica.codicefiscale),
    );
    put_field(
        &mut body,
        row,
        &["Sesso", "SESSO", "sesso"],
        "Sesso",
        serde_json::json!(anagrafica.sesso),
    );
    put_field(
        &mut body,
        row,
        &["Nascita_Comune", "NASCITA_COMUNE", "ComuneNascita"],
        "Nascita_Comune",
        serde_json::json!(anagrafica.nascita_comune),
    );

    if let Some(iso) = italian_date_to_iso(&anagrafica.nascita_data) {
        put_field(
            &mut body,
            row,
            &["Nascita_Data", "NASCITA_DATA", "DataNascita"],
            "Nascita_Data",
            serde_json::json!(iso),
        );
    }
    // Non inviare "" su colonne date: Postgres risponde 22007 invalid input syntax

    put_field(
        &mut body,
        row,
        &[
            "Residenza_Indirizzo",
            "RESIDENZA_INDIRIZZO",
            "IndirizzoResidenza",
            "ViaResidenza",
        ],
        "Residenza_Indirizzo",
        serde_json::json!(anagrafica.residenza_indirizzo),
    );
    put_field(
        &mut body,
        row,
        &[
            "Residenza_Civico",
            "RESIDENZA_CIVICO",
            "CivicoResidenza",
            "NumeroCivico",
        ],
        "Residenza_Civico",
        serde_json::json!(anagrafica.residenza_civico),
    );
    // Residenza_Cap in Supabase è numerico. "" provoca
    // 22P02 invalid input syntax for type numeric (es. socio senza CAP).
    // Il vuoto va inviato come NULL; un CAP presente come numero.
    let cap_testo = anagrafica.residenza_cap.trim();
    let cap_json = if cap_testo.is_empty() {
        serde_json::Value::Null
    } else if let Ok(n) = cap_testo.parse::<i64>() {
        serde_json::json!(n)
    } else {
        serde_json::json!(cap_testo)
    };
    put_field(
        &mut body,
        row,
        &["CAP", "Residenza_CAP", "RESIDENZA_CAP", "CapResidenza"],
        "Residenza_CAP",
        cap_json,
    );
    put_field(
        &mut body,
        row,
        &["Residenza_Comune", "RESIDENZA_COMUNE", "ComuneResidenza"],
        "Residenza_Comune",
        serde_json::json!(anagrafica.residenza_comune),
    );
    put_field(
        &mut body,
        row,
        &[
            "Residenza_Provincia",
            "RESIDENZA_PROVINCIA",
            "ProvinciaResidenza",
            "Prov",
        ],
        "Residenza_Provincia",
        serde_json::json!(anagrafica.residenza_provincia),
    );

    if !anagrafica.telefono.is_empty() || for_insert {
        put_field(
            &mut body,
            row,
            &["Telefono", "TELEFONO", "telefono"],
            "Telefono",
            serde_json::json!(anagrafica.telefono),
        );
    }

    put_field(
        &mut body,
        row,
        &["TipologiaSocio"],
        "TipologiaSocio",
        serde_json::json!(anagrafica.tipologiasocio),
    );
    put_bool(
        &mut body,
        row,
        &["Operatore", "OPERATORE", "operatore"],
        "Operatore",
        anagrafica.operatore,
    );
    put_bool(
        &mut body,
        row,
        &["Attivo", "ATTIVO", "attivo"],
        "Attivo",
        anagrafica.attivo,
    );
    put_bool(
        &mut body,
        row,
        &[
            "Archiviato",
            "ARCHIVIATO",
            "archiviato",
            "Archivia",
            "ARCHIVIA",
            "archivia",
            "Archiviazione",
            "ARCHIVIAZIONE",
            "archiviazione",
        ],
        "Archiviato",
        anagrafica.archivia,
    );

    // Sempre salva disponibilità (anche stringa vuota = nessuna spunta).
    // Se in log vedi "PATCH skip ... Disponibilita", esegui su Supabase
    // il file supabase-tesserati-disponibilita.sql (manca la colonna).
    put_field(
        &mut body,
        row,
        &["Disponibilita", "DISPONIBILITA", "disponibilita"],
        "Disponibilita",
        serde_json::json!(anagrafica.disponibilita),
    );

    put_field(
        &mut body,
        row,
        &["NoteAggiuntive", "NotaAggiuntiva", "NOTAAGGIUNTIVA"],
        "NoteAggiuntive",
        serde_json::json!(anagrafica.notaaggiuntiva),
    );

    body
}

#[tauri::command]
async fn get_next_idsocio() -> Result<String, String> {
    println!("=== get_next_idsocio chiamato (Supabase / tesserati_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_tesserati(None, Some("IdSocio"))
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let mut max_id: u64 = 0;
        for row in &rows {
            if let Ok(n) = get_field(row, "IdSocio").trim().parse::<u64>() {
                max_id = max_id.max(n);
            }
        }

        let next = (max_id + 1).to_string();
        println!("✓ Prossimo IdSocio suggerito: {}", next);
        Ok(next)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn create_socio_anagrafica(anagrafica: SocioAnagrafica) -> Result<SocioAnagrafica, String> {
    println!(
        "=== create_socio_anagrafica IdSocio={} Nominativo='{}' ===",
        anagrafica.idsocio, anagrafica.nominativo
    );

    if anagrafica.idsocio.trim().is_empty() {
        return Err("IdSocio obbligatorio".to_string());
    }
    if anagrafica.nominativo.trim().is_empty() {
        return Err("Nominativo obbligatorio".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let filter = format!("IdSocio=eq.{}", anagrafica.idsocio);
        let existing = client
            .fetch_tesserati(Some(&filter), None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        if !existing.is_empty() {
            return Err(format!(
                "Esiste già un socio con IdSocio={}",
                anagrafica.idsocio
            ));
        }

        let template = client
            .fetch_tesserati(None, None)
            .await
            .ok()
            .and_then(|rows| rows.first().cloned());

        let body = build_socio_anagrafica_body(&anagrafica, template.as_ref(), true);
        if body.is_empty() {
            return Err("Nessun campo da inserire per il nuovo socio".to_string());
        }

        let inserted = client
            .insert_tesserato(&body)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        supabase_row_to_anagrafica(&inserted)
            .ok_or_else(|| "Impossibile convertire il socio appena inserito".to_string())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn save_socio_anagrafica(anagrafica: SocioAnagrafica) -> Result<(), String> {
    println!(
        "=== save_socio_anagrafica IdSocio={} ===",
        anagrafica.idsocio
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let filter = format!("IdSocio=eq.{}", anagrafica.idsocio);
        let rows = client
            .fetch_tesserati(Some(&filter), None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let row = rows
            .first()
            .ok_or_else(|| format!("Socio IdSocio={} non trovato", anagrafica.idsocio))?;

        let body = build_socio_anagrafica_body(&anagrafica, Some(row), false);
        if body.is_empty() {
            return Err("Nessun campo da aggiornare".to_string());
        }

        client
            .patch_tesserato(&anagrafica.idsocio, &body)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        Ok(())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn save_tesseramento(tesseramento: TesseramentoRecord) -> Result<TesseramentoRecord, String> {
    println!(
        "=== save_tesseramento IdSocio={} Anno={} ===",
        tesseramento.idsocio, tesseramento.anno
    );

    ensure_supabase_client().await?;

    let mut body = serde_json::Map::new();
    // Colonne reali di Tesseramenti_supa: IdSocio, Anno, DataTesseramento,
    // TipologiaSocio, Tessera_Numero
    // IdSocio numerico come nel DB
    if let Ok(id_num) = tesseramento.idsocio.parse::<i64>() {
        body.insert("IdSocio".to_string(), serde_json::json!(id_num));
    } else {
        body.insert(
            "IdSocio".to_string(),
            serde_json::json!(tesseramento.idsocio),
        );
    }
    if let Ok(anno_num) = tesseramento.anno.parse::<i32>() {
        body.insert("Anno".to_string(), serde_json::json!(anno_num));
    } else {
        body.insert("Anno".to_string(), serde_json::json!(tesseramento.anno));
    }
    if let Some(iso) = italian_date_to_iso(&tesseramento.data) {
        body.insert("DataTesseramento".to_string(), serde_json::json!(iso));
    } else if !tesseramento.data.trim().is_empty() {
        // già in formato ISO o altro testo riconosciuto dal DB
        body.insert(
            "DataTesseramento".to_string(),
            serde_json::json!(tesseramento.data.trim()),
        );
    }
    if !tesseramento.tipologia.trim().is_empty() {
        body.insert(
            "TipologiaSocio".to_string(),
            serde_json::json!(tesseramento.tipologia),
        );
    }
    let numero = tesseramento.numero.trim();
    if numero.is_empty() {
        body.insert("Tessera_Numero".to_string(), serde_json::Value::Null);
    } else {
        body.insert(
            "Tessera_Numero".to_string(),
            serde_json::json!(numero),
        );
    }

    let row_id = tesseramento
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        // 1) Modifica (PATCH per id) oppure nuovo (POST)
        let saved_row = client
            .upsert_tesseramento(&body, row_id)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        let mut saved = supabase_row_to_tesseramento(&saved_row);
        // Quota e note non hanno una colonna dedicata su Tesseramenti_supa
        if saved.numero.is_empty() {
            saved.numero = tesseramento.numero.clone();
        }
        if saved.quota.is_empty() {
            saved.quota = tesseramento.quota.clone();
        }
        if saved.note.is_empty() {
            saved.note = tesseramento.note.clone();
        }

        // 2) Se è l'anno più recente, aggiorna anche i campi su tesserati (Elenco Soci)
        let filter = format!("IdSocio=eq.{}", tesseramento.idsocio);
        let current_anno = client
            .fetch_tesserati(Some(&filter), Some("Tesseramento_Anno"))
            .await
            .ok()
            .and_then(|rows| rows.first().cloned())
            .map(|r| get_field(&r, "Tesseramento_Anno"))
            .unwrap_or_default()
            .parse::<i32>()
            .unwrap_or(0);

        let new_anno = tesseramento.anno.parse::<i32>().unwrap_or(0);
        if new_anno >= current_anno || current_anno == 0 {
            let numero_val = serde_json::json!(tesseramento.numero);
            if let Err(e) = client
                .sync_tesseramento_su_tesserati(
                    &tesseramento.idsocio,
                    &tesseramento.anno,
                    Some(&numero_val),
                    body.get("DataTesseramento"),
                    body.get("TipologiaSocio"),
                )
                .await
            {
                println!("⚠️ Sync su tesserati fallito (storico comunque salvato): {}", e);
            }
        }

        Ok(saved)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

async fn riallinea_tesseramento_corrente(
    client: &supabase::SupabaseClient,
    idsocio: &str,
) -> Result<(), String> {
    let filter = format!("IdSocio=eq.{}", idsocio);
    let rows = client
        .fetch_tesseramenti(Some(&filter))
        .await
        .unwrap_or_default();
    let mut rimasti: Vec<TesseramentoRecord> = rows.iter().map(supabase_row_to_tesseramento).collect();
    rimasti.sort_by(|a, b| {
        b.anno
            .parse::<i32>()
            .unwrap_or(0)
            .cmp(&a.anno.parse::<i32>().unwrap_or(0))
    });

    if let Some(corrente) = rimasti.first() {
        let numero = serde_json::json!(corrente.numero);
        let data = italian_date_to_iso(&corrente.data)
            .filter(|s| !s.is_empty())
            .map(|s| serde_json::json!(s));
        let tipologia = if corrente.tipologia.trim().is_empty() {
            None
        } else {
            Some(serde_json::json!(corrente.tipologia))
        };
        client
            .sync_tesseramento_su_tesserati(
                idsocio,
                &corrente.anno,
                Some(&numero),
                data.as_ref(),
                tipologia.as_ref(),
            )
            .await
    } else {
        let mut patch = serde_json::Map::new();
        patch.insert("Tesseramento_Anno".to_string(), serde_json::Value::Null);
        patch.insert("Tesseramento_Numero".to_string(), serde_json::Value::Null);
        patch.insert("Tesseramento_Data".to_string(), serde_json::Value::Null);
        client.patch_tesserato(idsocio, &patch).await
    }
}

#[tauri::command]
async fn delete_tesseramento(tesseramento: TesseramentoRecord) -> Result<(), String> {
    println!(
        "=== delete_tesseramento IdSocio={} Anno={} id={:?} ===",
        tesseramento.idsocio, tesseramento.anno, tesseramento.id
    );

    let idsocio = tesseramento.idsocio.trim().to_string();
    if idsocio.is_empty() {
        return Err("IdSocio obbligatorio per eliminare il tesseramento".to_string());
    }

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    if let Some(id) = tesseramento
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        client
            .delete_tesseramento(id)
            .await
            .map_err(|e| format_supabase_error(&e))?;
    }

    if let Err(e) = riallinea_tesseramento_corrente(client, &idsocio).await {
        println!("⚠️ Riallineamento tessera su anagrafica dopo delete: {}", e);
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct DeleteSocioResult {
    eliminato: bool,
    ha_servizi: bool,
}

#[tauri::command]
async fn delete_socio_anagrafica(idsocio: String) -> Result<DeleteSocioResult, String> {
    let idsocio = normalize_idsocio_key(idsocio.trim());
    if idsocio.is_empty() {
        return Err("IdSocio obbligatorio".to_string());
    }
    println!("=== delete_socio_anagrafica IdSocio={} ===", idsocio);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let ha_servizi = client
        .socio_ha_servizi_collegati(&idsocio)
        .await
        .map_err(|e| format_supabase_error(&e))?;
    if ha_servizi {
        println!("  socio {} non eliminato: ha servizi collegati", idsocio);
        return Ok(DeleteSocioResult {
            eliminato: false,
            ha_servizi: true,
        });
    }

    for tabella in ["tesseramenti", "telefoni", "email", "tesserati"] {
        client
            .delete_righe_idsocio(tabella, &idsocio)
            .await
            .map_err(|e| format_supabase_error(&e))?;
    }

    println!("✓ Socio {} eliminato", idsocio);
    Ok(DeleteSocioResult {
        eliminato: true,
        ha_servizi: false,
    })
}

fn idsocio_json_value(idsocio: &str) -> serde_json::Value {
    if let Ok(n) = idsocio.trim().parse::<i64>() {
        serde_json::json!(n)
    } else {
        serde_json::json!(idsocio.trim())
    }
}

fn ordine_utilizzo_json(value: &str) -> serde_json::Value {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return serde_json::Value::Null;
    }
    if let Ok(n) = trimmed.parse::<i64>() {
        serde_json::json!(n)
    } else if let Ok(n) = trimmed.parse::<f64>() {
        serde_json::json!(n)
    } else {
        serde_json::json!(trimmed)
    }
}

async fn sync_telefono_principale_su_tesserati(
    client: &supabase::SupabaseClient,
    idsocio: &str,
) -> Result<(), String> {
    let filter = format!("IdSocio=eq.{}", idsocio);
    let rows = client.fetch_telefoni(Some(&filter)).await.unwrap_or_default();
    let list: Vec<SocioTelefono> = rows.iter().map(supabase_row_to_telefono).collect();
    let num_only = list
        .iter()
        .find(|t| t.principale && !t.telefono.trim().is_empty())
        .or_else(|| list.iter().find(|t| !t.telefono.trim().is_empty()))
        .map(|t| t.telefono.trim().to_string())
        .unwrap_or_default();
    let mut patch = serde_json::Map::new();
    patch.insert("Telefono".to_string(), serde_json::json!(num_only));
    client.patch_tesserato(idsocio, &patch).await
}

#[tauri::command]
async fn save_socio_telefono(telefono: SocioTelefono) -> Result<SocioTelefono, String> {
    println!(
        "=== save_socio_telefono IdSocio={} Telefono={} ===",
        telefono.idsocio, telefono.telefono
    );

    let idsocio = telefono.idsocio.trim().to_string();
    let numero = telefono.telefono.trim().to_string();
    if idsocio.is_empty() {
        return Err("IdSocio obbligatorio per il telefono".to_string());
    }
    if numero.is_empty() {
        return Err("Il numero di telefono è obbligatorio".to_string());
    }

    ensure_supabase_client().await?;

    let mut body = serde_json::Map::new();
    body.insert("IdSocio".to_string(), idsocio_json_value(&idsocio));
    body.insert("Telefono".to_string(), serde_json::json!(numero));
    body.insert(
        "Riferimento".to_string(),
        serde_json::json!(telefono.riferimento.trim()),
    );
    body.insert(
        "Principale".to_string(),
        serde_json::json!(telefono.principale),
    );
    body.insert(
        "OrdineUtilizzo".to_string(),
        ordine_utilizzo_json(&telefono.ordine_utilizzo),
    );
    body.insert(
        "NoteTelefono".to_string(),
        serde_json::json!(telefono.note.trim()),
    );

    let row_id = telefono
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    if telefono.principale {
        if let Err(e) = client.clear_principale_telefoni(&idsocio, row_id).await {
            println!("⚠️ clear Principale telefoni: {}", e);
        }
    }

    let saved_row = client
        .upsert_socio_telefono(&body, row_id)
        .await
        .map_err(|e| format_supabase_error(&e))?;
    let saved = supabase_row_to_telefono(&saved_row);

    if let Err(e) = sync_telefono_principale_su_tesserati(client, &idsocio).await {
        println!("⚠️ Sync Telefono su tesserati fallito: {}", e);
    }

    Ok(saved)
}

#[tauri::command]
async fn delete_socio_telefono(telefono: SocioTelefono) -> Result<(), String> {
    println!(
        "=== delete_socio_telefono IdSocio={} Telefono={} ===",
        telefono.idsocio, telefono.telefono
    );

    ensure_supabase_client().await?;

    let row_id = telefono
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let idsocio = telefono.idsocio.trim().to_string();

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .delete_socio_telefono(row_id, &idsocio, telefono.telefono.trim())
        .await
        .map_err(|e| format_supabase_error(&e))?;

    if !idsocio.is_empty() {
        if let Err(e) = sync_telefono_principale_su_tesserati(client, &idsocio).await {
            println!("⚠️ Sync Telefono su tesserati dopo delete: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
async fn save_socio_email(email: SocioEmail) -> Result<SocioEmail, String> {
    println!(
        "=== save_socio_email IdSocio={} Email={} ===",
        email.idsocio, email.email
    );

    let idsocio = email.idsocio.trim().to_string();
    let indirizzo = email.email.trim().to_string();
    if idsocio.is_empty() {
        return Err("IdSocio obbligatorio per l'email".to_string());
    }
    if indirizzo.is_empty() {
        return Err("L'indirizzo email è obbligatorio".to_string());
    }

    ensure_supabase_client().await?;

    let mut body = serde_json::Map::new();
    body.insert("IdSocio".to_string(), idsocio_json_value(&idsocio));
    body.insert("Email".to_string(), serde_json::json!(indirizzo));
    body.insert(
        "Riferimento_Email".to_string(),
        serde_json::json!(email.riferimento.trim()),
    );
    body.insert("Principale".to_string(), serde_json::json!(email.principale));
    body.insert(
        "OrdineUtilizzo".to_string(),
        ordine_utilizzo_json(&email.ordine_utilizzo),
    );
    body.insert(
        "NoteEmail".to_string(),
        serde_json::json!(email.note.trim()),
    );

    let row_id = email
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    if email.principale {
        if let Err(e) = client.clear_principale_email(&idsocio, row_id).await {
            println!("⚠️ clear Principale email: {}", e);
        }
    }

    let saved_row = client
        .upsert_socio_email(&body, row_id)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    Ok(supabase_row_to_email(&saved_row))
}

#[tauri::command]
async fn delete_socio_email(email: SocioEmail) -> Result<(), String> {
    println!(
        "=== delete_socio_email IdSocio={} Email={} ===",
        email.idsocio, email.email
    );

    ensure_supabase_client().await?;

    let row_id = email
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .delete_socio_email(row_id, email.idsocio.trim(), email.email.trim())
        .await
        .map_err(|e| format_supabase_error(&e))?;

    Ok(())
}

// Comando per ottenere tutti gli automezzi da Supabase
#[tauri::command]
async fn get_all_automezzi() -> Result<Vec<Automezzo>, String> {
    println!("=== get_all_automezzi chiamato (Supabase / Automezzi_Supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;

    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_automezzi(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        if rows.is_empty() {
            println!("⚠️ Nessun automezzo trovato in Supabase");
            return Ok(vec![]);
        }

        let automezzi: Vec<Automezzo> = rows
            .iter()
            .filter_map(supabase_row_to_automezzo)
            .collect();

        if automezzi.is_empty() && !rows.is_empty() {
            if let Some(first) = rows.first().and_then(|r| r.as_object()) {
                let mut keys: Vec<&String> = first.keys().collect();
                keys.sort();
                println!(
                    "⚠️ 0 automezzi convertiti su {} righe — verifica IdAutomezzo / Numero_Mezzo. Colonne: {:?}",
                    rows.len(),
                    keys.iter().map(|k| k.as_str()).collect::<Vec<_>>()
                );
            }
        }

        for (idx, a) in automezzi.iter().take(3).enumerate() {
            println!(
                "  Automezzo [{}]: ID={}, NR='{}', MARCA='{}', MODELLO='{}', TARGA='{}'",
                idx + 1,
                a.id,
                a.nr_automezzo,
                a.marca,
                a.modello,
                a.targa
            );
        }

        println!("✓ Convertiti {} automezzi da Supabase", automezzi.len());
        Ok(automezzi)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn build_automezzo_body(
    automezzo: &Automezzo,
    row: Option<&serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let in_servizio = is_truthy_str(&automezzo.in_servizio);
    let mut body = serde_json::Map::new();

    let put_field = |body: &mut serde_json::Map<String, serde_json::Value>,
                     row: Option<&serde_json::Value>,
                     candidates: &[&str],
                     default_key: &str,
                     value: serde_json::Value| {
        if let Some(r) = row {
            insert_patch_field(body, r, candidates, value);
        } else {
            body.insert(default_key.to_string(), value);
        }
    };

    put_field(
        &mut body,
        row,
        &[
            "Numero_Mezzo",
            "NR_AUTOMEZZO",
            "Nr_Automezzo",
            "NrAutomezzo",
            "NumeroAutomezzo",
            "nr_automezzo",
        ],
        "Numero_Mezzo",
        serde_json::json!(automezzo.nr_automezzo),
    );
    put_field(
        &mut body,
        row,
        &["Marca", "MARCA"],
        "Marca",
        serde_json::json!(automezzo.marca),
    );
    put_field(
        &mut body,
        row,
        &["Modello", "MODELLO"],
        "Modello",
        serde_json::json!(automezzo.modello),
    );
    put_field(
        &mut body,
        row,
        &["Targa", "TARGA"],
        "Targa",
        serde_json::json!(automezzo.targa),
    );
    put_field(
        &mut body,
        row,
        &["Dotazione", "DOTAZIONE"],
        "Dotazione",
        serde_json::json!(automezzo.dotazione),
    );
    put_field(
        &mut body,
        row,
        &["Note_mezzo", "NOTE", "Note_Mezzo"],
        "Note_mezzo",
        serde_json::json!(automezzo.note_mezzo),
    );

    if let Some(r) = row {
        insert_patch_bool_field(
            &mut body,
            r,
            &["InServizio", "INSERVIZIO", "In_Servizio"],
            in_servizio,
        );
    } else {
        body.insert("InServizio".to_string(), serde_json::json!(in_servizio));
    }

    let scadenze = [
        (
            automezzo.scadenza_ztl.as_str(),
            &["Scadenza_ZTL", "SCADENZA ZTL", "ScadenzaZTL"][..],
            "Scadenza_ZTL",
        ),
        (
            automezzo.scadenza_assicurazione.as_str(),
            &[
                "Scadenza_Assicurazione",
                "SCADENZA ASSICURAZIONE",
                "ScadenzaAssicurazione",
            ][..],
            "Scadenza_Assicurazione",
        ),
        (
            automezzo.scadenza_bollo.as_str(),
            &["Scadenza_Bollo", "SCADENZA BOLLO", "ScadenzaBollo"][..],
            "Scadenza_Bollo",
        ),
    ];

    for (date_str, candidates, default_key) in scadenze {
        let value = if let Some(iso) = italian_date_to_iso(date_str) {
            serde_json::json!(iso)
        } else {
            serde_json::json!("")
        };
        put_field(&mut body, row, candidates, default_key, value);
    }

    body
}

#[tauri::command]
async fn create_automezzo(automezzo: Automezzo) -> Result<Automezzo, String> {
    println!(
        "=== create_automezzo NR='{}' TARGA='{}' ===",
        automezzo.nr_automezzo, automezzo.targa
    );

    if automezzo.nr_automezzo.trim().is_empty() {
        return Err("N. mezzo obbligatorio".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let template = client
            .fetch_automezzi(None)
            .await
            .ok()
            .and_then(|rows| rows.first().cloned());

        let body = build_automezzo_body(&automezzo, template.as_ref());
        if body.is_empty() {
            return Err("Nessun campo da inserire per il nuovo mezzo".to_string());
        }

        let inserted = client
            .insert_automezzo(&body)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        supabase_row_to_automezzo(&inserted)
            .ok_or_else(|| "Impossibile convertire il mezzo appena inserito".to_string())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn save_automezzo(automezzo: Automezzo) -> Result<(), String> {
    println!(
        "=== save_automezzo IdAutomezzo={} NR='{}' ===",
        automezzo.id, automezzo.nr_automezzo
    );

    if automezzo.id == 0 {
        return Err("ID automezzo non valido".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let filter = format!("IdAutomezzo=eq.{}", automezzo.id);
        let rows = client
            .fetch_automezzi(Some(&filter))
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let row = rows
            .first()
            .ok_or_else(|| format!("Automezzo IdAutomezzo={} non trovato", automezzo.id))?;

        let body = build_automezzo_body(&automezzo, Some(row));
        if body.is_empty() {
            return Err("Nessun campo da aggiornare".to_string());
        }

        client
            .patch_automezzo(automezzo.id, &body)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        Ok(())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn get_all_tratte() -> Result<TratteElenco, String> {
    println!("=== get_all_tratte chiamato (Supabase / Tratte_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;

    if let Some(client) = client_guard.as_ref() {
        let costo_al_km = fetch_costo_al_km(client).await.unwrap_or(0.70);
        println!("✓ CostoAlKm da Impostazioni_supa: {}", costo_al_km);

        let rows = client
            .fetch_tratte(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        if rows.is_empty() {
            println!("⚠️ Nessuna tratta trovata in Supabase");
            return Ok(TratteElenco {
                costo_al_km,
                tratte: vec![],
            });
        }

        sync_tratte_tariffa_km(client, &rows, costo_al_km).await;

        let tratte: Vec<Tratta> = rows
            .iter()
            .filter_map(|row| supabase_row_to_tratta(row, costo_al_km))
            .collect();

        if tratte.is_empty() && !rows.is_empty() {
            if let Some(first) = rows.first().and_then(|r| r.as_object()) {
                let mut keys: Vec<&String> = first.keys().collect();
                keys.sort();
                println!(
                    "⚠️ 0 tratte convertite su {} righe — verifica IdTratta / Comune. Colonne: {:?}",
                    rows.len(),
                    keys.iter().map(|k| k.as_str()).collect::<Vec<_>>()
                );
            }
        }

        println!(
            "✓ Convertite {} tratte (tariffa km {})",
            tratte.len(),
            costo_al_km
        );
        Ok(TratteElenco {
            costo_al_km,
            tratte,
        })
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn save_tratta(tratta: Tratta) -> Result<(), String> {
    println!(
        "=== save_tratta IdTratta={} Comune='{}' ===",
        tratta.id, tratta.comune
    );

    if tratta.id == 0 {
        return Err("ID tratta non valido".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let filter = format!("IdTratta=eq.{}", tratta.id);
        let rows = client
            .fetch_tratte(Some(&filter))
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let row = rows
            .first()
            .ok_or_else(|| format!("Tratta IdTratta={} non trovata", tratta.id))?;

        let body = build_tratta_body(&tratta, Some(row));
        if body.is_empty() {
            return Err("Nessun campo da aggiornare".to_string());
        }

        client
            .patch_tratta(tratta.id, &body)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        Ok(())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn tipologie_socio_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut tipologie: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(
                row,
                &[
                    "TipologiaSocio",
                    "TIPOLOGIASOCIO",
                    "TipoSocio",
                    "TIPOSOCIO",
                    "Tipologia",
                    "TIPOLOGIA",
                    "Descrizione",
                    "Nome",
                ],
            );
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();

    tipologie.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    tipologie.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    tipologie
}

fn richiedenti_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut richiedenti: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(
                row,
                &[
                    "TipoRichiedente",
                    "TIPORICHIEDENTE",
                    "Tipo_Richiedente",
                    "Richiedente",
                    "RICHIEDENTE",
                    "Richiedenti",
                    "RICHIEDENTI",
                    "Descrizione",
                    "DESCRIZIONE",
                    "Nome",
                    "NOME",
                ],
            );
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();

    richiedenti.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    richiedenti.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    richiedenti
}

fn tipi_pagamento_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut tipi: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(
                row,
                &[
                    "ModoPagamento",
                    "MODOPAGAMENTO",
                    "Modo_Pagamento",
                    "MODO_PAGAMENTO",
                    "TipoPagamento",
                    "TIPOPAGAMENTO",
                    "Descrizione",
                    "DESCRIZIONE",
                    "Nome",
                    "NOME",
                ],
            );
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();

    tipi.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    tipi.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    tipi
}

#[tauri::command]
async fn get_all_tipi_pagamento() -> Result<Vec<String>, String> {
    println!("=== get_all_tipi_pagamento chiamato (Supabase / TipoPagamenti_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_tipi_pagamento(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let tipi = tipi_pagamento_da_righe(&rows);
        println!("✓ Caricati {} tipi pagamento da Supabase", tipi.len());
        Ok(tipi)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImpostazioneRecord {
    id: String,
    impostazione: String,
    valore: String,
}

fn supabase_row_to_impostazione(row: &serde_json::Value) -> ImpostazioneRecord {
    ImpostazioneRecord {
        id: row
            .get("id")
            .map(|v| {
                v.as_u64()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| v.to_string())
            })
            .unwrap_or_default(),
        impostazione: get_field_any(
            row,
            &[
                "Impostazione",
                "IMPOSTAZIONE",
                "Nome",
                "Chiave",
                "Impostazione_Nome",
            ],
        ),
        valore: get_field_any(
            row,
            &[
                "ValoreImpostazione",
                "Valore",
                "VALORE",
                "Valore_Impostazione",
                "Impostazione_Valore",
            ],
        ),
    }
}

fn valore_column_name_impostazione(row: &serde_json::Value) -> &'static str {
    const CANDIDATES: &[&str] = &[
        "ValoreImpostazione",
        "Valore",
        "VALORE",
        "Valore_Impostazione",
        "Impostazione_Valore",
    ];
    for name in CANDIDATES {
        if row.get(*name).is_some() {
            return name;
        }
    }
    "Valore"
}

#[tauri::command]
async fn get_all_impostazioni() -> Result<Vec<ImpostazioneRecord>, String> {
    println!("=== get_all_impostazioni chiamato (Supabase / Impostazioni_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_impostazioni(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let list: Vec<ImpostazioneRecord> = rows.iter().map(supabase_row_to_impostazione).collect();
        println!("✓ Caricate {} impostazioni da Supabase", list.len());
        Ok(list)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn update_impostazione(id: String, valore: String) -> Result<(), String> {
    println!(
        "=== update_impostazione id={} valore_len={} ===",
        id,
        valore.len()
    );

    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Id impostazione mancante".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let rows = client
        .fetch_impostazioni(None)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    let row = rows
        .iter()
        .find(|r| {
            let rid = r
                .get("id")
                .map(|v| {
                    v.as_u64()
                        .map(|n| n.to_string())
                        .unwrap_or_else(|| v.as_str().unwrap_or("").to_string())
                })
                .unwrap_or_default();
            rid == id
        })
        .ok_or_else(|| format!("Impostazione id={} non trovata", id))?;

    let col = valore_column_name_impostazione(row);
    let mut body = serde_json::Map::new();
    body.insert(col.to_string(), serde_json::json!(valore));

    client
        .patch_impostazione(&id, &body)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    println!("✓ Impostazione id={} aggiornata (colonna {})", id, col);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserPermissionsRecord {
    user_id: String,
    username: String,
    is_admin: bool,
    programma: bool,
    calendario: bool,
    /// JSON object delle voci sidebar consentite (stringa serializzata o oggetto)
    #[serde(default)]
    sidebar_menu: serde_json::Value,
}

fn parse_sidebar_menu_from_row(row: &serde_json::Value) -> serde_json::Value {
    for key in [
        "SidebarMenu",
        "sidebar_menu",
        "SIDEBAR_MENU",
        "sidebarMenu",
        "MenuSidebar",
        "menu_sidebar",
    ] {
        if let Some(v) = row.get(key) {
            if v.is_null() {
                continue;
            }
            if v.is_object() {
                return v.clone();
            }
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if t.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(t) {
                    if parsed.is_object() {
                        return parsed;
                    }
                }
            }
        }
    }
    serde_json::json!({})
}

fn supabase_row_to_user_permissions(row: &serde_json::Value) -> UserPermissionsRecord {
    UserPermissionsRecord {
        user_id: get_field_any(row, &["user_id", "UserId", "USER_ID"]),
        username: get_field_any(row, &["username", "Username", "USERNAME"]),
        is_admin: get_bool_from_row(row, &["is_admin", "isadmin", "IsAdmin", "IS_ADMIN"]),
        programma: get_bool_from_row(row, &["Programma", "programma", "PROGRAMMA"]),
        calendario: get_bool_from_row(row, &["Calendario", "calendario", "CALENDARIO"]),
        sidebar_menu: parse_sidebar_menu_from_row(row),
    }
}

/// True se l'utente può vedere l'Agenda (stessa logica della sidebar JS).
fn user_can_see_agenda(p: &UserPermissionsRecord) -> bool {
    if p.is_admin {
        return true;
    }
    if !p.programma {
        return false;
    }
    match &p.sidebar_menu {
        serde_json::Value::Object(map) => match map.get("appunti") {
            Some(serde_json::Value::Bool(true)) => true,
            Some(serde_json::Value::String(s)) => {
                let t = s.trim().to_ascii_lowercase();
                t == "true" || t == "1"
            }
            Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1),
            _ => false,
        },
        _ => false,
    }
}

/// Chiavi pubbliche per login Auth (senza secret)
#[tauri::command]
async fn get_supabase_auth_config() -> Result<serde_json::Value, String> {
    let config = load_app_config_from_file().await?;
    let supabase = config
        .supabase
        .as_ref()
        .ok_or_else(|| "Config Supabase mancante in config.json".to_string())?;

    let url = supabase.url.trim().to_string();
    if url.is_empty() {
        return Err("supabase.url mancante in config.json".to_string());
    }

    let public_key = supabase
        .publishable_key
        .clone()
        .filter(|k| !k.is_empty() && !k.contains("your-"))
        .or_else(|| {
            if !supabase.anon_key.is_empty() && !supabase.anon_key.contains("your-") {
                Some(supabase.anon_key.clone())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            "Serve publishable_key o anon_key in config.json per il login".to_string()
        })?;

    Ok(serde_json::json!({
        "url": url,
        "anon_key": public_key,
        "tables": {
            "user_permissions": supabase
                .tables
                .as_ref()
                .and_then(|t| t.user_permissions.clone())
                .unwrap_or_else(|| "user_permissions".to_string())
        }
    }))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppuntoRecord {
    id: Option<String>,
    user_id: String,
    #[serde(default)]
    autore_username: String,
    /// Data giorno in formato YYYY-MM-DD
    data: String,
    testo: String,
    fatto: bool,
    ordine: i32,
    /// privato | selezionati | tutti
    #[serde(default = "default_visibilita_privato")]
    visibilita: String,
    /// user_id destinatari (se selezionati)
    #[serde(default)]
    destinatari: Vec<String>,
    /// Nomi destinatari (solo in lettura)
    #[serde(default)]
    destinatari_nomi: Vec<String>,
    /// Numero risposte (solo in lettura)
    #[serde(default)]
    num_risposte: i32,
}

fn default_visibilita_privato() -> String {
    "privato".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UtenteAppuntiItem {
    user_id: String,
    username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppuntoRispostaRecord {
    id: Option<String>,
    appunto_id: String,
    user_id: String,
    #[serde(default)]
    username: String,
    testo: String,
    #[serde(default)]
    created_at: String,
}

fn supabase_row_to_risposta(row: &serde_json::Value) -> AppuntoRispostaRecord {
    AppuntoRispostaRecord {
        id: row.get("id").map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| json_to_string(v))
        }),
        appunto_id: get_field_any(row, &["appunto_id", "AppuntoId"]),
        user_id: get_field_any(row, &["user_id", "UserId"]),
        username: get_field_any(row, &["username", "Username", "USERNAME"]),
        testo: get_field_any(row, &["testo", "Testo"]),
        created_at: get_field_any(row, &["created_at", "CreatedAt"]),
    }
}

/// Verifica se l'utente può vedere/rispondere a un appunto.
async fn utente_puo_accedere_appunto(
    client: &SupabaseClient,
    appunto_id: &str,
    user_id: &str,
) -> Result<(bool, String), String> {
    let filter = format!("id=eq.{}", appunto_id.trim());
    let rows = client
        .fetch_table("appunti", Some(&filter), None, None)
        .await
        .map_err(|e| format_supabase_error(&e))?;
    let row = rows
        .first()
        .ok_or_else(|| "Appunto non trovato".to_string())?;
    let a = supabase_row_to_appunto(row);
    let uid = user_id.trim();
    if a.user_id == uid {
        return Ok((true, a.visibilita));
    }
    if a.visibilita == "tutti" {
        return Ok((true, a.visibilita));
    }
    if a.visibilita == "selezionati" {
        let dest = client
            .fetch_appunti_destinatari_for_appunto(appunto_id)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        let ok = dest.iter().any(|r| {
            get_field_any(r, &["user_id", "UserId"]) == uid
        });
        return Ok((ok, a.visibilita));
    }
    Ok((false, a.visibilita))
}

fn normalize_visibilita(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "tutti" | "all" | "pubblico" => "tutti".to_string(),
        "selezionati" | "scelti" | "selected" => "selezionati".to_string(),
        _ => "privato".to_string(),
    }
}

fn supabase_row_to_appunto(row: &serde_json::Value) -> AppuntoRecord {
    let data_raw = get_field_any(row, &["data", "Data", "DATA"]);
    let data = if data_raw.len() >= 10 {
        data_raw.chars().take(10).collect()
    } else {
        data_raw
    };
    let fatto = matches!(
        get_bool_field(row, &["fatto", "Fatto", "FATTO"])
            .to_lowercase()
            .as_str(),
        "true" | "si" | "sì" | "1" | "yes"
    );
    let ordine = get_field_any(row, &["ordine", "Ordine", "ORDINE"])
        .parse::<i32>()
        .unwrap_or(0);
    let visibilita = normalize_visibilita(&get_field_any(
        row,
        &["visibilita", "Visibilita", "VISIBILITA"],
    ));
    AppuntoRecord {
        id: row.get("id").map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| json_to_string(v))
        }),
        user_id: get_field_any(row, &["user_id", "UserId", "USER_ID"]),
        autore_username: get_field_any(
            row,
            &["autore_username", "AutoreUsername", "autore"],
        ),
        data,
        testo: get_field_any(row, &["testo", "Testo", "TESTSTO"]),
        fatto,
        ordine,
        visibilita,
        destinatari: Vec::new(),
        destinatari_nomi: Vec::new(),
        num_risposte: 0,
    }
}

/// Normalizza data giorno: accetta YYYY-MM-DD o DD/MM/YYYY → YYYY-MM-DD
fn normalize_appunto_data(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.len() >= 10 && s.chars().nth(4) == Some('-') {
        return Ok(s.chars().take(10).collect());
    }
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 3 {
        let d = parts[0].trim();
        let m = parts[1].trim();
        let y = parts[2].trim();
        if y.len() == 4 && !d.is_empty() && !m.is_empty() {
            return Ok(format!(
                "{}-{:0>2}-{:0>2}",
                y,
                m.parse::<u32>().unwrap_or(0),
                d.parse::<u32>().unwrap_or(0)
            ));
        }
    }
    Err(format!("Data appunto non valida: {}", raw))
}

async fn enrich_appunti_destinatari(
    client: &SupabaseClient,
    list: &mut [AppuntoRecord],
    nomi: &HashMap<String, String>,
) -> Result<(), String> {
    for a in list.iter_mut() {
        if a.visibilita != "selezionati" {
            continue;
        }
        let Some(ref id) = a.id else { continue };
        let rows = client
            .fetch_appunti_destinatari_for_appunto(id)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        let mut ids = Vec::new();
        let mut labels = Vec::new();
        for r in rows {
            let uid = get_field_any(&r, &["user_id", "UserId", "USER_ID"]);
            if uid.is_empty() {
                continue;
            }
            let nom = nomi
                .get(&uid)
                .cloned()
                .unwrap_or_else(|| uid.clone());
            ids.push(uid);
            labels.push(nom);
        }
        a.destinatari = ids;
        a.destinatari_nomi = labels;
    }
    Ok(())
}

#[tauri::command]
async fn get_utenti_per_appunti(user_id: String) -> Result<Vec<UtenteAppuntiItem>, String> {
    let uid = user_id.trim();
    if uid.is_empty() {
        return Err("user_id obbligatorio".to_string());
    }
    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_user_permissions(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        let mut list: Vec<UtenteAppuntiItem> = rows
            .iter()
            .map(supabase_row_to_user_permissions)
            .filter(|p| !p.user_id.trim().is_empty())
            // Solo chi può vedere l'Agenda (admin o permesso sidebar "appunti")
            .filter(user_can_see_agenda)
            .map(|p| {
                let user_id = p.user_id;
                let username = if p.username.trim().is_empty() {
                    user_id.clone()
                } else {
                    p.username
                };
                UtenteAppuntiItem { user_id, username }
            })
            .collect();
        list.sort_by(|a, b| {
            a.username
                .to_lowercase()
                .cmp(&b.username.to_lowercase())
        });
        Ok(list)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn get_appunti_giorno(user_id: String, data: String) -> Result<Vec<AppuntoRecord>, String> {
    let uid = user_id.trim().to_string();
    let day = normalize_appunto_data(&data)?;
    if uid.is_empty() {
        return Err("user_id obbligatorio".to_string());
    }
    println!("=== get_appunti_giorno user_id={} data={} ===", uid, day);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let mut by_id: HashMap<String, AppuntoRecord> = HashMap::new();

        // 1) I miei
        let miei = client
            .fetch_appunti_by_owner_day(&uid, &day)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        for row in &miei {
            let a = supabase_row_to_appunto(row);
            if let Some(ref id) = a.id {
                by_id.insert(id.clone(), a);
            }
        }

        // 2) Visibili a tutti (quel giorno)
        match client.fetch_appunti_tutti_day(&day).await {
            Ok(tutti) => {
                for row in &tutti {
                    let a = supabase_row_to_appunto(row);
                    if let Some(ref id) = a.id {
                        by_id.entry(id.clone()).or_insert(a);
                    }
                }
            }
            Err(e) => {
                // Colonna visibilita assente: solo privati
                println!("⚠️ fetch appunti tutti: {} (esegui SQL aggiornato?)", e);
            }
        }

        // 3) Dove sono destinatario
        match client.fetch_appunti_destinatari_for_user(&uid).await {
            Ok(dest_rows) => {
                let mut ids: Vec<String> = dest_rows
                    .iter()
                    .map(|r| get_field_any(r, &["appunto_id", "AppuntoId", "appuntoId"]))
                    .filter(|s| !s.is_empty())
                    .collect();
                ids.sort();
                ids.dedup();
                if !ids.is_empty() {
                    let shared = client
                        .fetch_appunti_by_ids(&ids)
                        .await
                        .map_err(|e| format_supabase_error(&e))?;
                    for row in &shared {
                        let a = supabase_row_to_appunto(row);
                        if a.data != day {
                            continue;
                        }
                        if let Some(ref id) = a.id {
                            by_id.entry(id.clone()).or_insert(a);
                        }
                    }
                }
            }
            Err(e) => {
                println!("⚠️ fetch destinatari appunti: {} (esegui SQL aggiornato?)", e);
            }
        }

        // Mappa username
        let mut nomi: HashMap<String, String> = HashMap::new();
        if let Ok(perm_rows) = client.fetch_user_permissions(None).await {
            for row in &perm_rows {
                let p = supabase_row_to_user_permissions(row);
                if !p.user_id.is_empty() {
                    let label = if p.username.trim().is_empty() {
                        p.user_id.clone()
                    } else {
                        p.username.clone()
                    };
                    nomi.insert(p.user_id, label);
                }
            }
        }

        let mut list: Vec<AppuntoRecord> = by_id.into_values().collect();
        for a in &mut list {
            if a.autore_username.trim().is_empty() {
                if let Some(n) = nomi.get(&a.user_id) {
                    a.autore_username = n.clone();
                }
            }
        }
        enrich_appunti_destinatari(client, &mut list, &nomi).await?;

        // Conteggio risposte
        let ids: Vec<String> = list.iter().filter_map(|a| a.id.clone()).collect();
        if !ids.is_empty() {
            match client.fetch_appunti_risposte_by_appunti(&ids).await {
                Ok(risp) => {
                    let mut counts: HashMap<String, i32> = HashMap::new();
                    for r in &risp {
                        let aid = get_field_any(r, &["appunto_id", "AppuntoId"]);
                        if !aid.is_empty() {
                            *counts.entry(aid).or_insert(0) += 1;
                        }
                    }
                    for a in &mut list {
                        if let Some(ref id) = a.id {
                            a.num_risposte = *counts.get(id).unwrap_or(&0);
                        }
                    }
                }
                Err(e) => {
                    println!("⚠️ Conteggio risposte non disponibile: {}", e);
                }
            }
        }

        list.sort_by(|a, b| {
            let own_a = if a.user_id == uid { 0 } else { 1 };
            let own_b = if b.user_id == uid { 0 } else { 1 };
            own_a
                .cmp(&own_b)
                .then_with(|| a.ordine.cmp(&b.ordine))
                .then_with(|| {
                    a.autore_username
                        .to_lowercase()
                        .cmp(&b.autore_username.to_lowercase())
                })
        });

        println!("✓ Appunti giorno {}: {} riga/e", day, list.len());
        Ok(list)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn pulisci_testo_ricerca(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !matches!(c, '%' | '*' | ',' | '(' | ')' | '&' | '=' | '\\' | '"' | '\''))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Cerca negli appunti visibili all'utente (propri, per tutti, o dove è destinatario).
#[tauri::command]
async fn cerca_appunti(
    user_id: String,
    testo: String,
    modo: Option<String>,
) -> Result<Vec<AppuntoRecord>, String> {
    let uid = user_id.trim().to_string();
    let q = pulisci_testo_ricerca(&testo);
    let esatto = modo
        .as_deref()
        .unwrap_or("contenuto")
        .trim()
        .eq_ignore_ascii_case("esatto");
    if uid.is_empty() {
        return Err("user_id obbligatorio".to_string());
    }
    if q.is_empty() || (!esatto && q.chars().count() < 2) {
        return Err(if esatto {
            "Scrivi il testo esatto dell'appunto".to_string()
        } else {
            "Scrivi almeno 2 lettere".to_string()
        });
    }
    println!(
        "=== cerca_appunti user_id={} modo={} testo='{}' ===",
        uid,
        if esatto { "esatto" } else { "contenuto" },
        q
    );

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let mut by_id: HashMap<String, AppuntoRecord> = HashMap::new();
    let inserisci = |by_id: &mut HashMap<String, AppuntoRecord>, rows: &[serde_json::Value]| {
        for row in rows {
            let a = supabase_row_to_appunto(row);
            if let Some(ref id) = a.id {
                by_id.entry(id.clone()).or_insert(a);
            }
        }
    };

    let miei = client
        .fetch_appunti_testo(&format!("user_id=eq.{}", uid), &q, esatto)
        .await
        .map_err(|e| format_supabase_error(&e))?;
    inserisci(&mut by_id, &miei);

    match client
        .fetch_appunti_testo("visibilita=eq.tutti", &q, esatto)
        .await
    {
        Ok(tutti) => inserisci(&mut by_id, &tutti),
        Err(e) => println!("⚠️ cerca appunti tutti: {}", e),
    }

    if let Ok(dest_rows) = client.fetch_appunti_destinatari_for_user(&uid).await {
        let mut ids: Vec<String> = dest_rows
            .iter()
            .map(|r| get_field_any(r, &["appunto_id", "AppuntoId", "appuntoId"]))
            .filter(|s| !s.is_empty())
            .collect();
        ids.sort();
        ids.dedup();
        if !ids.is_empty() {
            let filtro = format!("id=in.({})", ids.join(","));
            match client.fetch_appunti_testo(&filtro, &q, esatto).await {
                Ok(shared) => inserisci(&mut by_id, &shared),
                Err(e) => println!("⚠️ cerca appunti condivisi: {}", e),
            }
        }
    }

    let mut nomi: HashMap<String, String> = HashMap::new();
    if let Ok(perm_rows) = client.fetch_user_permissions(None).await {
        for row in &perm_rows {
            let p = supabase_row_to_user_permissions(row);
            if !p.user_id.is_empty() {
                let label = if p.username.trim().is_empty() {
                    p.user_id.clone()
                } else {
                    p.username.clone()
                };
                nomi.insert(p.user_id, label);
            }
        }
    }

    let mut list: Vec<AppuntoRecord> = by_id.into_values().collect();
    for a in &mut list {
        if a.autore_username.trim().is_empty() {
            if let Some(n) = nomi.get(&a.user_id) {
                a.autore_username = n.clone();
            }
        }
    }
    list.sort_by(|a, b| b.data.cmp(&a.data).then_with(|| b.testo.cmp(&a.testo)));
    list.truncate(40);
    println!("✓ Ricerca appunti '{}': {} risultato/i", q, list.len());
    Ok(list)
}

#[tauri::command]
async fn save_appunto(appunto: AppuntoRecord) -> Result<AppuntoRecord, String> {
    let uid = appunto.user_id.trim().to_string();
    let day = normalize_appunto_data(&appunto.data)?;
    let testo = appunto.testo.trim().to_string();
    let visibilita = normalize_visibilita(&appunto.visibilita);
    if uid.is_empty() {
        return Err("user_id obbligatorio".to_string());
    }
    if testo.is_empty() {
        return Err("Il testo dell'appunto non può essere vuoto".to_string());
    }

    let mut destinatari: Vec<String> = appunto
        .destinatari
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != &uid)
        .collect();
    destinatari.sort();
    destinatari.dedup();

    if visibilita == "selezionati" && destinatari.is_empty() {
        return Err("Seleziona almeno un destinatario".to_string());
    }
    if visibilita != "selezionati" {
        destinatari.clear();
    }

    let autore = appunto.autore_username.trim().to_string();

    println!(
        "=== save_appunto user_id={} data={} vis={} id={:?} dest={} ===",
        uid,
        day,
        visibilita,
        appunto.id,
        destinatari.len()
    );

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let row_id = appunto
            .id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if let Some(ref id) = row_id {
            let filter = format!("id=eq.{}&user_id=eq.{}", id, uid);
            let owned = client
                .fetch_table("appunti", Some(&filter), None, None)
                .await
                .map_err(|e| format_supabase_error(&e))?;
            if owned.is_empty() {
                return Err("Solo l'autore può modificare questo appunto".to_string());
            }
        }

        let mut body = serde_json::Map::new();
        if row_id.is_none() {
            body.insert("user_id".to_string(), serde_json::json!(uid));
        }
        // Sempre aggiornabile (serve per spostare l'appunto su un'altra data)
        body.insert("data".to_string(), serde_json::json!(day));
        body.insert("testo".to_string(), serde_json::json!(testo));
        body.insert("fatto".to_string(), serde_json::json!(appunto.fatto));
        body.insert("ordine".to_string(), serde_json::json!(appunto.ordine));
        body.insert("visibilita".to_string(), serde_json::json!(visibilita));
        if !autore.is_empty() {
            body.insert("autore_username".to_string(), serde_json::json!(autore));
        }
        body.insert(
            "updated_at".to_string(),
            serde_json::json!(chrono::Utc::now().to_rfc3339()),
        );

        let saved = match client.upsert_appunto(&body, row_id.as_deref()).await {
            Ok(row) => row,
            Err(e) => {
                let msg = e.to_string();
                let manca_colonna = msg.contains("PGRST204")
                    || msg.contains("autore_username")
                    || msg.contains("visibilita")
                    || msg.contains("schema cache");
                if manca_colonna {
                    if visibilita != "privato" || !destinatari.is_empty() {
                        return Err(
                            "Per condividere gli appunti aggiorna Supabase:\n\
                             SQL Editor → esegui il file supabase-appunti-upgrade.sql\n\
                             (poi riprova)."
                                .to_string(),
                        );
                    }
                    // Schema vecchio: salva solo i campi base (Solo io)
                    println!("⚠️ Colonne condivisione assenti: salvataggio compatibile (solo privato)");
                    body.remove("visibilita");
                    body.remove("autore_username");
                    client
                        .upsert_appunto(&body, row_id.as_deref())
                        .await
                        .map_err(|e2| format_supabase_error(&e2))?
                } else {
                    return Err(format_supabase_error(&msg));
                }
            }
        };
        let mut out = supabase_row_to_appunto(&saved);
        let saved_id = out
            .id
            .clone()
            .ok_or_else(|| "Appunto salvato senza id".to_string())?;

        if visibilita == "selezionati" || !destinatari.is_empty() {
            client
                .replace_appunti_destinatari(&saved_id, &destinatari)
                .await
                .map_err(|e| {
                    format!(
                        "{}\n\nEsegui su Supabase: supabase-appunti-upgrade.sql",
                        format_supabase_error(&e)
                    )
                })?;
        } else {
            // Pulisci eventuali destinatari; se la tabella non esiste ancora, ignora
            if let Err(e) = client.replace_appunti_destinatari(&saved_id, &[]).await {
                println!("⚠️ Destinatari non aggiornati (tabella assente?): {}", e);
            }
        }

        out.destinatari = destinatari;
        out.visibilita = visibilita;
        if out.autore_username.is_empty() {
            out.autore_username = autore;
        }
        Ok(out)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn delete_appunto(user_id: String, id: String) -> Result<(), String> {
    let uid = user_id.trim();
    let rid = id.trim();
    if uid.is_empty() || rid.is_empty() {
        return Err("user_id e id obbligatori".to_string());
    }
    println!("=== delete_appunto user_id={} id={} ===", uid, rid);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        client
            .delete_appunto(rid, uid)
            .await
            .map_err(|e| format_supabase_error(&e))
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn get_appunti_risposte(
    user_id: String,
    appunto_id: String,
) -> Result<Vec<AppuntoRispostaRecord>, String> {
    let uid = user_id.trim();
    let aid = appunto_id.trim();
    if uid.is_empty() || aid.is_empty() {
        return Err("user_id e appunto_id obbligatori".to_string());
    }
    println!("=== get_appunti_risposte user={} appunto={} ===", uid, aid);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let (ok, _) = utente_puo_accedere_appunto(client, aid, uid).await?;
        if !ok {
            return Err("Non hai accesso a questo appunto".to_string());
        }
        let rows = client
            .fetch_appunti_risposte(aid)
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("PGRST") || msg.contains("relation") || msg.contains("404") {
                    format!(
                        "{}\n\nEsegui su Supabase: supabase-appunti-risposte.sql",
                        format_supabase_error(&msg)
                    )
                } else {
                    format_supabase_error(&msg)
                }
            })?;
        Ok(rows.iter().map(supabase_row_to_risposta).collect())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn save_appunto_risposta(
    risposta: AppuntoRispostaRecord,
) -> Result<AppuntoRispostaRecord, String> {
    let uid = risposta.user_id.trim().to_string();
    let aid = risposta.appunto_id.trim().to_string();
    let testo = risposta.testo.trim().to_string();
    let username = risposta.username.trim().to_string();
    if uid.is_empty() || aid.is_empty() {
        return Err("user_id e appunto_id obbligatori".to_string());
    }
    if testo.is_empty() {
        return Err("La risposta non può essere vuota".to_string());
    }
    println!("=== save_appunto_risposta user={} appunto={} ===", uid, aid);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let (ok, vis) = utente_puo_accedere_appunto(client, &aid, &uid).await?;
        if !ok {
            return Err("Non hai accesso a questo appunto".to_string());
        }
        if vis == "privato" {
            return Err("Le risposte sono disponibili solo sugli appunti condivisi (Persone scelte / Tutti)".to_string());
        }

        let mut body = serde_json::Map::new();
        body.insert("appunto_id".to_string(), serde_json::json!(aid));
        body.insert("user_id".to_string(), serde_json::json!(uid));
        body.insert("username".to_string(), serde_json::json!(username));
        body.insert("testo".to_string(), serde_json::json!(testo));

        let saved = client
            .insert_appunto_risposta(&body)
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("PGRST") || msg.contains("relation") || msg.contains("404") {
                    format!(
                        "{}\n\nEsegui su Supabase: supabase-appunti-risposte.sql",
                        format_supabase_error(&msg)
                    )
                } else {
                    format_supabase_error(&msg)
                }
            })?;
        Ok(supabase_row_to_risposta(&saved))
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn delete_appunto_risposta(user_id: String, id: String) -> Result<(), String> {
    let uid = user_id.trim();
    let rid = id.trim();
    if uid.is_empty() || rid.is_empty() {
        return Err("user_id e id obbligatori".to_string());
    }
    println!("=== delete_appunto_risposta user={} id={} ===", uid, rid);

    ensure_supabase_client().await?;
    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        client
            .delete_appunto_risposta(rid, uid)
            .await
            .map_err(|e| format_supabase_error(&e))
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn get_user_permissions(user_id: String) -> Result<Option<UserPermissionsRecord>, String> {
    println!(
        "=== get_user_permissions chiamato per user_id={} ===",
        user_id
    );

    let uid = user_id.trim();
    if uid.is_empty() {
        return Err("user_id vuoto".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let filter = format!("user_id=eq.{}", uid);
        let rows = client
            .fetch_user_permissions(Some(&filter))
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let perm = rows.first().map(supabase_row_to_user_permissions);
        if let Some(ref p) = perm {
            println!(
                "✓ Permessi: username={}, is_admin={}, programma={}",
                p.username, p.is_admin, p.programma
            );
        } else {
            println!("⚠️ Nessun record in user_permissions per questo utente");
        }
        Ok(perm)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

async fn ensure_caller_is_admin(admin_user_id: &str) -> Result<(), String> {
    let uid = admin_user_id.trim();
    if uid.is_empty() {
        return Err("Sessione admin non valida".to_string());
    }
    let perm = get_user_permissions(uid.to_string()).await?;
    match perm {
        Some(p) if p.is_admin => Ok(()),
        _ => Err("Solo gli amministratori possono gestire gli utenti".to_string()),
    }
}

#[tauri::command]
async fn get_all_user_permissions(
    admin_user_id: String,
) -> Result<Vec<UserPermissionsRecord>, String> {
    ensure_caller_is_admin(&admin_user_id).await?;
    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_user_permissions(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        let mut list: Vec<UserPermissionsRecord> =
            rows.iter().map(supabase_row_to_user_permissions).collect();
        list.sort_by(|a, b| {
            a.username
                .to_lowercase()
                .cmp(&b.username.to_lowercase())
        });
        Ok(list)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[derive(Debug, Deserialize)]
struct UpdateUserPermissionsPayload {
    admin_user_id: String,
    user_id: String,
    #[serde(default)]
    username: String,
    is_admin: bool,
    programma: bool,
    calendario: bool,
    /// JSON object voci sidebar (opzionale)
    #[serde(default)]
    sidebar_menu: Option<serde_json::Value>,
    /// Se valorizzata, aggiorna anche la password Auth
    #[serde(default)]
    nuova_password: Option<String>,
}

#[tauri::command]
async fn update_user_permissions(payload: UpdateUserPermissionsPayload) -> Result<(), String> {
    ensure_caller_is_admin(&payload.admin_user_id).await?;

    let user_id = payload.user_id.trim();
    if user_id.is_empty() {
        return Err("user_id mancante".to_string());
    }

    let username = payload.username.trim().to_string();
    if username.is_empty() {
        return Err("Username obbligatorio".to_string());
    }

    ensure_supabase_client().await?;

    let mut body = serde_json::Map::new();
    body.insert("username".to_string(), serde_json::json!(username));
    body.insert("is_admin".to_string(), serde_json::json!(payload.is_admin));
    body.insert("Programma".to_string(), serde_json::json!(payload.programma));
    body.insert("Calendario".to_string(), serde_json::json!(payload.calendario));
    if let Some(ref menu) = payload.sidebar_menu {
        // Salva come testo JSON (colonna text) — compatibile anche con jsonb
        let as_text = if menu.is_string() {
            menu.as_str().unwrap_or("{}").to_string()
        } else {
            menu.to_string()
        };
        body.insert("SidebarMenu".to_string(), serde_json::json!(as_text));
    }

    {
        let client_guard = get_supabase_client().lock().await;
        let client = client_guard
            .as_ref()
            .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
        client.patch_user_permissions(user_id, &body).await?;

        let pwd = payload
            .nuova_password
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        if let Some(p) = pwd {
            if p.len() < 6 {
                return Err("La password deve avere almeno 6 caratteri".to_string());
            }
            client
                .admin_update_auth_user(user_id, Some(p), Some(&username))
                .await?;
        } else {
            // Aggiorna solo display name / metadata in Auth
            let _ = client
                .admin_update_auth_user(user_id, None, Some(&username))
                .await;
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
struct DeleteAppUserPayload {
    admin_user_id: String,
    user_id: String,
}

#[tauri::command]
async fn delete_app_user(payload: DeleteAppUserPayload) -> Result<(), String> {
    ensure_caller_is_admin(&payload.admin_user_id).await?;

    let user_id = payload.user_id.trim();
    if user_id.is_empty() {
        return Err("user_id mancante".to_string());
    }

    if user_id == payload.admin_user_id.trim() {
        return Err("Non puoi eliminare il tuo stesso account mentre sei collegato.".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    // Prima i permessi app, poi Auth (così non resta un accesso “orfano”)
    client.delete_user_permissions(user_id).await?;

    if let Err(e) = client.admin_delete_auth_user(user_id).await {
        // Permessi già rimossi: segnala comunque il problema Auth
        return Err(format!(
            "Utente rimosso da user_permissions, ma eliminazione Auth fallita: {}",
            e
        ));
    }

    println!("✓ Utente {} eliminato (permissions + Auth)", user_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct CreateAppUserPayload {
    admin_user_id: String,
    email: String,
    password: String,
    username: String,
    is_admin: bool,
    programma: bool,
    calendario: bool,
    #[serde(default)]
    sidebar_menu: Option<serde_json::Value>,
}

#[tauri::command]
async fn create_app_user(payload: CreateAppUserPayload) -> Result<UserPermissionsRecord, String> {
    ensure_caller_is_admin(&payload.admin_user_id).await?;

    let email = payload.email.trim();
    let password = payload.password.trim();
    let username = payload.username.trim();
    if email.is_empty() || password.is_empty() {
        return Err("Email e password sono obbligatorie".to_string());
    }
    if password.len() < 6 {
        return Err("La password deve avere almeno 6 caratteri".to_string());
    }

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let (user_id, auth_nuovo) = client.admin_ensure_auth_user(email, password).await?;

    let display_name = if username.is_empty() {
        email.split('@').next().unwrap_or(email).to_string()
    } else {
        username.to_string()
    };

    let sidebar_val = payload
        .sidebar_menu
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    let sidebar_text = if sidebar_val.is_string() {
        sidebar_val.as_str().unwrap_or("{}").to_string()
    } else {
        sidebar_val.to_string()
    };

    let row = serde_json::json!({
        "user_id": user_id,
        "username": display_name,
        "is_admin": payload.is_admin,
        "Programma": payload.programma,
        "Calendario": payload.calendario,
        "SidebarMenu": sidebar_text,
        "can_insert": payload.is_admin || payload.programma,
        "can_update": payload.is_admin || payload.programma,
        "can_delete": payload.is_admin,
        "can_export": payload.is_admin || payload.programma
    });

    client
        .upsert_user_permissions(&user_id, &row)
        .await
        .map_err(|e| {
            format!(
                "Errore salvataggio permessi (user_id={}): {}",
                user_id, e
            )
        })?;

    // Allinea anche i metadati Auth (nome visualizzato)
    let _ = client
        .admin_update_auth_user(&user_id, None, Some(&display_name))
        .await;

    println!(
        "✓ Utente {} (auth_nuovo={}, user_id={}, username={})",
        email, auth_nuovo, user_id, display_name
    );

    Ok(UserPermissionsRecord {
        user_id,
        username: display_name,
        is_admin: payload.is_admin,
        programma: payload.programma,
        calendario: payload.calendario,
        sidebar_menu: sidebar_val,
    })
}

fn stati_servizio_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut stati: Vec<String> = Vec::new();

    for row in rows {
        let value = lookup_stato_servizio_value(row);
        if value.is_empty() {
            continue;
        }
        if !stati.iter().any(|s| s.eq_ignore_ascii_case(&value)) {
            stati.push(value);
        }
    }

    stati
}

#[tauri::command]
async fn get_all_stati_servizio() -> Result<Vec<String>, String> {
    println!("=== get_all_stati_servizio chiamato (Supabase / StatoDelServizio_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_stati_del_servizio(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let stati = stati_servizio_da_righe(&rows);

        if stati.is_empty() && !rows.is_empty() {
            if let Some(first) = rows.first().and_then(|r| r.as_object()) {
                let mut keys: Vec<&String> = first.keys().collect();
                keys.sort();
                println!(
                    "⚠️ 0 stati servizio estratti su {} righe — verifica colonna StatoServizio. Colonne: {:?}",
                    rows.len(),
                    keys.iter().map(|k| k.as_str()).collect::<Vec<_>>()
                );
            }
        }

        println!("✓ Caricati {} stati servizio da Supabase", stati.len());
        Ok(stati)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn normalizza_motivazione_testo(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn motivazioni_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut motivazioni: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(row, &["Motivazione", "MOTIVAZIONE"]);
            let trimmed = normalizza_motivazione_testo(value.trim());
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect();

    motivazioni.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    motivazioni.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    motivazioni
}

fn comuni_prelievo_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    valori_distinti_da_righe(
        rows,
        &["Prelievo_Comune", "PRELIEVO_COMUNE", "Prelievo_comune"],
    )
}

fn valori_distinti_da_righe(rows: &[serde_json::Value], candidates: &[&str]) -> Vec<String> {
    let mut valori: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(row, candidates);
            let trimmed = normalizza_motivazione_testo(value.trim());
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect();

    valori.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    valori.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    valori
}

#[derive(Debug, Serialize)]
struct LocalitaAutocompleteServizi {
    comuni_prelievo: Vec<String>,
    luoghi_prelievo: Vec<String>,
    comuni_destinazione: Vec<String>,
    luoghi_destinazione: Vec<String>,
}

#[tauri::command]
async fn get_all_richiedenti() -> Result<Vec<String>, String> {
    println!("=== get_all_richiedenti chiamato (Supabase / Richiedenti_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_richiedenti(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let richiedenti = richiedenti_da_righe(&rows);
        println!("✓ Caricati {} richiedenti da Supabase", richiedenti.len());
        Ok(richiedenti)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn get_all_tipologie_socio() -> Result<Vec<String>, String> {
    println!("=== get_all_tipologie_socio chiamato (Supabase / TipoSocio_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_tipologie_socio(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let tipologie = tipologie_socio_da_righe(&rows);
        println!("✓ Caricate {} tipologie socio da Supabase", tipologie.len());
        Ok(tipologie)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn add_tipologia_socio(tipologia: String) -> Result<(), String> {
    let value = tipologia.trim();
    if value.is_empty() {
        return Ok(());
    }

    println!(
        "=== add_tipologia_socio TipologiaSocio='{}' (Supabase / TipoSocio_supa) ===",
        value
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_tipologie_socio(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let existing = tipologie_socio_da_righe(&rows);
        if dotazione_gia_presente(&existing, value) {
            println!("ℹ Tipologia già presente in tabella, skip insert");
            return Ok(());
        }

        client
            .insert_tipologia_socio(value)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        Ok(())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

fn dotazione_gia_presente(list: &[String], value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() {
        return false;
    }
    list.iter()
        .any(|item| item.trim().eq_ignore_ascii_case(v))
}

/// Voce di una tabella lookup (id + testo) per la gestione Impostazioni
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LookupItemRecord {
    id: String,
    valore: String,
}

fn lookup_kind_meta(kind: &str) -> Result<(&'static str, &'static [&'static str], &'static str), String> {
    match kind.trim().to_lowercase().as_str() {
        "richiedenti" => Ok((
            "richiedenti",
            &[
                "TipoRichiedente",
                "TIPORICHIEDENTE",
                "Tipo_Richiedente",
                "Richiedente",
                "RICHIEDENTE",
                "Richiedenti",
                "RICHIEDENTI",
                "Descrizione",
                "DESCRIZIONE",
                "Nome",
                "NOME",
            ],
            "Richiedente",
        )),
        "tipo_socio" | "tiposocio" => Ok((
            "tipo_socio",
            &[
                "TipologiaSocio",
                "TIPOLOGIASOCIO",
                "TipoSocio",
                "TIPOSOCIO",
                "Tipologia",
                "TIPOLOGIA",
                "Descrizione",
                "Nome",
            ],
            "TipologiaSocio",
        )),
        "tipo_pagamenti" | "tipopagamenti" | "tipodi_pagamento" => Ok((
            "tipo_pagamenti",
            &[
                "ModoPagamento",
                "MODOPAGAMENTO",
                "Modo_Pagamento",
                "MODO_PAGAMENTO",
                "TipoPagamento",
                "TIPOPAGAMENTO",
                "Descrizione",
                "DESCRIZIONE",
                "Nome",
                "NOME",
            ],
            "ModoPagamento",
        )),
        "motivazioni_trasporto" | "motivazioni" => Ok((
            "motivazioni_trasporto",
            &[
                "Motivazione",
                "MOTIVAZIONE",
                "Motivazioni",
                "MOTIVAZIONI",
                "Descrizione",
                "DESCRIZIONE",
                "Nome",
                "NOME",
            ],
            "Motivazione",
        )),
        "mansioni" => Ok((
            "mansioni",
            &["Mansione", "MANSIONE", "mansione"],
            "Mansione",
        )),
        other => Err(format!(
            "Tipo lookup non supportato: '{}'. Usa richiedenti, tipo_socio, tipo_pagamenti, motivazioni_trasporto, mansioni",
            other
        )),
    }
}

fn row_id_any(row: &serde_json::Value) -> String {
    for name in ["id", "Id", "ID"] {
        if let Some(v) = row.get(name) {
            let s = json_to_string(v).trim().to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    if let Some(obj) = row.as_object() {
        for (key, val) in obj {
            if key.eq_ignore_ascii_case("id") {
                let s = json_to_string(val).trim().to_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    String::new()
}

fn resolve_lookup_text_column(
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_column: &str,
) -> String {
    if let Some(row) = row {
        for name in candidates {
            if row.get(*name).is_some() {
                return (*name).to_string();
            }
        }
        if let Some(obj) = row.as_object() {
            for name in candidates {
                let lower = name.to_lowercase();
                for (key, _) in obj {
                    if key.to_lowercase() == lower {
                        return key.clone();
                    }
                }
            }
        }
    }
    default_column.to_string()
}

fn lookup_item_from_row(
    row: &serde_json::Value,
    candidates: &[&str],
) -> Option<LookupItemRecord> {
    let id = row_id_any(row);
    if id.is_empty() {
        return None;
    }
    let valore = get_field_any(row, candidates).trim().to_string();
    Some(LookupItemRecord { id, valore })
}

async fn fetch_lookup_rows(
    client: &SupabaseClient,
    table_type: &str,
) -> Result<Vec<serde_json::Value>, String> {
    match table_type {
        "richiedenti" => client.fetch_richiedenti(None).await,
        "tipo_socio" => client.fetch_tipologie_socio(None).await,
        "tipo_pagamenti" => client.fetch_tipi_pagamento(None).await,
        "motivazioni_trasporto" => client.fetch_motivazioni_trasporto(None).await,
        "mansioni" => client.fetch_mansioni(None).await,
        other => Err(format!("Tabella lookup sconosciuta: {}", other)),
    }
    .map_err(|e| format_supabase_error(&e))
}

#[tauri::command]
async fn get_lookup_items(kind: String) -> Result<Vec<LookupItemRecord>, String> {
    let (table_type, candidates, _) = lookup_kind_meta(&kind)?;
    println!(
        "=== get_lookup_items kind='{}' table='{}' ===",
        kind, table_type
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let rows = fetch_lookup_rows(client, table_type).await?;
    let mut items: Vec<LookupItemRecord> = rows
        .iter()
        .filter_map(|row| lookup_item_from_row(row, candidates))
        .collect();

    items.sort_by(|a, b| a.valore.to_lowercase().cmp(&b.valore.to_lowercase()));
    println!("✓ Caricati {} elementi lookup {}", items.len(), table_type);
    Ok(items)
}

#[tauri::command]
async fn add_lookup_item(kind: String, valore: String) -> Result<(), String> {
    let value = valore.trim();
    if value.is_empty() {
        return Err("Il valore non può essere vuoto".to_string());
    }

    let (table_type, candidates, default_column) = lookup_kind_meta(&kind)?;
    println!(
        "=== add_lookup_item kind='{}' valore='{}' ===",
        kind, value
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let rows = fetch_lookup_rows(client, table_type).await?;
    let existing: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let v = get_field_any(row, candidates).trim().to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        })
        .collect();

    if dotazione_gia_presente(&existing, value) {
        return Err(format!("Il valore '{}' esiste già", value));
    }

    if table_type == "mansioni" {
        return add_mansione_riga(client, &rows, value).await;
    }

    let column = resolve_lookup_text_column(rows.first(), candidates, default_column);
    client
        .insert_lookup_text(table_type, &column, value)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    println!("✓ Inserito lookup {} {}='{}'", table_type, column, value);
    Ok(())
}

#[tauri::command]
async fn update_lookup_item(kind: String, id: String, valore: String) -> Result<(), String> {
    let id = id.trim().to_string();
    let value = valore.trim();
    if id.is_empty() {
        return Err("Id mancante".to_string());
    }
    if value.is_empty() {
        return Err("Il valore non può essere vuoto".to_string());
    }

    let (table_type, candidates, default_column) = lookup_kind_meta(&kind)?;
    println!(
        "=== update_lookup_item kind='{}' id='{}' valore='{}' ===",
        kind, id, value
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let rows = fetch_lookup_rows(client, table_type).await?;
    let row = rows
        .iter()
        .find(|r| row_id_any(r) == id)
        .ok_or_else(|| format!("Riga id={} non trovata in {}", id, table_type))?;

    let column = resolve_lookup_text_column(Some(row), candidates, default_column);
    let mut body = serde_json::Map::new();
    body.insert(column.clone(), serde_json::json!(value));

    client
        .patch_lookup_by_id(table_type, &id, &body)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    println!("✓ Aggiornato lookup {} id={} {}='{}'", table_type, id, column, value);
    Ok(())
}

#[tauri::command]
async fn delete_lookup_item(kind: String, id: String) -> Result<(), String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Id mancante".to_string());
    }

    let (table_type, _, _) = lookup_kind_meta(&kind)?;
    println!("=== delete_lookup_item kind='{}' id='{}' ===", kind, id);

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .delete_lookup_by_id(table_type, &id)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    println!("✓ Eliminato lookup {} id={}", table_type, id);
    Ok(())
}

/// Mansione operatore (Mansioni_supa): etichetta della casella e codice salvato in Disponibilita
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MansioneRecord {
    id: String,
    mansione: String,
    codice: String,
    ordine: i64,
    attiva: bool,
}

/// "Nonno Vigile" → "NONNO_VIGILE" (stesso formato dei codici già salvati sui soci)
fn codice_mansione_da_testo(testo: &str) -> String {
    let mut codice = String::new();
    for ch in testo.trim().to_uppercase().chars() {
        let ch = match ch {
            'À' | 'Á' => 'A',
            'È' | 'É' => 'E',
            'Ì' | 'Í' => 'I',
            'Ò' | 'Ó' => 'O',
            'Ù' | 'Ú' => 'U',
            c => c,
        };
        if ch.is_ascii_alphanumeric() {
            codice.push(ch);
        } else if !codice.ends_with('_') {
            codice.push('_');
        }
    }
    codice.trim_matches('_').to_string()
}

fn mansione_from_row(row: &serde_json::Value) -> Option<MansioneRecord> {
    let id = row_id_any(row);
    let mansione = get_field_any(row, &["Mansione", "MANSIONE", "mansione"])
        .trim()
        .to_string();
    if id.is_empty() || mansione.is_empty() {
        return None;
    }
    let codice = {
        let c = get_field_any(row, &["Codice", "CODICE", "codice"]).trim().to_uppercase();
        if c.is_empty() {
            codice_mansione_da_testo(&mansione)
        } else {
            c
        }
    };
    let ordine = get_field_any(row, &["Ordine", "ORDINE", "ordine"])
        .trim()
        .parse::<i64>()
        .unwrap_or(0);
    let attiva = get_bool_field(row, &["Attiva", "ATTIVA", "attiva"]) != "false";
    Some(MansioneRecord {
        id,
        mansione,
        codice,
        ordine,
        attiva,
    })
}

async fn add_mansione_riga(
    client: &SupabaseClient,
    rows: &[serde_json::Value],
    mansione: &str,
) -> Result<(), String> {
    let codice = codice_mansione_da_testo(mansione);
    if codice.is_empty() {
        return Err("Il nome della mansione deve contenere lettere o numeri".to_string());
    }

    let esistenti: Vec<MansioneRecord> = rows.iter().filter_map(mansione_from_row).collect();
    if esistenti.iter().any(|m| m.codice == codice) {
        return Err(format!("Esiste già una mansione con codice {}", codice));
    }
    let ordine = esistenti.iter().map(|m| m.ordine).max().unwrap_or(0) + 1;

    let mut body = serde_json::Map::new();
    body.insert("Mansione".to_string(), serde_json::json!(mansione));
    body.insert("Codice".to_string(), serde_json::json!(codice));
    body.insert("Ordine".to_string(), serde_json::json!(ordine));

    client
        .insert_mansione(&body)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    println!("✓ Inserita mansione '{}' codice={} ordine={}", mansione, codice, ordine);
    Ok(())
}

#[tauri::command]
async fn get_mansioni() -> Result<Vec<MansioneRecord>, String> {
    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let rows = client
        .fetch_mansioni(None)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    let mut mansioni: Vec<MansioneRecord> = rows.iter().filter_map(mansione_from_row).collect();
    mansioni.sort_by(|a, b| {
        a.ordine
            .cmp(&b.ordine)
            .then_with(|| a.mansione.to_lowercase().cmp(&b.mansione.to_lowercase()))
    });
    println!("✓ Caricate {} mansioni", mansioni.len());
    Ok(mansioni)
}

fn dotazioni_da_righe(rows: &[serde_json::Value]) -> Vec<String> {
    let mut dotazioni: Vec<String> = rows
        .iter()
        .filter_map(|row| {
            let value = get_field_any(row, &["Dotazione", "DOTAZIONE", "dotazione"]);
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect();

    dotazioni.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    dotazioni.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    dotazioni
}

#[tauri::command]
async fn get_all_dotazioni_mezzi() -> Result<Vec<String>, String> {
    println!("=== get_all_dotazioni_mezzi chiamato (Supabase / DotazioniMezzi_supa) ===");

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_dotazioni_mezzi(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let dotazioni = dotazioni_da_righe(&rows);
        println!("✓ Caricate {} dotazioni mezzi da Supabase", dotazioni.len());
        Ok(dotazioni)
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

#[tauri::command]
async fn add_dotazione_mezzo(dotazione: String) -> Result<(), String> {
    let value = dotazione.trim();
    if value.is_empty() {
        return Ok(());
    }

    println!(
        "=== add_dotazione_mezzo Dotazione='{}' (Supabase / DotazioniMezzi_supa) ===",
        value
    );

    ensure_supabase_client().await?;

    let client_guard = get_supabase_client().lock().await;
    if let Some(client) = client_guard.as_ref() {
        let rows = client
            .fetch_dotazioni_mezzi(None)
            .await
            .map_err(|e| format_supabase_error(&e))?;

        let existing = dotazioni_da_righe(&rows);
        if dotazione_gia_presente(&existing, value) {
            println!("ℹ Dotazione già presente in tabella, skip insert");
            return Ok(());
        }

        client
            .insert_dotazione_mezzo(value)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        Ok(())
    } else {
        Err("Client Supabase non disponibile".to_string())
    }
}

// Comando per ottenere un servizio completo per ID (Supabase / Servizi_supa)
#[tauri::command]
async fn get_servizio_completo(servizio_id: u32) -> Result<ServizioCompleto, String> {
    println!("=== get_servizio_completo chiamato per ID: {} (Supabase) ===", servizio_id);

    let filter = format!("idservizio=eq.{}", servizio_id);
    let nominativi = fetch_idsocio_nominativo_map().await;
    let rows = fetch_servizi_supabase(Some(&filter)).await?;
    if let Some(mut row) = rows.into_iter().next() {
        allinea_id_operatore_riga(&mut row).await;
        if let Some(sc) = supabase_row_to_servizio_completo(&row, &nominativi) {
            return Ok(sc);
        }
    }

    let rows = fetch_servizi_supabase(None).await?;
    for mut row in rows {
        if servizio_id_from_row(&row) == servizio_id {
            allinea_id_operatore_riga(&mut row).await;
            if let Some(sc) = supabase_row_to_servizio_completo(&row, &nominativi) {
                return Ok(sc);
            }
        }
    }

    Err(format!("Servizio {} non trovato in Supabase", servizio_id))
}

#[tauri::command]
async fn get_motivazioni_servizi() -> Result<Vec<String>, String> {
    println!("=== get_motivazioni_servizi chiamato (Supabase) ===");
    let rows = fetch_motivazioni_servizi_supabase().await?;
    let lista = motivazioni_da_righe(&rows);
    println!("✓ Trovate {} motivazioni distinte da Supabase", lista.len());
    Ok(lista)
}

#[tauri::command]
async fn get_comuni_prelievo_servizi() -> Result<Vec<String>, String> {
    println!("=== get_comuni_prelievo_servizi chiamato (Supabase) ===");
    let rows = fetch_comuni_prelievo_servizi_supabase().await?;
    let lista = comuni_prelievo_da_righe(&rows);
    println!("✓ Trovati {} comuni prelievo distinti da Supabase", lista.len());
    Ok(lista)
}

#[tauri::command]
async fn get_localita_autocomplete_servizi() -> Result<LocalitaAutocompleteServizi, String> {
    println!("=== get_localita_autocomplete_servizi chiamato (Supabase) ===");
    let rows = fetch_localita_autocomplete_servizi_supabase().await?;
    let result = LocalitaAutocompleteServizi {
        comuni_prelievo: valori_distinti_da_righe(
            &rows,
            &["Prelievo_Comune", "PRELIEVO_COMUNE", "Prelievo_comune"],
        ),
        luoghi_prelievo: valori_distinti_da_righe(
            &rows,
            &[
                "Prelievo_Indirizzo",
                "PRELIEVO_INDIRIZZO",
                "Prelievo_indirizzo",
            ],
        ),
        comuni_destinazione: valori_distinti_da_righe(
            &rows,
            &[
                "Destinazione_Comune",
                "DESTINAZIONE_COMUNE",
                "Destinazione_comune",
            ],
        ),
        luoghi_destinazione: valori_distinti_da_righe(
            &rows,
            &[
                "Destinazione_Indirizzo",
                "DESTINAZIONE_INDIRIZZO",
                "Destinazione_indirizzo",
            ],
        ),
    };
    println!(
        "✓ Autocomplete località: comuni_prelievo={}, luoghi_prelievo={}, comuni_dest={}, luoghi_dest={}",
        result.comuni_prelievo.len(),
        result.luoghi_prelievo.len(),
        result.comuni_destinazione.len(),
        result.luoghi_destinazione.len()
    );
    Ok(result)
}

/// IdSocio che compaiono in almeno un servizio (per abilitare pulsante SERVIZI in elenco soci).
#[tauri::command]
async fn get_idsocio_con_servizi() -> Result<Vec<String>, String> {
    println!("=== get_idsocio_con_servizi chiamato ===");
    let rows = fetch_servizi_idsocio_supabase().await?;
    let mut set = std::collections::HashSet::new();
    for row in rows {
        let id = get_field_any(&row, &["IdSocio", "IDSOCIO"]);
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            set.insert(trimmed.to_string());
        }
    }
    let mut list: Vec<String> = set.into_iter().collect();
    list.sort_by(|a, b| {
        a.parse::<u64>()
            .unwrap_or(0)
            .cmp(&b.parse::<u64>().unwrap_or(0))
    });
    println!("✓ IdSocio con servizi: {}", list.len());
    Ok(list)
}

/// IdSocio e nominativi operatore presenti in almeno un servizio.
#[derive(Serialize)]
struct OperatoriConServiziResult {
    idsocios: Vec<String>,
    nominativi: Vec<String>,
}

/// Nominativi operatore presenti in almeno un servizio (campo OPERATORE principale).
#[tauri::command]
async fn get_operatori_con_servizi() -> Result<OperatoriConServiziResult, String> {
    println!("=== get_operatori_con_servizi chiamato ===");
    let nominativi = fetch_idsocio_nominativo_map().await;
    let rows = fetch_servizi_supabase(None).await?;
    let mut ids_set = std::collections::HashSet::new();
    let mut nom_set = std::collections::HashSet::new();

    for row in &rows {
        let id_op = get_field_any(row, &["IdOperatore", "IDOPERATORE", "Id_Operatore"]);
        if !id_op.trim().is_empty() {
            let key = normalize_idsocio_key(&id_op);
            if !key.is_empty() {
                ids_set.insert(key);
            }
        }
        let op = resolve_operatore_nome(row, &nominativi);
        let trimmed = op.trim();
        if !trimmed.is_empty() {
            nom_set.insert(trimmed.to_string());
        }
    }

    let mut idsocios: Vec<String> = ids_set.into_iter().collect();
    idsocios.sort_by(|a, b| {
        a.parse::<u64>()
            .unwrap_or(0)
            .cmp(&b.parse::<u64>().unwrap_or(0))
    });
    let mut nominativi_list: Vec<String> = nom_set.into_iter().collect();
    nominativi_list.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    println!(
        "✓ Operatori con servizi: {} idsocio, {} nominativi (da {} servizi)",
        idsocios.len(),
        nominativi_list.len(),
        rows.len()
    );

    Ok(OperatoriConServiziResult {
        idsocios,
        nominativi: nominativi_list,
    })
}

fn postgrest_valore(valore: &str) -> String {
    valore
        .trim()
        .chars()
        .filter(|c| !matches!(c, ',' | ':' | '(' | ')' | '"' | '*' | '%'))
        .collect::<String>()
        .trim()
        .to_string()
}

fn postgrest_ilike_contiene(valore: &str) -> Option<String> {
    let pulito: String = valore
        .trim()
        .chars()
        .filter(|c| *c != '*' && *c != '%' && *c != ',' && *c != '(' && *c != ')')
        .collect();
    let pulito = pulito.trim();
    if pulito.is_empty() {
        None
    } else {
        Some(format!("ilike.*{}*", pulito))
    }
}

fn postgrest_ilike_esatto(valore: &str) -> Option<String> {
    let pulito = postgrest_valore(valore);
    if pulito.is_empty() {
        None
    } else {
        Some(format!("ilike.{pulito}"))
    }
}

fn data_iso_valida(valore: &str) -> Option<String> {
    let s = valore.trim();
    if s.len() >= 10
        && s.as_bytes().get(4) == Some(&b'-')
        && s.as_bytes().get(7) == Some(&b'-')
        && s[..10].chars().all(|c| c.is_ascii_digit() || c == '-')
    {
        Some(s[..10].to_string())
    } else {
        None
    }
}

fn filtro_operatore_or(ids: &[String], nome: &str) -> Option<String> {
    let mut parti = Vec::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        parti.push(format!("IdOperatore.eq.{id}"));
        parti.push(format!("IdOperatore2.eq.{id}"));
    }
    if let Some(pattern) = postgrest_ilike_esatto(nome) {
        parti.push(format!("Oper.{pattern}"));
        parti.push(format!("Oper2.{pattern}"));
    }
    if parti.is_empty() {
        None
    } else {
        Some(format!("or({})", parti.join(",")))
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ServiziElencoPagina {
    servizi: Vec<ServizioCompleto>,
    totale: u64,
}

const COLONNE_ELENCO_SERVIZI: &str = "idservizio,Prelievo_Data,Prelievo_Ora,Prelievo_Comune,Prelievo_Indirizzo,Prelievo_Note,IdSocio,Trasportato,Sollevatore,Standard,Carrozzina,Richiedente,Motivazione,Destinazione_Data,Destinazione_Comune,Destinazione_Indirizzo,Destinazione_Note,Donazioni,Incassato,TipoPagamento,Oper,IdOperatore,Oper2,IdOperatore2,Mezzo,Km,Km_uscita,Km_rientro,Tempo,Bonifico_Data,Ricevuta_Data,Ricevuta_numero,StatoServizio,NoteFineServizio,Archiviazione,CreatoDa,ModificatoDa,created_at,update_at";

/// Una pagina dell'elenco. Il totale arriva da Supabase senza scaricare le altre righe.
#[tauri::command]
async fn get_servizi_elenco_pagina(
    anno: Option<u32>,
    tutti_anni: Option<bool>,
    escludi_archiviati: Option<bool>,
    offset: Option<u32>,
    limite: Option<u32>,
    idsocio: Option<String>,
    idservizio: Option<String>,
    trasportato: Option<String>,
    nominativo: Option<String>,
    data_da: Option<String>,
    data_a: Option<String>,
    stato_servizio: Option<String>,
    richiedente: Option<String>,
    stato_incasso: Option<String>,
    tipo_pagamento: Option<String>,
    tipo_servizio: Option<String>,
    carrozzina: Option<String>,
    operatore_ids: Option<Vec<String>>,
    operatore_nome: Option<String>,
) -> Result<ServiziElencoPagina, String> {
    ensure_supabase_client().await?;
    let tutti = tutti_anni.unwrap_or(false);
    let senza_archivio = escludi_archiviati.unwrap_or(false);
    let offset = offset.unwrap_or(0) as usize;
    let limite = limite.unwrap_or(50).clamp(1, 300) as usize;
    let year = anno.unwrap_or_else(|| Local::now().date_naive().year() as u32);

    let mut da = if tutti {
        None
    } else {
        Some(format!("{year}-01-01"))
    };
    let mut a = if tutti {
        None
    } else {
        Some(format!("{year}-12-31"))
    };
    if let Some(d) = data_da.as_deref().and_then(data_iso_valida) {
        if da.as_ref().map(|x| d.as_str() > x.as_str()).unwrap_or(true) {
            da = Some(d);
        }
    }
    if let Some(d) = data_a.as_deref().and_then(data_iso_valida) {
        if a.as_ref().map(|x| d.as_str() < x.as_str()).unwrap_or(true) {
            a = Some(d);
        }
    }

    let mut filtri: Vec<(String, String)> = Vec::new();
    if let Some(d) = da {
        filtri.push(("Prelievo_Data".into(), format!("gte.{d}")));
    }
    if let Some(d) = a {
        filtri.push(("Prelievo_Data".into(), format!("lte.{d}")));
    }
    if let Some(v) = idsocio.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        filtri.push(("IdSocio".into(), format!("eq.{}", postgrest_valore(v))));
    }
    if let Some(v) = idservizio.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if v.chars().all(|c| c.is_ascii_digit()) {
            filtri.push(("idservizio".into(), format!("eq.{v}")));
        }
    }
    if let Some(v) = trasportato.as_deref().and_then(postgrest_ilike_esatto) {
        filtri.push(("Trasportato".into(), v));
    }
    if let Some(v) = nominativo.as_deref().and_then(postgrest_ilike_contiene) {
        filtri.push(("Trasportato".into(), v));
    }
    if let Some(v) = stato_servizio.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        filtri.push(("StatoServizio".into(), format!("eq.{}", postgrest_valore(v))));
    }
    if let Some(v) = tipo_pagamento.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        filtri.push(("TipoPagamento".into(), format!("eq.{}", postgrest_valore(v))));
    }
    if let Some(v) = carrozzina.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        filtri.push(("Carrozzina".into(), format!("eq.{}", postgrest_valore(v))));
    }

    let richiedente_norm = richiedente
        .as_deref()
        .map(|s| s.trim().to_uppercase())
        .unwrap_or_default();
    if richiedente_norm == "ALTRI" {
        filtri.push(("Richiedente".into(), "not.eq.SOCIO".into()));
        filtri.push(("Richiedente".into(), "not.eq.COMUNE".into()));
        filtri.push(("Richiedente".into(), "not.eq.".into()));
    } else if !richiedente_norm.is_empty() {
        filtri.push(("Richiedente".into(), format!("eq.{richiedente_norm}")));
    }

    let tipo_norm = tipo_servizio
        .as_deref()
        .map(|s| s.trim().to_uppercase())
        .unwrap_or_default();
    if tipo_norm == "SOLLEVATORE" {
        filtri.push(("Sollevatore".into(), "eq.true".into()));
    } else if tipo_norm == "STANDARD" {
        filtri.push(("Standard".into(), "eq.true".into()));
    }

    let incasso_norm = stato_incasso
        .as_deref()
        .map(|s| s.trim().to_uppercase())
        .unwrap_or_default();

    let mut gruppi_or: Vec<String> = Vec::new();
    if senza_archivio {
        gruppi_or.push("or(Archiviazione.is.null,Archiviazione.eq.false)".into());
    }
    if incasso_norm == "DA INCASSARE" {
        gruppi_or.push("or(Incassato.is.null,Incassato.eq.)".into());
    } else if !incasso_norm.is_empty() {
        filtri.push(("Incassato".into(), format!("eq.{}", postgrest_valore(&incasso_norm))));
    }
    if tipo_norm == "STANDARD" {
        gruppi_or.push("or(Sollevatore.is.null,Sollevatore.eq.false)".into());
    }
    if let Some(gruppo) = filtro_operatore_or(
        operatore_ids.as_deref().unwrap_or(&[]),
        operatore_nome.as_deref().unwrap_or(""),
    ) {
        gruppi_or.push(gruppo);
    }
    match gruppi_or.len() {
        0 => {}
        1 => {
            let valore = gruppi_or[0]
                .strip_prefix("or")
                .unwrap_or(gruppi_or[0].as_str())
                .to_string();
            filtri.push(("or".into(), valore));
        }
        _ => {
            filtri.push(("and".into(), format!("({})", gruppi_or.join(","))));
        }
    }

    let ordini = ["Prelievo_Data.desc,idservizio.desc", "Prelievo_Data.desc"];
    let mut ultimo_errore = String::new();
    let client_guard = get_supabase_client().lock().await;
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    for order in ordini {
        for colonne in [COLONNE_ELENCO_SERVIZI, "*"] {
            match client
                .fetch_servizi_pagina(&filtri, colonne, order, offset, limite)
                .await
            {
                Ok((rows, totale)) => {
                    let vuoti = HashMap::new();
                    let servizi: Vec<ServizioCompleto> = rows
                        .iter()
                        .filter_map(|row| supabase_row_to_servizio_completo(row, &vuoti))
                        .collect();
                    println!(
                        "✓ Elenco servizi pagina: {} righe, totale {}",
                        servizi.len(),
                        totale
                    );
                    return Ok(ServiziElencoPagina { servizi, totale });
                }
                Err(e) => ultimo_errore = format_supabase_error(&e),
            }
        }
    }
    Err(ultimo_errore)
}

// Comando per ottenere tutti i servizi completi (Supabase / Servizi_supa)
// anno: filtra per anno di Prelievo_Data; tutti_anni=true scarica l'intero archivio
#[tauri::command]
async fn get_all_servizi_completi(
    anno: Option<u32>,
    tutti_anni: Option<bool>,
    limite: Option<u32>,
    escludi_archiviati: Option<bool>,
) -> Result<Vec<ServizioCompleto>, String> {
    let senza_archivio = escludi_archiviati.unwrap_or(false);
    if let Some(limite) = limite {
        if !tutti_anni.unwrap_or(false) {
            let year = anno.unwrap_or_else(|| Local::now().date_naive().year() as u32);
            let n = limite.clamp(1, 300);
            println!(
                "=== get_all_servizi_completi anteprima anno {} (primi {}){} ===",
                year,
                n,
                if senza_archivio { ", senza archiviati" } else { "" }
            );
            let filtro_anno = servizi_filter_anno(year);
            let filtro = if senza_archivio {
                servizi_filter_senza_archiviati(&filtro_anno)
            } else {
                filtro_anno.clone()
            };
            let (rows, filtro_ok) = match fetch_servizi_anteprima(&filtro, n as usize).await {
                Ok(rows) => (rows, true),
                Err(e) if senza_archivio => {
                    println!(
                        "⚠️ Filtro archiviati anteprima fallito ({}), riprovo senza",
                        e
                    );
                    (fetch_servizi_anteprima(&filtro_anno, n as usize).await?, false)
                }
                Err(e) => return Err(e),
            };
            let nominativi_vuoti = HashMap::new();
            let mut servizi: Vec<ServizioCompleto> = rows
                .iter()
                .filter_map(|row| supabase_row_to_servizio_completo(row, &nominativi_vuoti))
                .collect();
            if senza_archivio && !filtro_ok {
                servizi.retain(|s| !servizio_e_archiviato(&s.archivia));
            }
            sort_servizi_completi(&mut servizi);
            println!("✓ Anteprima elenco: {} servizi", servizi.len());
            return Ok(servizi);
        }
    }

    let nominativi = fetch_idsocio_nominativo_map().await;

    if tutti_anni.unwrap_or(false) {
        println!("=== get_all_servizi_completi chiamato (Supabase, TUTTI GLI ANNI) ===");
        let rows = fetch_servizi_supabase(None).await?;
        let mut servizi: Vec<ServizioCompleto> = rows
            .iter()
            .filter_map(|row| supabase_row_to_servizio_completo(row, &nominativi))
            .collect();
        sort_servizi_completi(&mut servizi);
        println!("✓ Convertiti {} servizi completi da Supabase", servizi.len());
        if let Some(s) = servizi.first() {
            println!(
                "  esempio: id={} data='{}' operatore='{}' id_operatore='{}' stato='{}'",
                s.id, s.data_prelievo, s.operatore, s.id_operatore, s.stato_servizio
            );
        }
        return Ok(servizi);
    }

    let year = anno.unwrap_or_else(|| Local::now().date_naive().year() as u32);
    println!(
        "=== get_all_servizi_completi chiamato (Supabase, anno {}){} ===",
        year,
        if senza_archivio { ", senza archiviati" } else { "" }
    );

    let filtro_anno = servizi_filter_anno(year);
    let filtro = if senza_archivio {
        servizi_filter_senza_archiviati(&filtro_anno)
    } else {
        filtro_anno.clone()
    };
    let (rows, filtered_at_db, archivio_filtrato) = match fetch_servizi_supabase(Some(&filtro)).await {
        Ok(r) => (r, true, senza_archivio),
        Err(e) if senza_archivio => {
            println!(
                "⚠️ Filtro archiviati fallito ({}), riprovo solo per anno",
                e
            );
            match fetch_servizi_supabase(Some(&filtro_anno)).await {
                Ok(r) => (r, true, false),
                Err(e2) => {
                    println!(
                        "⚠️ Filtro anno Supabase fallito ({}), recupero tutti i servizi: {}",
                        filtro_anno, e2
                    );
                    (fetch_servizi_supabase(None).await?, false, false)
                }
            }
        }
        Err(e) => {
            println!(
                "⚠️ Filtro anno Supabase fallito ({}), recupero tutti i servizi: {}",
                filtro, e
            );
            (fetch_servizi_supabase(None).await?, false, false)
        }
    };

    let mut servizi: Vec<ServizioCompleto> = rows
        .iter()
        .filter_map(|row| supabase_row_to_servizio_completo(row, &nominativi))
        .collect();

    if !filtered_at_db {
        let before = servizi.len();
        servizi.retain(|s| {
            parse_italian_date(&s.data_prelievo)
                .map(|d| d.year() as u32 == year)
                .unwrap_or(false)
        });
        if servizi.len() < before {
            println!(
                "  Filtro anno lato Rust: {} → {} servizi",
                before,
                servizi.len()
            );
        }
    }

    if senza_archivio && !archivio_filtrato {
        let before = servizi.len();
        servizi.retain(|s| !servizio_e_archiviato(&s.archivia));
        println!(
            "  Filtro archiviati lato Rust: {} → {} servizi",
            before,
            servizi.len()
        );
    }

    sort_servizi_completi(&mut servizi);

    if servizi.is_empty() && !rows.is_empty() {
        if let Some(first) = rows.first().and_then(|r| r.as_object()) {
            let mut keys: Vec<&String> = first.keys().collect();
            keys.sort();
            println!(
                "⚠️ 0 servizi convertiti su {} righe Supabase — verifica colonna idservizio. Colonne: {:?}",
                rows.len(),
                keys.iter().map(|k| k.as_str()).collect::<Vec<_>>()
            );
        }
    }

    println!("✓ Convertiti {} servizi completi da Supabase", servizi.len());
    if let Some(s) = servizi.first() {
        println!(
            "  esempio: id={} data='{}' operatore='{}' id_operatore='{}' stato='{}'",
            s.id, s.data_prelievo, s.operatore, s.id_operatore, s.stato_servizio
        );
    }
    let con_nome = servizi
        .iter()
        .filter(|s| !s.operatore.trim().is_empty())
        .count();
    let con_id = servizi
        .iter()
        .filter(|s| !s.id_operatore.trim().is_empty())
        .count();
    println!(
        "  operatori: {} con nominativo, {} con IdOperatore (su {})",
        con_nome,
        con_id,
        servizi.len()
    );
    Ok(servizi)
}

// Helper per formattare un valore in formato euro italiano (1.234,56 €)
fn format_euro_italiano(value_str: &str) -> String {
    if value_str.is_empty() {
        return String::new();
    }
    
    // Rimuovi spazi e caratteri non numerici (tranne punto, virgola e meno)
    let cleaned: String = value_str
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    
    if cleaned.is_empty() {
        return value_str.to_string();
    }
    
    // Sostituisci la virgola con punto per il parsing (formato italiano o inglese)
    let normalized = cleaned.replace(',', ".");
    
    // Prova a parsare come numero decimale
    match normalized.parse::<f64>() {
        Ok(num) => {
            // Se è negativo, gestiscilo
            let is_negative = num < 0.0;
            let abs_num = num.abs();
            
            // Formatta con 2 decimali
            let formatted = format!("{:.2}", abs_num);
            
            // Separa parte intera e decimale
            let parts: Vec<&str> = formatted.split('.').collect();
            let integer_part = parts[0];
            let decimal_part = if parts.len() > 1 { parts[1] } else { "00" };
            
            // Aggiungi punti come separatori delle migliaia (da destra a sinistra)
            let mut formatted_integer = String::new();
            let chars: Vec<char> = integer_part.chars().rev().collect();
            
            for (i, ch) in chars.iter().enumerate() {
                if i > 0 && i % 3 == 0 {
                    formatted_integer.push('.');
                }
                formatted_integer.push(*ch);
            }
            
            let formatted_integer: String = formatted_integer.chars().rev().collect();
            
            // Costruisci il risultato con virgola per i decimali e simbolo euro
            let sign = if is_negative { "-" } else { "" };
            format!("{}{},{}{} €", sign, formatted_integer, decimal_part, "")
        }
        Err(_) => {
            // Se non riesce a parsare, restituisci il valore originale
            value_str.to_string()
        }
    }
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

// Comando per aggiornare un servizio (Supabase / Servizi_supa)
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
    ensure_supabase_client().await?;

    let mut body = serde_json::Map::new();
    if let Some(op) = operatore {
        // IdOperatore è numerico; se arriva un nome testo non aggiorniamo il campo
        if op.parse::<i64>().is_ok() {
            body.insert("IdOperatore".to_string(), serde_json::json!(op));
        }
    }
    if let Some(d) = data {
        if let Some(parsed) = parse_italian_date(&d) {
            body.insert(
                "Prelievo_Data".to_string(),
                serde_json::json!(parsed.format("%Y-%m-%d").to_string()),
            );
        }
    }
    if let Some(nom) = nominativo {
        body.insert("Trasportato".to_string(), serde_json::json!(nom));
    }
    if let Some(ora) = ora_sotto_casa {
        body.insert("Prelievo_Ora".to_string(), serde_json::json!(ora));
    }
    if let Some(ora) = ora_destinazione {
        if let Some(parsed) = parse_italian_date(&ora) {
            body.insert(
                "Destinazione_Data".to_string(),
                serde_json::json!(parsed.format("%Y-%m-%d").to_string()),
            );
        }
    }
    if let Some(tipo) = tipo_servizio {
        body.insert("Motivazione".to_string(), serde_json::json!(tipo));
    }

    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .patch_servizio(id, &body)
        .await
        .map_err(|e| format_supabase_error(&e))
}

#[derive(Debug, Deserialize)]
struct UpdateServizioPayload {
    #[serde(default)]
    id: u32,
    data_prelievo: Option<String>,
    idsocio: Option<String>,
    socio_trasportato: Option<String>,
    ora_inizio: Option<String>,
    comune_prelievo: Option<String>,
    luogo_prelievo: Option<String>,
    tipo_servizio: Option<String>,
    carrozzina: Option<String>,
    richiedente: Option<String>,
    motivazione: Option<String>,
    ora_arrivo: Option<String>,
    comune_destinazione: Option<String>,
    luogo_destinazione: Option<String>,
    pagamento: Option<String>,
    stato_incasso: Option<String>,
    operatore: Option<String>,
    operatore_2: Option<String>,
    mezzo: Option<String>,
    tempo: Option<String>,
    km: Option<String>,
    km_uscita: Option<String>,
    km_rientro: Option<String>,
    tipo_pagamento: Option<String>,
    data_bonifico: Option<String>,
    data_ricevuta: Option<String>,
    numero_ricevuta: Option<String>,
    stato_servizio: Option<String>,
    note_prelievo: Option<String>,
    note_arrivo: Option<String>,
    note_fine_servizio: Option<String>,
    archivia: Option<String>,
    /// Account che ha creato il servizio, es. "mario@auser.it (mario.rossi)"
    creato_da: Option<String>,
    /// Account che ha modificato per ultimo il servizio
    modificato_da: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateServizioOptions {
    mantieni_ora_partenza: bool,
    mantieni_operatore: bool,
    mantieni_mezzo: bool,
    mantieni_motivazione: bool,
    mantieni_note_partenza: bool,
    mantieni_note_arrivo: bool,
    mantieni_stato_incasso: bool,
    mantieni_tipo_pagamento: bool,
    mantieni_donazione: bool,
}

fn insert_opt_string(body: &mut serde_json::Map<String, serde_json::Value>, key: &str, value: Option<String>) {
    if let Some(v) = value {
        let trimmed = v.trim().to_string();
        body.insert(key.to_string(), serde_json::json!(trimmed));
    }
}

fn insert_opt_date(body: &mut serde_json::Map<String, serde_json::Value>, key: &str, value: Option<String>) {
    if let Some(v) = value {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            body.insert(key.to_string(), serde_json::Value::Null);
            return;
        }
        if let Some(parsed) = parse_italian_date(trimmed) {
            body.insert(
                key.to_string(),
                serde_json::json!(parsed.format("%Y-%m-%d").to_string()),
            );
        }
    }
}

fn put_servizio_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    value: serde_json::Value,
) {
    if let Some(r) = row {
        if let Some(key) = resolve_column_key(r, candidates) {
            body.insert(key, value);
            return;
        }
    }
    body.insert(default_key.to_string(), value);
}

fn put_opt_string_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    value: Option<String>,
) {
    if let Some(v) = value {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            return;
        }
        put_servizio_field(
            body,
            row,
            candidates,
            default_key,
            serde_json::json!(trimmed),
        );
    }
}

/// Campo testo/ora: stringa vuota → NULL (evita errore su colonne time/numeric)
fn put_opt_nullable_string_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    value: Option<String>,
) {
    if let Some(v) = value {
        let trimmed = v.trim();
        let json_val = if trimmed.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::json!(trimmed)
        };
        put_servizio_field(body, row, candidates, default_key, json_val);
    }
}

fn json_numero_da_testo(value: &str) -> Option<serde_json::Value> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Some(serde_json::Value::Null);
    }
    let normalized = trimmed.replace(',', ".");
    if let Ok(n) = normalized.parse::<i64>() {
        return Some(serde_json::json!(n));
    }
    normalized.parse::<f64>().ok().map(|n| serde_json::json!(n))
}

/// Colonne numeriche Supabase: vuoto → NULL, altrimenti numero
fn put_opt_numeric_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    value: Option<String>,
) {
    if let Some(v) = value {
        if let Some(json_val) = json_numero_da_testo(&v) {
            put_servizio_field(body, row, candidates, default_key, json_val);
        }
    }
}

fn put_opt_date_field(
    body: &mut serde_json::Map<String, serde_json::Value>,
    row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    value: Option<String>,
) {
    if let Some(v) = value {
        let trimmed = v.trim();
        let json_val = if trimmed.is_empty() {
            serde_json::Value::Null
        } else if let Some(parsed) = parse_italian_date(trimmed) {
            serde_json::json!(parsed.format("%Y-%m-%d").to_string())
        } else {
            return;
        };
        put_servizio_field(body, row, candidates, default_key, json_val);
    }
}

async fn fetch_servizio_row_template(servizio_id: u32) -> Result<serde_json::Value, String> {
    let filter = format!("idservizio=eq.{}", servizio_id);
    let rows = fetch_servizi_supabase(Some(&filter)).await?;
    rows.into_iter()
        .next()
        .ok_or_else(|| format!("Servizio {} non trovato per mappatura colonne", servizio_id))
}

fn strip_empty_strings_from_body(body: &mut serde_json::Map<String, serde_json::Value>) {
    body.retain(|_, v| !matches!(v, serde_json::Value::String(s) if s.is_empty()));
}

fn parse_euro_italiano_to_f64(value_str: &str) -> Option<f64> {
    let mut s = value_str.replace('€', "").trim().to_string();
    if s.is_empty() {
        return None;
    }
    if s.contains(',') {
        s = s.replace('.', "").replace(',', ".");
    } else {
        s = s.replace(' ', "");
    }
    s.parse::<f64>().ok()
}

async fn resolve_operatore_id_by_nome(nome: &str) -> Option<String> {
    let target = nome.trim();
    if target.is_empty() {
        return None;
    }
    let map = fetch_idsocio_nominativo_map().await;
    for (id, nom) in map {
        if nom.eq_ignore_ascii_case(target) {
            return Some(id);
        }
    }
    None
}

fn prepara_payload_duplicazione(
    payload: &mut UpdateServizioPayload,
    opzioni: &DuplicateServizioOptions,
) {
    payload.data_prelievo = Some(String::new());
    payload.ora_arrivo = Some(String::new());
    payload.numero_ricevuta = Some(String::new());
    payload.data_ricevuta = Some(String::new());
    payload.archivia = Some("false".to_string());
    payload.tempo = Some(String::new());
    payload.km = Some(String::new());
    payload.km_uscita = Some(String::new());
    payload.km_rientro = Some(String::new());
    payload.note_fine_servizio = Some(String::new());

    if !opzioni.mantieni_ora_partenza {
        payload.ora_inizio = Some(String::new());
    }
    if !opzioni.mantieni_operatore {
        payload.operatore = Some(String::new());
    }
    if !opzioni.mantieni_mezzo {
        payload.mezzo = Some(String::new());
    }
    if !opzioni.mantieni_motivazione {
        payload.motivazione = Some(String::new());
    }
    if !opzioni.mantieni_note_partenza {
        payload.note_prelievo = Some(String::new());
    }
    if !opzioni.mantieni_note_arrivo {
        payload.note_arrivo = Some(String::new());
    }
    if !opzioni.mantieni_stato_incasso {
        payload.stato_incasso = Some("DA INCASSARE".to_string());
    }
    if !opzioni.mantieni_tipo_pagamento {
        payload.tipo_pagamento = Some(String::new());
    }
    if !opzioni.mantieni_donazione {
        payload.pagamento = Some(String::new());
    }
}

fn servizio_completo_to_update_payload(sc: &ServizioCompleto) -> UpdateServizioPayload {
    UpdateServizioPayload {
        id: sc.id.parse().unwrap_or(0),
        data_prelievo: Some(sc.data_prelievo.clone()),
        idsocio: Some(sc.idsocio.clone()),
        socio_trasportato: Some(sc.socio_trasportato.clone()),
        ora_inizio: Some(sc.ora_inizio.clone()),
        comune_prelievo: Some(sc.comune_prelievo.clone()),
        luogo_prelievo: Some(sc.luogo_prelievo.clone()),
        tipo_servizio: Some(sc.tipo_servizio.clone()),
        carrozzina: Some(sc.carrozzina.clone()),
        richiedente: Some(sc.richiedente.clone()),
        motivazione: Some(sc.motivazione.clone()),
        ora_arrivo: Some(sc.ora_arrivo.clone()),
        comune_destinazione: Some(sc.comune_destinazione.clone()),
        luogo_destinazione: Some(sc.luogo_destinazione.clone()),
        pagamento: Some(sc.pagamento.clone()),
        stato_incasso: Some(sc.stato_incasso.clone()),
        operatore: Some(sc.operatore.clone()),
        operatore_2: Some(sc.operatore_2.clone()),
        mezzo: Some(sc.mezzo.clone()),
        tempo: Some(sc.tempo.clone()),
        km: Some(sc.km.clone()),
        km_uscita: Some(sc.km_uscita.clone()),
        km_rientro: Some(sc.km_rientro.clone()),
        tipo_pagamento: Some(sc.tipo_pagamento.clone()),
        data_bonifico: Some(sc.data_bonifico.clone()),
        data_ricevuta: Some(sc.data_ricevuta.clone()),
        numero_ricevuta: Some(sc.numero_ricevuta.clone()),
        stato_servizio: Some(sc.stato_servizio.clone()),
        note_prelievo: Some(sc.note_prelievo.clone()),
        note_arrivo: Some(sc.note_arrivo.clone()),
        note_fine_servizio: Some(sc.note_fine_servizio.clone()),
        archivia: Some(sc.archivia.clone()),
        creato_da: None,
        modificato_da: None,
    }
}

/// Scrive utente in CreatoDa / ModificatoDa e data/ora in Created / Updated.
fn apply_servizio_audit_fields(
    body: &mut serde_json::Map<String, serde_json::Value>,
    template_row: Option<&serde_json::Value>,
    creato_da: Option<&str>,
    modificato_da: Option<&str>,
    set_created_ts: bool,
    set_updated_ts: bool,
) {
    // Solo il NOME UTENTE (testo)
    if let Some(v) = creato_da.map(str::trim).filter(|s| !s.is_empty()) {
        put_servizio_field(
            body,
            template_row,
            &["CreatoDa", "creato_da", "Creato_Da", "CREATODA"],
            "CreatoDa",
            serde_json::json!(v),
        );
    }
    if let Some(v) = modificato_da.map(str::trim).filter(|s| !s.is_empty()) {
        put_servizio_field(
            body,
            template_row,
            &["ModificatoDa", "modificato_da", "Modificato_Da", "MODIFICATODA"],
            "ModificatoDa",
            serde_json::json!(v),
        );
    }

    // Data/ora sulle colonne created_at / update_at (nomi reali in Servizi_supa)
    let now = Local::now().to_rfc3339();
    if set_created_ts {
        put_servizio_audit_timestamp(
            body,
            template_row,
            &[
                "created_at",
                "Created_At",
                "Created",
                "created",
                "CREATED",
            ],
            "created_at",
            &now,
        );
    }
    if set_updated_ts {
        put_servizio_audit_timestamp(
            body,
            template_row,
            &[
                "update_at",
                "Update_At",
                "updated_at",
                "Updated_At",
                "Updated",
                "updated",
                "UPDATED",
                "modificated",
                "Modificated",
                "modified",
                "Modified",
            ],
            "update_at",
            &now,
        );
    }
}

/// Scrive il timestamp solo se la colonna esiste nella riga modello,
/// altrimenti usa il nome predefinito corretto (created_at / update_at).
fn put_servizio_audit_timestamp(
    body: &mut serde_json::Map<String, serde_json::Value>,
    template_row: Option<&serde_json::Value>,
    candidates: &[&str],
    default_key: &str,
    now: &str,
) {
    if let Some(r) = template_row {
        if let Some(key) = resolve_column_key(r, candidates) {
            body.insert(key, serde_json::json!(now));
            return;
        }
        println!(
            "⚠️ Colonna data/ora audit non in template {:?}: uso {}",
            candidates, default_key
        );
    }
    body.insert(default_key.to_string(), serde_json::json!(now));
}

fn strip_servizio_audit_fields(body: &mut serde_json::Map<String, serde_json::Value>) {
    const KEYS: &[&str] = &[
        "CreatoDa",
        "creato_da",
        "Creato_Da",
        "CREATODA",
        "ModificatoDa",
        "modificato_da",
        "Modificato_Da",
        "MODIFICATODA",
        "created_at",
        "Created_At",
        "Created",
        "created",
        "CREATED",
        "update_at",
        "Update_At",
        "updated_at",
        "Updated_At",
        "Updated",
        "updated",
        "UPDATED",
        "modificated",
        "Modificated",
        "MODIFICATED",
        "modified",
        "Modified",
    ];
    for k in KEYS {
        body.remove(*k);
    }
}

async fn build_servizio_supabase_body(
    payload: &UpdateServizioPayload,
    template_row: Option<&serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut body = serde_json::Map::new();

    put_opt_date_field(
        &mut body,
        template_row,
        &["Prelievo_Data", "DATA_PRELIEVO", "Data_Prelievo"],
        "Prelievo_Data",
        payload.data_prelievo.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &["IdSocio", "IDSOCIO"],
        "IdSocio",
        payload.idsocio.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Trasportato", "TRASP", "Trasp"],
        "Trasportato",
        payload.socio_trasportato.clone(),
    );
    put_opt_nullable_string_field(
        &mut body,
        template_row,
        &["Prelievo_Ora", "ORA_PRELIEVO", "OraPrelievo", "Ora_Prelievo"],
        "Prelievo_Ora",
        payload.ora_inizio.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Prelievo_Comune", "PRELIEVO_COMUNE"],
        "Prelievo_Comune",
        payload.comune_prelievo.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Prelievo_Indirizzo", "PRELIEVO_INDIRIZZO"],
        "Prelievo_Indirizzo",
        payload.luogo_prelievo.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Carrozzina", "CARROZZINA"],
        "Carrozzina",
        payload.carrozzina.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Richiedente", "RICHIEDENTE"],
        "Richiedente",
        payload.richiedente.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Motivazione", "MOTIVAZIONE"],
        "Motivazione",
        payload.motivazione.clone(),
    );
    put_opt_date_field(
        &mut body,
        template_row,
        &["Destinazione_Data", "DATA_DESTINAZIONE", "Data_Destinazione"],
        "Destinazione_Data",
        payload.ora_arrivo.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Destinazione_Comune", "DESTINAZIONE_COMUNE"],
        "Destinazione_Comune",
        payload.comune_destinazione.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Destinazione_Indirizzo", "DESTINAZIONE_INDIRIZZO"],
        "Destinazione_Indirizzo",
        payload.luogo_destinazione.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Incassato", "INCASSATO"],
        "Incassato",
        payload.stato_incasso.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Oper2", "OPER2"],
        "Oper2",
        payload.operatore_2.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &["Mezzo", "MEZZO"],
        "Mezzo",
        payload.mezzo.clone(),
    );
    put_opt_nullable_string_field(
        &mut body,
        template_row,
        &["Tempo", "TEMPO", "TEMPO_ORE", "Tempo_Ore"],
        "Tempo",
        payload.tempo.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &["Km", "KM"],
        "Km",
        payload.km.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &[
            "Km_uscita",
            "KM_USCITA",
            "km_uscita",
            "KmUscita",
            "Km_Partenza",
            "KM_PARTENZA",
            "km_partenza",
            "Chiusura_Km_Partenza",
        ],
        "Km_uscita",
        payload.km_uscita.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &[
            "Km_rientro",
            "KM_RIENTRO",
            "km_rientro",
            "KmRientro",
            "Km_Arrivo",
            "KM_ARRIVO",
            "km_arrivo",
            "Chiusura_Km_Arrivo",
        ],
        "Km_rientro",
        payload.km_rientro.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["TipoPagamento", "TIPOPAGAMENTO"],
        "TipoPagamento",
        payload.tipo_pagamento.clone(),
    );
    put_opt_date_field(
        &mut body,
        template_row,
        &["Bonifico_Data", "DATABONIFICO", "DataBonifico"],
        "Bonifico_Data",
        payload.data_bonifico.clone(),
    );
    put_opt_date_field(
        &mut body,
        template_row,
        &["Ricevuta_Data", "DATARICEVUTA", "DataRicevuta"],
        "Ricevuta_Data",
        payload.data_ricevuta.clone(),
    );
    put_opt_numeric_field(
        &mut body,
        template_row,
        &[
            "Ricevuta_numero",
            "Ricevuta_Numero",
            "RICEVUTA_NUMERO",
            "NumeroRicevuta",
            "Numero_Ricevuta",
            "ricevuta_numero",
        ],
        "Ricevuta_numero",
        payload.numero_ricevuta.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["StatoServizio", "STATOSERVIZIO"],
        "StatoServizio",
        payload.stato_servizio.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Prelievo_Note", "PRELIEVO_NOTE"],
        "Prelievo_Note",
        payload.note_prelievo.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &["Destinazione_Note", "DESTINAZIONE_NOTE"],
        "Destinazione_Note",
        payload.note_arrivo.clone(),
    );
    put_opt_string_field(
        &mut body,
        template_row,
        &[
            "NoteFineServizio",
            "NOTAFINESERVIZIO",
            "NOTE_FINE_SERVIZIO",
            "NotaFineServizio",
        ],
        "NoteFineServizio",
        payload.note_fine_servizio.clone(),
    );

    if let Some(tipo) = payload.tipo_servizio.clone() {
        let t = tipo.trim().to_uppercase();
        let is_sollevatore = t == "SOLLEVATORE";
        let is_standard = t == "STANDARD";
        if let Some(r) = template_row {
            insert_patch_bool_field(&mut body, r, &["Sollevatore", "SOLLEVATORE"], is_sollevatore);
            insert_patch_bool_field(&mut body, r, &["Standard", "STANDARD"], is_standard);
        } else {
            body.insert("Sollevatore".to_string(), serde_json::json!(is_sollevatore));
            body.insert("Standard".to_string(), serde_json::json!(is_standard));
        }
    }

    if let Some(pag) = payload.pagamento.clone() {
        if let Some(num) = parse_euro_italiano_to_f64(&pag) {
            put_servizio_field(
                &mut body,
                template_row,
                &["Donazioni", "DONAZIONI"],
                "Donazioni",
                serde_json::json!(num),
            );
        }
    }

    if let Some(op) = payload.operatore.clone() {
        if op.trim().is_empty() {
            put_servizio_field(
                &mut body,
                template_row,
                &["IdOperatore", "IDOPERATORE", "Id_Operatore"],
                "IdOperatore",
                serde_json::Value::Null,
            );
        } else {
            let id_num = if let Some(id) = resolve_operatore_id_by_nome(&op).await {
                id.trim().parse::<i64>().ok()
            } else {
                op.trim().parse::<i64>().ok()
            };
            if let Some(id) = id_num {
                put_servizio_field(
                    &mut body,
                    template_row,
                    &["IdOperatore", "IDOPERATORE", "Id_Operatore"],
                    "IdOperatore",
                    serde_json::json!(id),
                );
            }
        }
    }

    if let Some(arch) = payload.archivia.clone() {
        let val = matches!(
            arch.trim().to_lowercase().as_str(),
            "true" | "si" | "sì" | "1" | "yes"
        );
        if let Some(r) = template_row {
            insert_patch_bool_field(
                &mut body,
                r,
                &["Archiviazione", "ARCHIVIAZIONE", "archiviazione"],
                val,
            );
        } else {
            body.insert("Archiviazione".to_string(), serde_json::json!(val));
        }
    }

    body
}

// Comando per aggiornare tutti i campi di un servizio (Supabase / Servizi_supa)
#[tauri::command]
async fn update_servizio_completo(payload: UpdateServizioPayload) -> Result<(), String> {
    ensure_supabase_client().await?;

    let template_row = fetch_servizio_row_template(payload.id).await.ok();
    let mut body = build_servizio_supabase_body(&payload, template_row.as_ref()).await;
    // In update non si tocca CreatoDa / created_at: solo ModificatoDa + update_at
    strip_servizio_audit_fields(&mut body);
    apply_servizio_audit_fields(
        &mut body,
        template_row.as_ref(),
        None,
        payload.modificato_da.as_deref(),
        false,
        true,
    );

    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .patch_servizio(payload.id, &body)
        .await
        .map_err(|e| format_supabase_error(&e))
}

fn testo_note_serie_da_riga(row: &serde_json::Value) -> String {
    let prelievo = get_field_any(row, &["Prelievo_Note", "PRELIEVO_NOTE"]);
    let fine = get_field_any(
        row,
        &["NoteFineServizio", "NOTAFINESERVIZIO", "NOTE_FINE_SERVIZIO"],
    );
    format!("{}\n{}", prelievo, fine)
}

fn riga_e_aggiuntivo_della_serie(row: &serde_json::Value, id_principale: u32) -> bool {
    if servizio_id_from_row(row) == id_principale {
        return false;
    }
    let t = testo_note_serie_da_riga(row).to_lowercase();
    let needle_a = format!("sul servizio n. {}", id_principale);
    let needle_b = format!("sul servizio n.{}", id_principale);
    t.contains(&needle_a) || t.contains(&needle_b)
}

/// Aggiorna stato incasso, data incasso e ricevuta sui servizi aggiuntivi di una serie.
#[tauri::command]
async fn aggiorna_incasso_serie_servizi(
    id_principale: u32,
    stato_incasso: Option<String>,
    data_bonifico: Option<String>,
    numero_ricevuta: Option<String>,
    data_ricevuta: Option<String>,
    modificato_da: Option<String>,
) -> Result<u32, String> {
    println!(
        "=== aggiorna_incasso_serie_servizi principale={} ===",
        id_principale
    );
    if id_principale == 0 {
        return Ok(0);
    }

    ensure_supabase_client().await?;

    let principale = fetch_servizio_row_template(id_principale).await?;
    let idsocio = get_field_any(&principale, &["IdSocio", "IDSOCIO", "idsocio"]);

    let rows = if !idsocio.trim().is_empty() {
        let filtro = format!("IdSocio=eq.{}", idsocio.trim());
        match fetch_servizi_supabase(Some(&filtro)).await {
            Ok(r) => r,
            Err(e) => {
                println!("⚠️ Filtro IdSocio fallito ({}), riprovo senza filtro ristretto", e);
                let filtro_id = format!("idservizio=gte.{}", id_principale.saturating_sub(50));
                fetch_servizi_supabase(Some(&filtro_id)).await.unwrap_or_default()
            }
        }
    } else {
        Vec::new()
    };

    let aggiuntivi: Vec<serde_json::Value> = rows
        .into_iter()
        .filter(|row| riga_e_aggiuntivo_della_serie(row, id_principale))
        .collect();

    if aggiuntivi.is_empty() {
        println!("ℹ️ Nessun servizio aggiuntivo trovato per serie {}", id_principale);
        return Ok(0);
    }

    let mut aggiornati = 0u32;
    for row in aggiuntivi {
        let extra_id = servizio_id_from_row(&row);
        if extra_id == 0 {
            continue;
        }
        let mut body = serde_json::Map::new();
        put_opt_string_field(
            &mut body,
            Some(&row),
            &["Incassato", "INCASSATO"],
            "Incassato",
            stato_incasso.clone(),
        );
        put_opt_date_field(
            &mut body,
            Some(&row),
            &["Bonifico_Data", "DATABONIFICO", "DataBonifico"],
            "Bonifico_Data",
            data_bonifico.clone(),
        );
        if numero_ricevuta
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            put_opt_numeric_field(
                &mut body,
                Some(&row),
                &[
                    "Ricevuta_numero",
                    "Ricevuta_Numero",
                    "RICEVUTA_NUMERO",
                    "NumeroRicevuta",
                    "Numero_Ricevuta",
                    "ricevuta_numero",
                ],
                "Ricevuta_numero",
                numero_ricevuta.clone(),
            );
        }
        if data_ricevuta
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            put_opt_date_field(
                &mut body,
                Some(&row),
                &["Ricevuta_Data", "DATARICEVUTA", "DataRicevuta"],
                "Ricevuta_Data",
                data_ricevuta.clone(),
            );
        }
        strip_servizio_audit_fields(&mut body);
        apply_servizio_audit_fields(
            &mut body,
            Some(&row),
            None,
            modificato_da.as_deref(),
            false,
            true,
        );
        if body.is_empty() {
            continue;
        }

        let guard = get_supabase_client().lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
        client
            .patch_servizio(extra_id, &body)
            .await
            .map_err(|e| format_supabase_error(&e))?;
        drop(guard);
        aggiornati += 1;
        println!("✓ Incasso serie: aggiornato servizio {}", extra_id);
    }

    println!(
        "✓ aggiorna_incasso_serie_servizi: {} servizi aggiuntivi aggiornati",
        aggiornati
    );
    Ok(aggiornati)
}

// Comando per creare un nuovo servizio (Supabase / Servizi_supa)
#[tauri::command]
async fn create_servizio(payload: UpdateServizioPayload) -> Result<u32, String> {
    println!("=== create_servizio chiamato (Supabase) ===");

    ensure_supabase_client().await?;

    // Usa un servizio esistente solo per capire i nomi esatti delle colonne
    let template_row = {
        let guard = get_supabase_client().lock().await;
        let client = guard
            .as_ref()
            .ok_or_else(|| "Client Supabase non disponibile".to_string())?;
        let max_id = client
            .fetch_max_servizio_id()
            .await
            .map_err(|e| format_supabase_error(&e))?;
        drop(guard);
        if max_id > 0 {
            fetch_servizio_row_template(max_id).await.ok()
        } else {
            None
        }
    };

    let mut body = build_servizio_supabase_body(&payload, template_row.as_ref()).await;
    strip_empty_strings_from_body(&mut body);
    body.remove("idservizio");
    body.remove("IdServizio");
    body.remove("IDSERVIZIO");
    body.remove("Id_Servizio");
    body.remove("id_servizio");

    let account = payload.creato_da.as_deref();
    // In creazione: utente in CreatoDa + data/ora in created_at.
    // ModificatoDa / update_at restano vuoti finché non si salva una modifica.
    apply_servizio_audit_fields(
        &mut body,
        template_row.as_ref(),
        account,
        None,
        true,
        false,
    );

    if body.is_empty() {
        return Err("Nessun dato da salvare per il nuovo servizio".to_string());
    }

    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let max_id = client
        .fetch_max_servizio_id()
        .await
        .map_err(|e| format_supabase_error(&e))?;
    let next_id = max_id.saturating_add(1);

    let id_column = template_row
        .as_ref()
        .and_then(|row| {
            resolve_column_key(
                row,
                &[
                    "idservizio",
                    "IdServizio",
                    "Id_Servizio",
                    "IDSERVIZIO",
                    "id_servizio",
                ],
            )
        })
        .unwrap_or_else(|| "idservizio".to_string());
    body.insert(id_column, serde_json::json!(next_id));

    println!(
        "📋 Creazione servizio: max_id={} → nuovo idservizio={} ({} campi)",
        max_id,
        next_id,
        body.len()
    );

    let inserted = client
        .insert_servizio(&body)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    let new_id = servizio_id_from_row(&inserted);
    let new_id = if new_id == 0 { next_id } else { new_id };
    if new_id == 0 {
        return Err("Servizio creato ma ID non restituito da Supabase".to_string());
    }

    println!("✓ Nuovo servizio creato con ID {}", new_id);
    Ok(new_id)
}

// Comando per eliminare un servizio (Supabase / Servizi_supa)
#[tauri::command]
async fn delete_servizio(servizio_id: u32) -> Result<(), String> {
    println!(
        "=== delete_servizio chiamato per ID: {} (Supabase) ===",
        servizio_id
    );

    ensure_supabase_client().await?;

    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    client
        .delete_servizio(servizio_id)
        .await
        .map_err(|e| format_supabase_error(&e))
}

// Comando per duplicare un servizio (Supabase / Servizi_supa)
#[tauri::command]
async fn duplicate_servizio(
    servizio_id: u32,
    opzioni: DuplicateServizioOptions,
    creato_da: Option<String>,
) -> Result<u32, String> {
    println!(
        "=== duplicate_servizio chiamato per ID: {} (Supabase) opzioni: {:?} ===",
        servizio_id, opzioni
    );

    ensure_supabase_client().await?;

    let originale = get_servizio_completo(servizio_id).await?;
    let template_row = fetch_servizio_row_template(servizio_id).await?;
    let mut payload = servizio_completo_to_update_payload(&originale);
    prepara_payload_duplicazione(&mut payload, &opzioni);

    let mut body = build_servizio_supabase_body(&payload, Some(&template_row)).await;
    strip_empty_strings_from_body(&mut body);
    body.remove("idservizio");
    body.remove("IdServizio");
    body.remove("IDSERVIZIO");
    body.remove("Id_Servizio");
    body.remove("id_servizio");
    // La copia è un nuovo servizio: CreatoDa + created_at di chi duplica; ModificatoDa/update_at vuoti
    strip_servizio_audit_fields(&mut body);
    let account = creato_da.as_deref();
    apply_servizio_audit_fields(
        &mut body,
        Some(&template_row),
        account,
        None,
        true,
        false,
    );
    if body.is_empty() {
        return Err("Nessun dato da copiare per la duplicazione".to_string());
    }

    let guard = get_supabase_client().lock().await;
    let client = guard
        .as_ref()
        .ok_or_else(|| "Client Supabase non disponibile".to_string())?;

    let max_id = client
        .fetch_max_servizio_id()
        .await
        .map_err(|e| format_supabase_error(&e))?;
    let next_id = max_id.saturating_add(1);

    let id_column = resolve_column_key(
        &template_row,
        &[
            "idservizio",
            "IdServizio",
            "Id_Servizio",
            "IDSERVIZIO",
            "id_servizio",
        ],
    )
    .unwrap_or_else(|| "idservizio".to_string());
    body.insert(id_column, serde_json::json!(next_id));

    println!(
        "📋 Duplicazione servizio: max_id={} → nuovo idservizio={} ({} campi)",
        max_id,
        next_id,
        body.len()
    );

    let inserted = client
        .insert_servizio(&body)
        .await
        .map_err(|e| format_supabase_error(&e))?;

    let new_id = servizio_id_from_row(&inserted);
    let new_id = if new_id == 0 { next_id } else { new_id };
    if new_id == 0 {
        return Err("Servizio duplicato ma ID non restituito da Supabase".to_string());
    }

    println!("✓ Servizio {} duplicato come ID {}", servizio_id, new_id);
    Ok(new_id)
}

// Comando per caricare configurazione da file
#[tauri::command]
async fn load_config_file() -> Result<serde_json::Value, String> {
    let config = load_app_config_from_file().await?;
    Ok(serde_json::json!({
        "sharepoint": {
            "site_url": config.sharepoint.site_url,
            "client_id": config.sharepoint.client_id,
            "tenant_id": config.sharepoint.tenant_id,
            "client_secret": config.sharepoint.client_secret
        },
        "supabase": config.supabase,
        "github": config.github,
        "lists": config.lists
    }))
}

// Comando per inizializzare client SharePoint da configurazione
#[tauri::command]
async fn init_sharepoint_from_config() -> Result<(), String> {
    println!(
        "Tentativo di inizializzare SharePoint da config.json. Directory corrente: {:?}",
        std::env::current_dir()
    );

    let config = load_app_config_from_file().await?;

    let mut client_guard = get_sharepoint_client().lock().await;

    if let Some(existing_client) = client_guard.as_ref() {
        if existing_client.is_authenticated() {
            println!("✓ Client SharePoint già autenticato, preservo il token esistente");
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

            println!("✓ Configurazione aggiornata preservando l'autenticazione");
            setup_supabase_from_config(&config).await;

            if let Some(lists) = config.lists {
                let mut lists_guard = get_lists_config().lock().await;
                *lists_guard = Some(lists);
                println!("✓ Configurazione liste aggiornata");
            }

            return Ok(());
        }
    }

    setup_supabase_from_config(&config).await;

    let sharepoint_config = SharePointConfig {
        site_url: config.sharepoint.site_url,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        tenant_id: config.sharepoint.tenant_id,
        client_id: config.sharepoint.client_id,
        client_secret: config.sharepoint.client_secret,
    };

    *client_guard = Some(SharePointClient::new(sharepoint_config));
    println!("✓ Client SharePoint inizializzato da config.json");

    if let Some(lists) = config.lists {
        let mut lists_guard = get_lists_config().lock().await;
        *lists_guard = Some(lists);
        println!("✓ Configurazione liste salvata");
    }

    Ok(())
}

// Comando per inizializzare solo il client Supabase da config.json
#[tauri::command]
async fn init_supabase_from_config() -> Result<(), String> {
    let config = load_app_config_from_file().await?;
    setup_supabase_from_config(&config).await;
    Ok(())
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
        .setup(|_| {
            tauri::async_runtime::block_on(async {
                if let Ok(config) = load_app_config_from_file().await {
                    setup_supabase_from_config(&config).await;
                } else {
                    println!("⚠️ Supabase: config.json non trovato all'avvio");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_servizi_giorno,
            get_prossimi_servizi,
            get_servizi_inseriti_oggi,
            get_servizi_mezzo_nella_data,
            get_servizi_stesso_luogo_destinazione,
            get_tessere_da_fare,
            get_all_tesserati,
            get_all_tesseramenti,
            get_appunti_giorno,
            cerca_appunti,
            get_utenti_per_appunti,
            save_appunto,
            delete_appunto,
            get_appunti_risposte,
            save_appunto_risposta,
            delete_appunto_risposta,
            get_socio_anagrafica,
            save_socio_anagrafica,
            get_next_idsocio,
            create_socio_anagrafica,
            save_tesseramento,
            delete_tesseramento,
            delete_socio_anagrafica,
            save_socio_telefono,
            delete_socio_telefono,
            save_socio_email,
            delete_socio_email,
            get_all_automezzi,
            save_automezzo,
            create_automezzo,
            get_all_tratte,
            save_tratta,
            get_all_dotazioni_mezzi,
            add_dotazione_mezzo,
            get_all_tipologie_socio,
            get_all_richiedenti,
            get_all_tipi_pagamento,
            get_lookup_items,
            add_lookup_item,
            update_lookup_item,
            delete_lookup_item,
            get_mansioni,
            get_all_impostazioni,
            update_impostazione,
            get_supabase_auth_config,
            get_user_permissions,
            get_all_user_permissions,
            update_user_permissions,
            create_app_user,
            delete_app_user,
            get_all_stati_servizio,
            add_tipologia_socio,
            get_servizio_completo,
            get_servizi_report_giorno,
            get_servizi_report_settimana,
            get_all_servizi_completi,
            get_servizi_elenco_pagina,
            get_idsocio_con_servizi,
            get_operatori_con_servizi,
            get_motivazioni_servizi,
            get_comuni_prelievo_servizi,
            get_localita_autocomplete_servizi,
            stampa_servizio,
            modifica_servizio,
            completa_servizio,
            nuova_tessera,
            apri_tessera,
            authenticate_sharepoint,
            save_credentials,
            update_servizio_sharepoint,
            update_servizio_completo,
            aggiorna_incasso_serie_servizi,
            create_servizio,
            delete_servizio,
            duplicate_servizio,
            get_oauth_authorization_url,
            complete_oauth_authentication,
            load_config_file,
            init_sharepoint_from_config,
            init_supabase_from_config,
            test_supabase_connection,
            check_authentication
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


