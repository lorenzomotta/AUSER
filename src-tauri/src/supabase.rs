// Modulo per l'integrazione con Supabase
use serde::{Deserialize, Serialize};
use serde_json::Value;
use chrono::NaiveTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupabaseTablesConfig {
    pub tesserati: String,
    pub servizi: String,
    pub automezzi: String,
    pub dotazioni_mezzi: String,
    pub impostazioni: String,
    pub motivazioni_trasporto: String,
    pub motorizzazioni: String,
    pub richiedenti: String,
    pub stato_del_servizio: String,
    pub telefoni: String,
    pub tipo_pagamenti: String,
    pub tipo_socio: String,
    pub tipologia_socio: String,
    pub tratte: String,
    pub user_permissions: String,
    pub tesseramenti: String,
}

impl SupabaseTablesConfig {
    pub fn table_name(&self, table_type: &str) -> Option<&str> {
        match table_type {
            "tesserati" => Some(&self.tesserati),
            "servizi" => Some(&self.servizi),
            "automezzi" => Some(&self.automezzi),
            "dotazioni_mezzi" => Some(&self.dotazioni_mezzi),
            "impostazioni" => Some(&self.impostazioni),
            "motivazioni_trasporto" => Some(&self.motivazioni_trasporto),
            "motorizzazioni" => Some(&self.motorizzazioni),
            "richiedenti" => Some(&self.richiedenti),
            "stato_del_servizio" => Some(&self.stato_del_servizio),
            "telefoni" => Some(&self.telefoni),
            "tipo_pagamenti" => Some(&self.tipo_pagamenti),
            "tipo_socio" => Some(&self.tipo_socio),
            "tipologia_socio" => Some(&self.tipologia_socio),
            "tratte" => Some(&self.tratte),
            "user_permissions" => Some(&self.user_permissions),
            "tesseramenti" => Some(&self.tesseramenti),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupabaseConfig {
    pub url: String,
    pub anon_key: String,
    pub tables: SupabaseTablesConfig,
}

pub struct SupabaseClient {
    pub config: SupabaseConfig,
    http: reqwest::Client,
}

impl SupabaseClient {
    pub fn new(config: SupabaseConfig) -> Self {
        Self {
            config,
            http: reqwest::Client::new(),
        }
    }

    fn apply_auth_headers(
        &self,
        request: reqwest::RequestBuilder,
    ) -> reqwest::RequestBuilder {
        let key = &self.config.anon_key;
        let request = request.header("apikey", key);
        // Chiavi legacy JWT (eyJ...): servono apikey + Authorization Bearer
        // Chiavi nuove publishable (sb_publishable_...): solo apikey
        if key.starts_with("eyJ") {
            request.header("Authorization", format!("Bearer {}", key))
        } else {
            request
        }
    }

    /// Legge tutte le righe da una tabella Supabase, con paginazione automatica.
    /// PostgREST limita di default a 1000 righe per richiesta.
    pub async fn fetch_table(
        &self,
        table_type: &str,
        filter: Option<&str>,
        columns: Option<&str>,
        order: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        const PAGE_SIZE: usize = 1000;
        const MAX_PAGES: usize = 100;

        let table_name = self
            .config
            .tables
            .table_name(table_type)
            .ok_or_else(|| format!("Tipo tabella Supabase sconosciuto: {}", table_type))?;

        let base = self.config.url.trim_end_matches('/');
        let select_cols = columns.unwrap_or("*");

        let mut all_rows: Vec<Value> = Vec::new();
        let mut offset: usize = 0;

        for page in 1..=MAX_PAGES {
            let mut url = format!("{}/rest/v1/{}?select={}", base, table_name, select_cols);

            if let Some(f) = filter {
                url.push('&');
                url.push_str(f);
            }
            if let Some(o) = order {
                url.push_str("&order=");
                url.push_str(o);
            }
            url.push_str(&format!("&limit={}&offset={}", PAGE_SIZE, offset));

            println!(
                "📡 Supabase GET [{} → {}] pagina {} (offset {}): {}",
                table_type, table_name, page, offset, url
            );

            let request = self
                .http
                .get(&url)
                .header("Content-Type", "application/json")
                .header("Prefer", "count=exact");

            let response = self
                .apply_auth_headers(request)
                .send()
                .await
                .map_err(|e| format!("Errore connessione Supabase: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("Errore Supabase HTTP {}: {}", status, body));
            }

            if let Some(content_range) = response.headers().get("content-range") {
                if let Ok(cr) = content_range.to_str() {
                    println!("  Content-Range: {}", cr);
                }
            }

            let batch: Vec<Value> = response
                .json()
                .await
                .map_err(|e| format!("Errore parsing risposta Supabase: {}", e))?;

            let batch_len = batch.len();
            all_rows.extend(batch);

            if batch_len < PAGE_SIZE {
                break;
            }

            if order.is_none() {
                println!(
                    "  ⚠️ Supabase [{}]: pagina piena senza order — rischio righe mancanti/duplicate",
                    table_type
                );
            }

            offset += PAGE_SIZE;
        }

        if all_rows.len() >= PAGE_SIZE * MAX_PAGES {
            println!(
                "⚠️ Supabase [{}]: raggiunto limite massimo {} righe",
                table_type,
                all_rows.len()
            );
        }

        println!(
            "✓ Supabase [{}]: {} righe totali ricevute",
            table_type,
            all_rows.len()
        );

        if all_rows.is_empty() {
            println!("  ⚠️ 0 righe — verifica: dati in tabella, RLS policy, o nome tabella");
        } else if let Some(first) = all_rows.first() {
            if let Some(obj) = first.as_object() {
                let mut keys: Vec<&String> = obj.keys().collect();
                keys.sort();
                println!(
                    "  📋 Colonne prima riga ({}): {:?}",
                    keys.len(),
                    keys.iter().take(8).map(|k| k.as_str()).collect::<Vec<_>>()
                );
            }
        }

        Ok(all_rows)
    }

    pub async fn fetch_tesserati(
        &self,
        filter: Option<&str>,
        columns: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        self.fetch_table("tesserati", filter, columns, Some("IdSocio.asc"))
            .await
    }

    pub async fn fetch_automezzi(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("automezzi", filter, None, None).await
    }

    pub async fn fetch_dotazioni_mezzi(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("dotazioni_mezzi", filter, None, Some("Dotazione.asc"))
            .await
    }

    /// Inserisce una nuova dotazione nella tabella DotazioniMezzi_supa
    pub async fn insert_dotazione_mezzo(&self, dotazione: &str) -> Result<(), String> {
        let table_name = &self.config.tables.dotazioni_mezzi;
        let base = self.config.url.trim_end_matches('/');
        let url = format!("{}/rest/v1/{}", base, table_name);

        let body = serde_json::json!({ "Dotazione": dotazione });

        println!(
            "📡 Supabase POST [dotazioni_mezzi → {}] Dotazione='{}'",
            table_name, dotazione
        );

        let request = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(&body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase POST dotazioni_mezzi: {}", e))?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        Err(format!(
            "Errore Supabase POST dotazioni_mezzi HTTP {}: {}",
            status, err_body
        ))
    }

    pub async fn fetch_tipologie_socio(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("tipo_socio", filter, None, None).await
    }

    pub async fn fetch_richiedenti(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("richiedenti", filter, None, None).await
    }

    pub async fn fetch_tipi_pagamento(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("tipo_pagamenti", filter, None, None).await
    }

    /// Inserisce una nuova tipologia in TipoSocio_supa
    pub async fn insert_tipologia_socio(&self, tipologia: &str) -> Result<(), String> {
        let table_name = &self.config.tables.tipo_socio;
        let template_rows = self.fetch_tipologie_socio(None).await.unwrap_or_default();
        let column_key = template_rows
            .first()
            .and_then(resolve_tipologia_lookup_column)
            .unwrap_or_else(|| "TipologiaSocio".to_string());

        let mut body = serde_json::Map::new();
        body.insert(column_key.clone(), serde_json::json!(tipologia));

        let base = self.config.url.trim_end_matches('/');
        let url = format!("{}/rest/v1/{}", base, table_name);

        println!(
            "📡 Supabase POST [tipo_socio → {}] {}='{}'",
            table_name, column_key, tipologia
        );

        self.post_tipologia_row(&url, &body).await
    }

    async fn post_tipologia_row(
        &self,
        url: &str,
        body: &serde_json::Map<String, Value>,
    ) -> Result<(), String> {
        let request = self
            .http
            .post(url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase POST tipologia: {}", e))?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        Err(format!(
            "Errore Supabase POST tipologia HTTP {}: {}",
            status, err_body
        ))
    }

    pub async fn fetch_servizi(&self, filter: Option<&str>) -> Result<Vec<Value>, String> {
        self.fetch_table("servizi", filter, None, Some("idservizio.asc"))
            .await
    }

    pub async fn fetch_servizi_motivazioni(&self) -> Result<Vec<Value>, String> {
        self.fetch_table(
            "servizi",
            Some("Motivazione=not.is.null"),
            Some("Motivazione"),
            Some("Motivazione.asc"),
        )
        .await
    }

    /// Aggiorna un servizio per IdServizio (PATCH PostgREST)
    pub async fn patch_servizio(
        &self,
        id_servizio: u32,
        body: &serde_json::Map<String, Value>,
    ) -> Result<(), String> {
        if body.is_empty() {
            return Ok(());
        }

        let table_name = &self.config.tables.servizi;
        let base = self.config.url.trim_end_matches('/');
        let url = format!(
            "{}/rest/v1/{}?idservizio=eq.{}",
            base, table_name, id_servizio
        );

        println!("📡 Supabase PATCH [servizi → {}] idservizio={}", table_name, id_servizio);

        let request = self
            .http
            .patch(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase PATCH: {}", e))?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();

        // Fallback: prova altri nomi colonna ID
        for id_col in ["IdServizio", "IDSERVIZIO"] {
            let url_alt = format!(
                "{}/rest/v1/{}?{}=eq.{}",
                base, table_name, id_col, id_servizio
            );
            let request2 = self
                .http
                .patch(&url_alt)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(body);
            let response2 = self
                .apply_auth_headers(request2)
                .send()
                .await
                .map_err(|e| format!("Errore connessione Supabase PATCH: {}", e))?;
            if response2.status().is_success() {
                return Ok(());
            }
        }

        Err(format!("Errore Supabase PATCH HTTP {}: {}", status, err_body))
    }

    pub async fn fetch_tesseramenti(
        &self,
        filter: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        self.fetch_table("tesseramenti", filter, None, Some("Anno.desc"))
            .await
    }

    /// Aggiorna un tesserato per IdSocio (PATCH PostgREST)
    pub async fn patch_tesserato(
        &self,
        idsocio: &str,
        body: &serde_json::Map<String, Value>,
    ) -> Result<(), String> {
        if body.is_empty() {
            return Ok(());
        }

        let table_name = &self.config.tables.tesserati;
        let base = self.config.url.trim_end_matches('/');
        let url = format!(
            "{}/rest/v1/{}?IdSocio=eq.{}",
            base, table_name, idsocio
        );

        println!(
            "📡 Supabase PATCH [tesserati → {}] IdSocio={}",
            table_name, idsocio
        );

        let request = self
            .http
            .patch(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase PATCH tesserati: {}", e))?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        Err(format!("HTTP {}: {}", status, err_body))
    }

    /// Inserisce un nuovo tesserato (POST PostgREST)
    pub async fn insert_tesserato(
        &self,
        body: &serde_json::Map<String, Value>,
    ) -> Result<Value, String> {
        let table_name = &self.config.tables.tesserati;
        let base = self.config.url.trim_end_matches('/');
        let url = format!("{}/rest/v1/{}", base, table_name);

        println!("📡 Supabase POST [tesserati → {}]", table_name);

        let request = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase POST tesserati: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Errore Supabase POST tesserati HTTP {}: {}",
                status, err_body
            ));
        }

        let rows: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Errore parsing risposta insert tesserato: {}", e))?;

        rows.into_iter()
            .next()
            .ok_or_else(|| "Nessuna riga restituita dopo insert tesserato".to_string())
    }

    /// Aggiorna un automezzo per IdAutomezzo (PATCH PostgREST)
    pub async fn patch_automezzo(
        &self,
        id_automezzo: u32,
        body: &serde_json::Map<String, Value>,
    ) -> Result<(), String> {
        if body.is_empty() {
            return Ok(());
        }

        let table_name = &self.config.tables.automezzi;
        let base = self.config.url.trim_end_matches('/');
        let mut last_error: Option<String> = None;

        for id_col in ["IdAutomezzo", "ID_AUTOMEZZO", "id"] {
            let url = format!(
                "{}/rest/v1/{}?{}=eq.{}",
                base, table_name, id_col, id_automezzo
            );

            println!(
                "📡 Supabase PATCH [automezzi → {}] {}={}",
                table_name, id_col, id_automezzo
            );

            let request = self
                .http
                .patch(&url)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(body);

            let response = self
                .apply_auth_headers(request)
                .send()
                .await
                .map_err(|e| format!("Errore connessione Supabase PATCH automezzi: {}", e))?;

            if response.status().is_success() {
                return Ok(());
            }

            let status = response.status();
            let err_body = response.text().await.unwrap_or_default();
            last_error = Some(format!("HTTP {}: {}", status, err_body));
        }

        Err(last_error.unwrap_or_else(|| {
            format!("Impossibile aggiornare automezzo IdAutomezzo={}", id_automezzo)
        }))
    }

    /// Inserisce un nuovo automezzo (POST PostgREST)
    pub async fn insert_automezzo(
        &self,
        body: &serde_json::Map<String, Value>,
    ) -> Result<Value, String> {
        let table_name = &self.config.tables.automezzi;
        let base = self.config.url.trim_end_matches('/');
        let url = format!("{}/rest/v1/{}", base, table_name);

        println!("📡 Supabase POST [automezzi → {}]", table_name);

        let request = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase POST automezzi: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Errore Supabase POST automezzi HTTP {}: {}",
                status, err_body
            ));
        }

        let rows: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Errore parsing risposta insert automezzo: {}", e))?;

        rows.into_iter()
            .next()
            .ok_or_else(|| "Nessuna riga restituita dopo insert automezzo".to_string())
    }

    /// Inserisce o aggiorna un tesseramento (POST o PATCH su tabella tesseramenti)
    pub async fn upsert_tesseramento(
        &self,
        body: &serde_json::Map<String, Value>,
    ) -> Result<Value, String> {
        let table_name = &self.config.tables.tesseramenti;
        let base = self.config.url.trim_end_matches('/');

        let idsocio = body
            .get("IdSocio")
            .map(json_to_string)
            .unwrap_or_default();
        let anno = body.get("Anno").map(json_to_string).unwrap_or_default();

        if idsocio.is_empty() || anno.is_empty() {
            return Err("IdSocio e Anno obbligatori per il tesseramento".to_string());
        }

        // Prova PATCH se esiste già (IdSocio + Anno)
        for id_col in ["IdSocio", "IDSOCIO"] {
            let url = format!(
                "{}/rest/v1/{}?{}=eq.{}&Anno=eq.{}",
                base, table_name, id_col, idsocio, anno
            );

            let request = self
                .http
                .patch(&url)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=representation")
                .json(body);

            let response = self
                .apply_auth_headers(request)
                .send()
                .await
                .map_err(|e| format!("Errore connessione Supabase PATCH tesseramenti: {}", e))?;

            if response.status().is_success() {
                let rows: Vec<Value> = response
                    .json()
                    .await
                    .map_err(|e| format!("Errore parsing risposta tesseramento: {}", e))?;
                if let Some(row) = rows.into_iter().next() {
                    return Ok(row);
                }
            }
        }

        // INSERT nuovo tesseramento
        let url = format!("{}/rest/v1/{}", base, table_name);
        println!(
            "📡 Supabase POST [tesseramenti → {}] IdSocio={} Anno={}",
            table_name, idsocio, anno
        );

        let request = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(body);

        let response = self
            .apply_auth_headers(request)
            .send()
            .await
            .map_err(|e| format!("Errore connessione Supabase POST tesseramenti: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let err_body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Errore Supabase POST tesseramenti HTTP {}: {}",
                status, err_body
            ));
        }

        let rows: Vec<Value> = response
            .json()
            .await
            .map_err(|e| format!("Errore parsing risposta tesseramento: {}", e))?;

        rows.into_iter()
            .next()
            .ok_or_else(|| "Nessuna riga restituita dopo insert tesseramento".to_string())
    }
}

/// Colonna testo nella tabella TipoSocio_supa (es. TipologiaSocio)
fn resolve_tipologia_lookup_column(row: &Value) -> Option<String> {
    for name in [
        "TipologiaSocio",
        "TIPOLOGIASOCIO",
        "TipoSocio",
        "TIPOSOCIO",
        "Tipologia",
        "TIPOLOGIA",
        "Descrizione",
        "Nome",
    ] {
        if row.get(name).is_some() {
            return Some(name.to_string());
        }
    }

    if let Some(obj) = row.as_object() {
        for (key, val) in obj {
            let lower = key.to_lowercase();
            if lower.contains("id") {
                continue;
            }
            if !json_to_string(val).trim().is_empty() {
                return Some(key.clone());
            }
        }
    }

    None
}

/// Converte un valore JSON Supabase in stringa
pub fn json_to_string(val: &Value) -> String {
    match val {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 {
                    (f as i64).to_string()
                } else {
                    f.to_string()
                }
            } else {
                n.to_string()
            }
        }
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        _ => val.to_string(),
    }
}

/// Estrae un campo dalla riga Supabase (nomi colonna PascalCase)
pub fn get_field(row: &Value, name: &str) -> String {
    row.get(name)
        .map(json_to_string)
        .unwrap_or_default()
}

/// Legge un campo booleano Supabase come stringa ("true"/"false" o "SI"/"NO")
pub fn get_bool_field(row: &Value, names: &[&str]) -> String {
    for name in names {
        if let Some(v) = row.get(*name) {
            match v {
                Value::Bool(b) => return b.to_string(),
                Value::Null => continue,
                Value::Number(n) => {
                    let truthy = n.as_i64().map(|i| i != 0).unwrap_or(false)
                        || n.as_f64().map(|f| f != 0.0).unwrap_or(false);
                    return if truthy {
                        "true".to_string()
                    } else {
                        "false".to_string()
                    };
                }
                _ => {
                    let s = json_to_string(v);
                    if !s.is_empty() {
                        return s;
                    }
                }
            }
        }
    }
    String::new()
}

/// Formatta un orario ISO (HH:MM:SS) in HH:MM
pub fn format_time_iso(time_str: &str) -> String {
    let trimmed = time_str.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Ok(t) = NaiveTime::parse_from_str(trimmed, "%H:%M:%S") {
        return t.format("%H:%M").to_string();
    }
    if let Ok(t) = NaiveTime::parse_from_str(trimmed, "%H:%M") {
        return t.format("%H:%M").to_string();
    }
    trimmed.to_string()
}

/// Formatta una data ISO (yyyy-mm-dd) in formato italiano dd/mm/yyyy
pub fn format_date_iso(date_str: &str) -> String {
    let trimmed = date_str.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(date_part) = trimmed.split('T').next() {
        let parts: Vec<&str> = date_part.split('-').collect();
        if parts.len() == 3 {
            return format!("{}/{}/{}", parts[2], parts[1], parts[0]);
        }
    }
    trimmed.to_string()
}
