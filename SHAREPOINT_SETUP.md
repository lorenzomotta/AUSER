# Configurazione Integrazione SharePoint

## URL Lista SharePoint

La lista SharePoint da utilizzare è:
**https://astiauser.sharepoint.com/sites/CALENDARIOSERVIZISHARE/Lists/LOREAPP_SERVIZI**

## Mapping Campi

I campi del form sono mappati alle colonne SharePoint come segue:

| Campo Form | Colonna SharePoint |
|------------|-------------------|
| id | Id |
| operatore | Operatore |
| data | Data |
| nominativo | Nominativo |
| ora_sotto_casa | OraSottoCasa |
| ora_destinazione | OraDestinazione |
| tipo_servizio | TipoServizio |

## Filtri Applicati

### SERVIZI DEL GIORNO
Filtro: `Data eq datetime'YYYY-MM-DDT00:00:00Z'` (dove YYYY-MM-DD è la data di oggi)

### PROSSIMI SERVIZI
Filtro: `Data gt datetime'YYYY-MM-DDT00:00:00Z'` (data maggiore di oggi)

### SERVIZI INSERITI OGGI
Filtro: `Created ge datetime'YYYY-MM-DDT00:00:00Z'` (creati oggi)

## Autenticazione

L'applicazione richiede un access token SharePoint valido. Per ottenere il token:

1. **Metodo 1: OAuth2 con Microsoft Graph** (consigliato)
   - Registra l'app su Azure AD
   - Usa Microsoft Graph API per ottenere il token
   - Token con scope: `Sites.ReadWrite.All`

2. **Metodo 2: SharePoint REST API con autenticazione di base**
   - Usa username/password (meno sicuro)
   - Richiede credenziali valide per il sito SharePoint

## Note Implementazione

- La struttura attuale usa dati di esempio quando SharePoint non è disponibile
- Gli aggiornamenti ai campi vengono salvati automaticamente su SharePoint quando modificati
- Il formato date viene convertito automaticamente da SharePoint (ISO) a formato italiano (dd/mm/yyyy)

