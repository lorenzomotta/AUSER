// Modulo per l'integrazione con SharePoint
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Utc, NaiveDate, Local};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SharePointConfig {
    pub site_url: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub tenant_id: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub token_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SharePointListItem {
    #[serde(rename = "Id")]
    pub id: u32,
    #[serde(flatten)]
    pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SharePointListResponse {
    #[serde(rename = "value")]
    pub value: Vec<SharePointListItem>,
}

pub struct SharePointClient {
    pub config: SharePointConfig,
}

impl SharePointClient {
    pub fn new(config: SharePointConfig) -> Self {
        Self { config }
    }
    
    pub fn is_authenticated(&self) -> bool {
        if let Some(token) = &self.config.access_token {
            if token.is_empty() {
                println!("Token presente ma vuoto");
                return false;
            }
            // Verifica se il token è scaduto
            if let Some(expires_at) = self.config.expires_at {
                use chrono::Utc;
                let is_valid = expires_at > Utc::now();
                println!("Token presente, scade: {:?}, valido: {}", expires_at, is_valid);
                return is_valid;
            }
            // Se c'è un token ma non c'è data di scadenza, assumiamo che sia valido
            println!("Token presente senza data di scadenza, assumiamo valido");
            return true;
        }
        println!("Nessun token presente");
        false
    }

    // Verifica se il token è scaduto e aggiornalo se necessario
    pub async fn ensure_valid_token(&mut self) -> Result<(), String> {
        let needs_refresh = if let Some(expires_at) = self.config.expires_at {
            expires_at < Utc::now()
        } else {
            false
        };
        
        if needs_refresh {
            // Token scaduto, clona il refresh_token prima di chiamare refresh_access_token
            if let Some(refresh_token) = self.config.refresh_token.clone() {
                return self.refresh_access_token(&refresh_token).await;
            } else {
                return Err("Token scaduto e refresh token non disponibile".to_string());
            }
        }
        Ok(())
    }

    // Refresh del token di accesso
    pub async fn refresh_access_token(&mut self, refresh_token: &str) -> Result<(), String> {
        let tenant_id = self.config.tenant_id.as_ref()
            .ok_or("Tenant ID non configurato")?;
        
        let client_id = self.config.client_id.as_ref()
            .ok_or("Client ID non configurato")?;
        
        let client_secret = self.config.client_secret.as_ref()
            .ok_or("Client Secret non configurato")?;

        let token_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        );

        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/Sites.ReadWrite.All offline_access"),
        ];

        let client = reqwest::Client::new();
        let response = client
            .post(&token_url)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta refresh token: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Errore nel refresh token: {}", error_text));
        }

        let token_data: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing token: {}", e))?;

        self.config.access_token = Some(token_data.access_token);
        if let Some(refresh) = token_data.refresh_token {
            self.config.refresh_token = Some(refresh);
        }
        
        if let Some(expires_in) = token_data.expires_in {
            self.config.expires_at = Some(Utc::now() + chrono::Duration::seconds(expires_in as i64 - 300)); // 5 minuti di margine
        }

        Ok(())
    }

    // Ottieni access token usando authorization code
    pub async fn get_token_from_code(
        &mut self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<(), String> {
        let tenant_id = self.config.tenant_id.as_ref()
            .ok_or("Tenant ID non configurato")?;
        
        let client_id = self.config.client_id.as_ref()
            .ok_or("Client ID non configurato")?;
        
        let client_secret = self.config.client_secret.as_ref()
            .ok_or("Client Secret non configurato")?;

        let token_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            tenant_id
        );

        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/Sites.ReadWrite.All offline_access"),
        ];

        let client = reqwest::Client::new();
        let response = client
            .post(&token_url)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta token: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Errore nell'ottenimento token: {}", error_text));
        }

        let token_data: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing token: {}", e))?;

        self.config.access_token = Some(token_data.access_token);
        if let Some(refresh) = token_data.refresh_token {
            self.config.refresh_token = Some(refresh);
        }
        
        if let Some(expires_in) = token_data.expires_in {
            self.config.expires_at = Some(Utc::now() + chrono::Duration::seconds(expires_in as i64 - 300));
        }

        Ok(())
    }

    // Genera URL di autorizzazione OAuth2
    pub fn get_authorization_url(&self, redirect_uri: &str, state: &str) -> Result<String, String> {
        let tenant_id = self.config.tenant_id.as_ref()
            .ok_or("Tenant ID non configurato")?;
        
        let client_id = self.config.client_id.as_ref()
            .ok_or("Client ID non configurato")?;

        let scope = urlencoding::encode("https://graph.microsoft.com/Sites.ReadWrite.All offline_access");
        let redirect = urlencoding::encode(redirect_uri);
        let state_encoded = urlencoding::encode(state);
        let client_id_encoded = urlencoding::encode(client_id);

        let auth_url = format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize?\
            client_id={}&\
            response_type=code&\
            redirect_uri={}&\
            response_mode=query&\
            scope={}&\
            state={}",
            tenant_id, client_id_encoded, redirect, scope, state_encoded
        );

        Ok(auth_url)
    }

    // Ottieni elementi da una lista SharePoint usando Microsoft Graph API
    // NOTA: Senza $orderby per evitare problemi di paginazione - ordineremo lato client
    pub async fn get_list_items(
        &mut self,
        list_name: &str,
        filter: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        println!("🔄 [SHAREPOINT] get_list_items CHIAMATO - lista: {}, filtro: {:?}", list_name, filter);
        // Verifica e aggiorna il token se necessario
        self.ensure_valid_token().await?;
        
        // Ottieni access_token dopo il refresh (potrebbe essere cambiato)
        let access_token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Access token non disponibile. Esegui prima l'autenticazione.")?;

        // Estrai hostname e path dal site_url
        let site_url = self.config.site_url.trim_end_matches('/');
        let parsed_url = url::Url::parse(site_url)
            .map_err(|e| format!("Errore nel parsing URL sito: {}", e))?;
        
        let hostname = parsed_url.host_str()
            .ok_or("Hostname non valido nell'URL del sito")?;
        let path = parsed_url.path();
        
        // Costruisci l'URL per ottenere l'ID del sito usando Microsoft Graph
        let site_id_url = format!("https://graph.microsoft.com/v1.0/sites/{}:{}", hostname, path);
        
        println!("🔍 URL SITO SharePoint: {}", site_url);
        println!("🔍 Nome lista cercata: {}", list_name);
        
        let client = reqwest::Client::new();
        
        // Ottieni l'ID del sito
        let site_response = client
            .get(&site_id_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta ID sito: {}", e))?;
        
        if !site_response.status().is_success() {
            let status = site_response.status();
            let error_text = site_response.text().await.unwrap_or_default();
            return Err(format!("Errore nell'ottenimento ID sito: {} - {}", status, error_text));
        }
        
        let site_json: serde_json::Value = site_response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing risposta sito: {}", e))?;
        
        let site_id = site_json["id"]
            .as_str()
            .ok_or("ID sito non trovato nella risposta")?;
        
        println!("✓ ID sito ottenuto: {}", site_id);
        
        // Ottieni l'ID della lista
        let list_url = format!(
            "https://graph.microsoft.com/v1.0/sites/{}/lists?$filter=displayName eq '{}'",
            site_id, list_name
        );
        
        let list_response = client
            .get(&list_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta ID lista: {}", e))?;

        if !list_response.status().is_success() {
            let status = list_response.status();
            let error_text = list_response.text().await.unwrap_or_default();
            return Err(format!("Errore nell'ottenimento ID lista: {} - {}", status, error_text));
        }

        let list_json: serde_json::Value = list_response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing risposta lista: {}", e))?;

        let list_id = list_json["value"][0]["id"]
            .as_str()
            .ok_or(format!("Lista '{}' non trovata", list_name))?;
        
        println!("✓ ID lista ottenuto: {}", list_id);
        
        // Costruisci l'URL per ottenere gli items
        // IMPORTANTE: NON usiamo $orderby per evitare problemi di paginazione
        // Recuperiamo tutti gli elementi e ordiniamo lato client
        // Usiamo $top=500 (massimo supportato da Microsoft Graph API) e gestiamo la paginazione
        let base_url = format!(
            "https://graph.microsoft.com/v1.0/sites/{}/lists/{}/items?$expand=fields&$select=id,fields,createdDateTime&$top=500",
            site_id, list_id
        );
        
        let mut items_url = base_url;
        
        // Aggiungi filtro se presente (converti da formato SharePoint REST a Graph API)
        if let Some(filter_str) = filter {
            println!("🔍 Filtro ricevuto: {}", filter_str);
            // Converti il filtro per Microsoft Graph API
            // Formato SharePoint: "DATA_PRELIEVO gt datetime'2025-12-28T00:00:00Z'"
            // Formato Graph: "fields/DATA_PRELIEVO gt 2025-12-28T00:00:00Z"
            let graph_filter = filter_str
                .replace("DATA_PRELIEVO ge datetime'", "fields/DATA_PRELIEVO ge ")
                .replace("DATA_PRELIEVO lt datetime'", "fields/DATA_PRELIEVO lt ")
                .replace("DATA_PRELIEVO eq datetime'", "fields/DATA_PRELIEVO eq ")
                .replace("DATA_PRELIEVO gt datetime'", "fields/DATA_PRELIEVO gt ")
                .replace("Data_Prelievo ge datetime'", "fields/DATA_PRELIEVO ge ")
                .replace("Data_Prelievo lt datetime'", "fields/DATA_PRELIEVO lt ")
                .replace("Data_Prelievo eq datetime'", "fields/DATA_PRELIEVO eq ")
                .replace("Data_Prelievo gt datetime'", "fields/DATA_PRELIEVO gt ")
                .replace("Data ge datetime'", "fields/Data ge ")
                .replace("Data lt datetime'", "fields/Data lt ")
                .replace("Data eq datetime'", "fields/Data eq ")
                .replace("Data gt datetime'", "fields/Data gt ")
                .replace("Created ge datetime'", "createdDateTime ge ")
                .replace("Created lt datetime'", "createdDateTime lt ")
                .replace("Created eq datetime'", "createdDateTime eq ")
                .replace("Created gt datetime'", "createdDateTime gt ")
                .replace("'", ""); // Rimuovi apici singoli
            
            println!("🔍 Filtro convertito per Graph API: {}", graph_filter);
            items_url.push_str(&format!("&$filter={}", urlencoding::encode(&graph_filter)));
        }
        
        println!("🔍 URL richiesta Graph API: {}", items_url);
        
        // Raccolta per tutti gli elementi (gestione paginazione)
        let mut all_results: Vec<serde_json::Value> = Vec::new();
        let mut current_url = items_url.clone();
        let mut page_count = 0;
        let max_pages = 100; // Limite di sicurezza

        println!("🔄 INIZIO PAGINAZIONE - URL iniziale: {}", current_url);

        loop {
            page_count += 1;
            if page_count > max_pages {
                println!("⚠️ Raggiunto limite massimo di {} pagine. Interrompo la paginazione.", max_pages);
                break;
            }
            
            println!("=== Recupero pagina {} ===", page_count);

            let items_response = client
                .get(&current_url)
                .header("Authorization", format!("Bearer {}", access_token))
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .header("Pragma", "no-cache")
                .header("Expires", "0")
                .send()
                .await
                .map_err(|e| format!("Errore nella richiesta items (pagina {}): {}", page_count, e))?;

            println!("Status risposta Graph API (pagina {}): {}", page_count, items_response.status());

            if !items_response.status().is_success() {
                let status = items_response.status();
                let error_text = items_response.text().await.unwrap_or_default();
                println!("✗ Errore Graph API (pagina {}): {} - {}", page_count, status, error_text);
                
                if status == 400 {
                    return Err(format!(
                        "Errore Graph API 400 (probabilmente filtro su campo non indicizzato): {}",
                        error_text
                    ));
                }
                return Err(format!(
                    "Errore Graph API (pagina {}): {} - {}",
                    page_count, status, error_text
                ));
            }

            let items_json: serde_json::Value = items_response
                .json()
                .await
                .map_err(|e| format!("Errore nel parsing JSON (pagina {}): {}", page_count, e))?;

            let results = items_json["value"]
                .as_array()
                .ok_or(format!("Formato risposta Graph API non valido (pagina {})", page_count))?;

            println!("✓ Ricevuti {} elementi dalla pagina {}", results.len(), page_count);
            
            // Log dettagliato della risposta per debug
            if page_count == 1 {
                println!("🔍 DEBUG - Primi 10 caratteri della risposta JSON: {:?}", 
                    serde_json::to_string(&items_json).unwrap_or_default().chars().take(100).collect::<String>());
                println!("🔍 DEBUG - Chiavi presenti nel JSON: {:?}", 
                    items_json.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
            }
            
            if results.is_empty() {
                println!("✓ Pagina vuota ricevuta. Fine paginazione.");
                break;
            }
            
            all_results.extend(results.iter().cloned());

            // Controlla se c'è una pagina successiva - verifica sia @odata.nextLink che @odata.next
            let next_link_opt = items_json.get("@odata.nextLink")
                .or_else(|| items_json.get("@odata.next"))
                .and_then(|v| v.as_str());
            
            if let Some(next_link) = next_link_opt {
                println!("→ Pagina successiva disponibile (via @odata.nextLink/@odata.next): {}", next_link);
                current_url = next_link.to_string();
            } else {
                // Non c'è @odata.nextLink - verifica anche altre chiavi possibili
                println!("→ Nessun @odata.nextLink/@odata.next trovato nella risposta");
                println!("  Numero elementi in questa pagina: {}", results.len());
                println!("  Totale elementi accumulati finora: {}", all_results.len());
                
                // Log completo della risposta per capire cosa restituisce Microsoft Graph
                if page_count == 1 && results.len() < 500 {
                    println!("🔍 DEBUG - Risposta completa JSON (primi 2000 caratteri):");
                    let json_str = serde_json::to_string(&items_json).unwrap_or_default();
                    println!("{}", json_str.chars().take(2000).collect::<String>());
                }
                
                // Verifica se ci sono più elementi: se la pagina ha esattamente 500 elementi
                // ma non c'è @odata.nextLink, potrebbe essere un problema di Microsoft Graph
                if results.len() == 500 {
                    println!("⚠️ ATTENZIONE: Pagina con esattamente 500 elementi ma senza @odata.nextLink!");
                    println!("  Potrebbero esserci più elementi.");
                    println!("  Microsoft Graph non supporta $skip manuale. Fine paginazione.");
                } else if results.len() >= 200 && results.len() < 500 {
                    println!("⚠️ ATTENZIONE: Pagina con {} elementi (< 500) ma senza @odata.nextLink", results.len());
                    println!("  Potrebbero esserci più elementi nella lista SharePoint.");
                    println!("  Questo potrebbe essere un limite di Microsoft Graph API con $expand=fields.");
                } else {
                    println!("✓ Pagina con {} elementi e senza @odata.nextLink. Fine paginazione.", results.len());
                }
                println!("  Totale elementi recuperati: {}", all_results.len());
                break;
            }
        }

        println!("✓ Totale elementi recuperati da tutte le pagine: {}", all_results.len());
        
        // Log per verificare se troviamo elementi con id 64 PRIMA della trasformazione
        println!("🔍 [SHAREPOINT RAW] ========== INIZIO VERIFICA ID 64 ==========");
        println!("🔍 [SHAREPOINT RAW] Verifica elementi con id interno 64 nei {} elementi raw...", all_results.len());
        
        // Log il primo elemento per vedere la struttura raw
        if !all_results.is_empty() {
            println!("🔍 [SHAREPOINT RAW] Primo elemento raw (esempio struttura):");
            if let Ok(json_str) = serde_json::to_string_pretty(&all_results[0]) {
                println!("{}", json_str);
            }
        }
        for (idx, item) in all_results.iter().enumerate() {
            // Controlla l'id in vari modi (può essere stringa o numero)
            let id_val = item.get("id");
            let mut id_match_64 = false;
            
            if let Some(id_json) = id_val {
                // Prova come stringa
                if let Some(id_str) = id_json.as_str() {
                    if id_str == "64" || id_str.parse::<u32>().ok() == Some(64) {
                        id_match_64 = true;
                    }
                }
                // Prova come numero
                if !id_match_64 {
                    if let Some(id_num) = id_json.as_u64() {
                        if id_num == 64 {
                            id_match_64 = true;
                        }
                    }
                }
                if !id_match_64 {
                    if let Some(id_num) = id_json.as_i64() {
                        if id_num == 64 {
                            id_match_64 = true;
                        }
                    }
                }
            }
            
            if id_match_64 {
                println!("🔍 [SHAREPOINT RAW] TROVATO elemento con id interno 64 (indice {})!", idx);
                println!("    id interno (raw): {:?}", id_val);
                if let Some(fields) = item.get("fields") {
                    println!("    fields presente: SI");
                    if let Some(idservizio) = fields.get("IDSERVIZIO") {
                        println!("    IDSERVIZIO (raw): {:?}", idservizio);
                    } else {
                        println!("    IDSERVIZIO: NON PRESENTE nei fields");
                    }
                    if let Some(oper) = fields.get("OPER") {
                        println!("    OPER (raw): {:?}", oper);
                    } else {
                        println!("    OPER: NON PRESENTE");
                    }
                    if let Some(data_prelievo) = fields.get("DATA_PRELIEVO") {
                        println!("    DATA_PRELIEVO (raw): {:?}", data_prelievo);
                    } else {
                        println!("    DATA_PRELIEVO: NON PRESENTE");
                    }
                    println!("    Raw item completo: {}", serde_json::to_string(item).unwrap_or_else(|_| "errore serializzazione".to_string()));
                } else {
                    println!("    ⚠️ ATTENZIONE: elemento SENZA 'fields'!");
                    println!("    Raw item completo: {}", serde_json::to_string(item).unwrap_or_else(|_| "errore serializzazione".to_string()));
                }
            }
        }
        
        // Converti gli elementi nel formato atteso
        let mut elementi_senza_fields = 0;
        let items: Vec<serde_json::Value> = all_results
            .iter()
            .filter_map(|item| {
                let id_interno = item["id"].as_str().unwrap_or("N/A");
                
                let fields = match item.get("fields") {
                    Some(f) => f,
                    None => {
                        elementi_senza_fields += 1;
                        return None;
                    }
                };
                
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
                            }
                            if let Ok(json_str) = serde_json::to_string(val) {
                                return json_str;
                            }
                        }
                        val.to_string()
                    } else {
                        String::new()
                    }
                };
                
                // IDSERVIZIO è il campo principale per l'ID
                // Se non presente, NON usiamo l'ID interno di SharePoint come fallback
                // perché crea confusione (l'ID interno non corrisponde all'ID servizio)
                let id = if let Some(idservizio_val) = fields.get("IDSERVIZIO") {
                    if let Some(n) = idservizio_val.as_number() {
                        n.as_u64().unwrap_or(0) as u32
                    } else if let Some(s) = idservizio_val.as_str() {
                        s.parse::<u32>().ok().unwrap_or(0)
                    } else {
                        0 // Se IDSERVIZIO esiste ma è null/vuoto, usiamo 0
                    }
                } else {
                    // IDSERVIZIO non presente - NON usiamo l'ID interno di SharePoint
                    // Prova a usare Title come fallback se è un numero
                    if let Some(title_val) = fields.get("Title") {
                        if let Some(title_str) = title_val.as_str() {
                            title_str.parse::<u32>().ok().unwrap_or(0)
                        } else if let Some(title_num) = title_val.as_number() {
                            title_num.as_u64().unwrap_or(0) as u32
                        } else {
                            0
                        }
                    } else {
                        0 // Nessun ID disponibile
                    }
                };
                
                // Se l'ID è 0, salta questo elemento (non ha un ID valido)
                if id == 0 {
                    return None;
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
                
                let data_formattata = format_date_sharepoint(data_prelievo_raw.as_str());
                
                Some(serde_json::json!({
                    "id": id,
                    "operatore": get_field_value("OPER"),
                    "data": data_formattata,
                    "nominativo": get_field_value("TRASP"),
                    "ora_sotto_casa": get_field_value("ORA_PRELIEVO"),
                    "ora_destinazione": get_field_value("ORA_DESTINAZIONE"),
                    "tipo_servizio": get_field_value("MOTIVAZIONE"),
                }))
            })
            .collect();

        if elementi_senza_fields > 0 {
            println!("⚠️ Totale elementi scartati per mancanza di 'fields': {}", elementi_senza_fields);
        }
        println!("✓ Elementi parsati correttamente: {} su {}", items.len(), all_results.len());

        // Ordina gli elementi per data decrescente (più recenti prima)
        let mut items_sorted = items;
        items_sorted.sort_by(|a, b| {
            let data_a = a.get("data").and_then(|d| d.as_str()).unwrap_or("");
            let data_b = b.get("data").and_then(|d| d.as_str()).unwrap_or("");
            
            let parse_date = |date_str: &str| -> Option<NaiveDate> {
                if date_str.is_empty() {
                    return None;
                }
                NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()
            };
            
            let date_a = parse_date(data_a);
            let date_b = parse_date(data_b);
            
            match (date_a, date_b) {
                (Some(da), Some(db)) => db.cmp(&da),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
        
        println!("✓ Elementi ordinati per data decrescente (più recenti prima)");

        Ok(items_sorted)
    }
    
    // Versione che restituisce gli elementi raw (con fields) prima della conversione
    pub async fn get_list_items_raw(
        &mut self,
        list_name: &str,
        filter: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        // Usa la stessa logica di get_list_items ma restituisci all_results invece di items
        // Chiama get_list_items internamente per ottenere all_results
        // Per semplicità, duplichiamo la logica di get_list_items ma restituiamo all_results
        // In realtà, per evitare duplicazione, possiamo estrarre la logica comune
        // Ma per ora, chiamiamo get_list_items e poi... no, non possiamo perché restituisce items convertiti
        
        // Per ora, duplichiamo la logica. In futuro possiamo refactorizzare
        println!("🔄 [SHAREPOINT] get_list_items_raw CHIAMATO - lista: {}, filtro: {:?}", list_name, filter);
        // Verifica e aggiorna il token se necessario
        self.ensure_valid_token().await?;
        
        // Ottieni access_token dopo il refresh (potrebbe essere cambiato)
        let access_token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Access token non disponibile. Esegui prima l'autenticazione.")?;

        // Estrai hostname e path dal site_url
        let site_url = self.config.site_url.trim_end_matches('/');
        let parsed_url = url::Url::parse(site_url)
            .map_err(|e| format!("Errore nel parsing URL sito: {}", e))?;
        
        let hostname = parsed_url.host_str()
            .ok_or("Hostname non valido nell'URL del sito")?;
        let path = parsed_url.path();
        
        // Costruisci l'URL per ottenere l'ID del sito usando Microsoft Graph
        let site_id_url = format!("https://graph.microsoft.com/v1.0/sites/{}:{}", hostname, path);
        
        println!("🔍 URL SITO SharePoint: {}", site_url);
        println!("🔍 Nome lista cercata: {}", list_name);
        
        let client = reqwest::Client::new();
        
        // Ottieni l'ID del sito
        let site_response = client
            .get(&site_id_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta ID sito: {}", e))?;

        if !site_response.status().is_success() {
            let status = site_response.status();
            let error_text = site_response.text().await.unwrap_or_default();
            return Err(format!("Errore nell'ottenimento ID sito: {} - {}", status, error_text));
        }

        let site_json: serde_json::Value = site_response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing risposta sito: {}", e))?;

        let site_id = site_json["id"]
            .as_str()
            .ok_or("ID sito non trovato nella risposta")?;
        
        println!("✓ ID sito ottenuto: {}", site_id);

        // Ottieni l'ID della lista
        let list_url = format!(
            "https://graph.microsoft.com/v1.0/sites/{}/lists?$filter=displayName eq '{}'",
            site_id, list_name
        );
        
        let list_response = client
            .get(&list_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .header("Pragma", "no-cache")
            .header("Expires", "0")
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta ID lista: {}", e))?;

        if !list_response.status().is_success() {
            let status = list_response.status();
            let error_text = list_response.text().await.unwrap_or_default();
            return Err(format!("Errore nell'ottenimento ID lista: {} - {}", status, error_text));
        }

        let list_json: serde_json::Value = list_response
            .json()
            .await
            .map_err(|e| format!("Errore nel parsing risposta lista: {}", e))?;

        let list_id = list_json["value"][0]["id"]
            .as_str()
            .ok_or(format!("Lista '{}' non trovata", list_name))?;
        
        println!("✓ ID lista ottenuto: {}", list_id);
        
        // Costruisci l'URL per ottenere gli items (senza filtro per recuperare tutti)
        let base_url = format!(
            "https://graph.microsoft.com/v1.0/sites/{}/lists/{}/items?$expand=fields&$select=id,fields,createdDateTime&$top=500",
            site_id, list_id
        );
        
        let mut items_url = base_url;
        
        // Aggiungi filtro se presente
        if let Some(filter_str) = filter {
            let graph_filter = filter_str
                .replace("DATA_PRELIEVO ge datetime'", "fields/DATA_PRELIEVO ge ")
                .replace("DATA_PRELIEVO lt datetime'", "fields/DATA_PRELIEVO lt ")
                .replace("DATA_PRELIEVO eq datetime'", "fields/DATA_PRELIEVO eq ")
                .replace("DATA_PRELIEVO gt datetime'", "fields/DATA_PRELIEVO gt ")
                .replace("'", "");
            items_url.push_str(&format!("&$filter={}", urlencoding::encode(&graph_filter)));
        }
        
        // Raccolta per tutti gli elementi (gestione paginazione)
        let mut all_results: Vec<serde_json::Value> = Vec::new();
        let mut current_url = items_url.clone();
        let mut page_count = 0;
        let max_pages = 100;

        loop {
            page_count += 1;
            if page_count > max_pages {
                break;
            }
            
            let items_response = client
                .get(&current_url)
                .header("Authorization", format!("Bearer {}", access_token))
                .send()
                .await
                .map_err(|e| format!("Errore nella richiesta items (pagina {}): {}", page_count, e))?;

            if !items_response.status().is_success() {
                let status = items_response.status();
                let error_text = items_response.text().await.unwrap_or_default();
                return Err(format!("Errore Graph API (pagina {}): {} - {}", page_count, status, error_text));
            }

            let items_json: serde_json::Value = items_response
                .json()
                .await
                .map_err(|e| format!("Errore nel parsing JSON (pagina {}): {}", page_count, e))?;

            let results = items_json["value"]
                .as_array()
                .ok_or(format!("Formato risposta Graph API non valido (pagina {})", page_count))?;
            
            if results.is_empty() {
                break;
            }
            
            all_results.extend(results.iter().cloned());

            let next_link_opt = items_json.get("@odata.nextLink")
                .or_else(|| items_json.get("@odata.next"))
                .and_then(|v| v.as_str());
            
            if let Some(next_link) = next_link_opt {
                current_url = next_link.to_string();
            } else {
                break;
            }
        }

        println!("✓ Totale elementi raw recuperati: {}", all_results.len());
        
        // Restituisci gli elementi raw senza conversione
        Ok(all_results)
    }

    // Aggiorna elemento in una lista SharePoint
    pub async fn update_list_item(
        &mut self,
        list_name: &str,
        item_id: u32,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        // Verifica e aggiorna il token se necessario
        self.ensure_valid_token().await?;
        
        let access_token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Access token non disponibile")?;

        let site_url = self.config.site_url.trim_end_matches('/');
        let api_url = format!(
            "{}/_api/web/lists/getbytitle('{}')/items({})",
            site_url, list_name, item_id
        );

        // Prepara i dati per SharePoint (converte i nomi dei campi)
        let mut sharepoint_data = serde_json::Map::new();
        for (key, value) in data {
            let sp_key = match key.as_str() {
                "operatore" => "Operatore",
                "data" => "Data",
                "nominativo" => "TRASP",
                "ora_sotto_casa" => "OraSottoCasa",
                "ora_destinazione" => "OraDestinazione",
                "tipo_servizio" => "TipoServizio",
                _ => continue,
            };
            sharepoint_data.insert(sp_key.to_string(), value.clone());
        }

        let client = reqwest::Client::new();
        let response = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "application/json;odata=verbose")
            .header("Content-Type", "application/json;odata=verbose")
            .header("X-HTTP-Method", "MERGE")
            .header("IF-MATCH", "*")
            .json(&sharepoint_data)
            .send()
            .await
            .map_err(|e| format!("Errore nella richiesta HTTP: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!(
                "Errore nell'aggiornamento: {} - {}",
                status, error_text
            ));
        }

        Ok(())
    }
}

// Funzione helper per formattare la data da SharePoint
fn format_date_sharepoint(date_str: &str) -> String {
    if date_str.is_empty() {
        return String::new();
    }
    
    // Log per debug (solo per alcuni casi)
    let should_log = date_str.len() > 5 && (date_str.contains("2025") || date_str.contains("2024"));
    
    if should_log {
        println!("    [format_date] Input: '{}'", date_str);
    }
    
    // SharePoint può restituire date in vari formati
    // Prova a parsare come ISO 8601 (RFC3339) - formato: 2025-12-28T00:00:00Z
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(date_str) {
        // Converti al fuso orario locale (Italia = UTC+2 o UTC+1 a seconda del DST)
        use chrono::Local;
        let local_time = parsed.with_timezone(&Local);
        let formatted = local_time.format("%d/%m/%Y").to_string();
        if should_log {
            println!("    [format_date] Parsato come RFC3339 (UTC) -> Convertito a locale: {}", formatted);
        }
        return formatted;
    }
    
    // Prova formato ISO 8601 senza timezone - formato: 2025-12-28T00:00:00
    if let Ok(parsed) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S") {
        let formatted = parsed.format("%d/%m/%Y").to_string();
        if should_log {
            println!("    [format_date] Parsato come ISO senza timezone: {}", formatted);
        }
        return formatted;
    }
    
    // Prova formato semplice YYYY-MM-DD
    if let Ok(parsed) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        let formatted = parsed.format("%d/%m/%Y").to_string();
        if should_log {
            println!("    [format_date] Parsato come YYYY-MM-DD: {}", formatted);
        }
        return formatted;
    }
    
    // Prova formato DD/MM/YYYY (già in formato italiano)
    if date_str.contains('/') {
        if should_log {
            println!("    [format_date] Già in formato con /, restituisco così com'è: {}", date_str);
        }
        return date_str.to_string();
    }
    
    if should_log {
        println!("    [format_date] Nessun formato riconosciuto, restituisco originale: {}", date_str);
    }
    date_str.to_string()
}

// Funzione helper per formattare l'ora da SharePoint
fn format_time_sharepoint(time_str: &str) -> String {
    if time_str.is_empty() {
        return String::new();
    }
    
    // Se già in formato HH:MM, restituisci così com'è
    if time_str.contains(':') && time_str.len() <= 5 {
        return time_str.to_string();
    }
    
    // Prova a estrarre l'ora da un datetime
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(time_str) {
        return parsed.format("%H:%M").to_string();
    }
    
    time_str.to_string()
}

