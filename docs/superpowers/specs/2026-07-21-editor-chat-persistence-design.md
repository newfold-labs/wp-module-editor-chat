# Design: persistenza server-side delle chat dell'editor

- **Data:** 2026-07-21
- **Modulo:** wp-module-editor-chat
- **Stato:** approvato in brainstorming, pronto per il piano di implementazione

## Problema

Oggi la chat dell'editor vive in una singola conversazione "attiva" per sito, in
`localStorage`, con TTL di 24h. Non c'è cronologia, non si può riprendere una
chat scaduta, e tutto si perde cambiando browser/dispositivo o svuotando lo
storage. Riprendere una chat vecchia è anche rischioso: la pagina potrebbe
essere stata modificata (o cancellata) nel frattempo, per cui i vecchi tool
call possono riferirsi a `clientId` e blocchi non più esistenti.

## Scope

Questo design copre **esclusivamente wp-module-editor-chat**. La controparte
`ai-platform` (repo Herd separato, non presente in questo workspace) riceve
solo un **contratto d'interfaccia** (vedi sezione Mirror asincrono) da girare
come specifica per un ticket a parte in quel repo. Non viene definita né
verificata alcuna suite di test automatica in questo progetto: la verifica è
manuale (vedi sezione Testing).

## Architettura generale

La tabella WP `{prefix}nfd_editor_chats` è la fonte di verità primaria e a
bassa latenza. `ai-platform` è uno specchio asincrono a sola analisi, mai nel
percorso critico dell'utente. `activeChatStorage.js` (localStorage) resta come
cache di fallback per la sola chat aperta al momento (crash/offline
recovery), non più come cronologia primaria.

Flusso:
1. **Creazione** — al primo messaggio utente di una chat nuova, il client
   chiama `POST /conversations` con `post_id`, `post_type`,
   `post_modified_seen_at` correnti (da `core/editor`). Il server ignora
   qualunque `user_id`/`site_url_hash` inviato dal client e li deriva
   server-side.
2. **Turni successivi** — il client accumula i messaggi in memoria e li invia
   con `PUT /conversations/{id}`, debounced ~1s. Ogni `PUT` riuscito aggiorna
   anche `post_modified_seen_at`.
3. **Ogni `PUT`/`DELETE` riuscito** → `AiPlatformMirror::schedule_sync($id)`
   pianifica un evento WP-Cron one-off, mai bloccante per l'utente.
4. **Cronologia** — `GET /conversations` (paginata, senza blob messaggi)
   popola la dropdown; click su una riga → risoluzione stato pagina → se
   necessario `GET /conversations/{id}` per il payload completo.

Identità: **mai fidarsi del client**. `user_id` = `get_current_user_id()`,
`site_url_hash` = hash server-side di `get_site_url()`.

## Schema DB (`includes/Database/EditorChatTable.php`)

```sql
CREATE TABLE {prefix}nfd_editor_chats (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id                 BIGINT UNSIGNED NOT NULL,
    site_url_hash           VARCHAR(8) NOT NULL,
    post_id                 BIGINT UNSIGNED NOT NULL,
    post_type               VARCHAR(20) NOT NULL,
    post_modified_seen_at   DATETIME NOT NULL,
    title                   VARCHAR(255) NOT NULL DEFAULT '',
    messages                LONGTEXT NOT NULL,
    created_at              DATETIME NOT NULL,
    updated_at              DATETIME NOT NULL,
    deleted_at              DATETIME NULL,
    PRIMARY KEY  (id)
) {charset_collate};
```

Nessun indice secondario — coerente con la convenzione del monorepo Newfold
(nessuna tabella custom esistente usa indici oltre alla PK). Le query di
lista filtrano `user_id`/`site_url_hash`/`deleted_at` senza indice dedicato;
accettabile ai volumi previsti (conversazioni per utente per sito, non
milioni di righe).

- `site_url_hash`: `VARCHAR(8)`, calcolato server-side con lo stesso
  algoritmo di `SiteHashHelper::short_hash()` di `wp-module-ai-chat` (md5
  troncato a 8 caratteri) — coerenza col meta JSON che finirà su
  `ai-platform`. Implementato come helper locale (nessuna dipendenza
  cross-modulo lato PHP).
- `messages`: JSON dell'intero array di messaggi interni, stessa struttura
  già prodotta da `runChatLoop` (tool_calls/tool_results inclusi as-is,
  nessuna nuova normalizzazione).
- `title`: calcolato **server-side** ad ogni `PUT`, se ancora vuoto, come
  primi ~60 caratteri del primo messaggio `role=user` (stesso criterio
  visivo di `ChatHistoryList.jsx`). Il client non manda mai un titolo
  esplicito.

### Upgrade routine

Il modulo non ha mai avuto tabelle custom né un activation hook affidabile
(è caricato dal Newfold Module Loader, non standalone). Approccio:
version-check ad ogni load, non `register_activation_hook`.

- `EditorChatTable::DB_VERSION` (costante) confrontata con l'opzione
  `nfd_editor_chats_db_version`.
- `EditorChatTable::maybe_upgrade()` chiamata da `ChatEditor` su `init`
  (priorità bassa, prima delle richieste REST) — se le versioni non
  coincidono, esegue `dbDelta()` e aggiorna l'opzione. Idempotente: se
  coincidono, esce subito dopo un `get_option()`.

## REST API (`includes/RestApi/ConversationsController.php`)

Namespace `nfd-editor-chat/v1` (stesso di `/config`), registrato da
`ChatEditor::register_rest_routes()`.

**Permessi:** tutte le rotte usano `permission_callback => fn() =>
Permissions::is_editor()`. Comportamento nativo WP: `false` → 403 per
loggato-non-editor, 401 per non loggato.

**Scoping anti-IDOR:** ogni query `$wpdb` filtra sempre `id AND user_id =
get_current_user_id() AND site_url_hash = <server-side> AND deleted_at IS
NULL`. Riga non matchata → **404** (mai 403, per non rivelare l'esistenza di
conversazioni altrui).

| Metodo | Path | Note |
|---|---|---|
| GET | `/conversations` | `limit` (default/max 20), `cursor`. Solo metadata, mai `messages`. |
| GET | `/conversations/{id}` | Riga completa incl. `messages` decodificato. Include anche `post_status` (via `get_post_status($post_id)`, `null` se non esiste), per evitare un round-trip client extra. |
| POST | `/conversations` | Body: `post_id`, `post_type`, `post_modified_seen_at`. Crea riga (`messages='[]'`, `title=''`). Ritorna `{ id }`. |
| PUT | `/conversations/{id}` | Body: `messages` (array), `post_modified_seen_at?`. Sostituisce `messages`, aggiorna `updated_at`; se fornito, aggiorna `post_modified_seen_at`. |
| DELETE | `/conversations/{id}` | Soft-delete: `deleted_at = now()`. |

**Cursore di paginazione:** opaco, base64 di `"{updated_at}|{id}"`, con query
`WHERE (updated_at, id) < (cursor_updated_at, cursor_id)` — evita duplicati o
elementi saltati in caso di timestamp identici tra pagine.

**Validazione:** `messages` deve decodificare a un array JSON valido,
altrimenti `400`. Nessun'altra validazione di struttura.

Dopo ogni `PUT`/`DELETE` riuscito → `AiPlatformMirror::schedule_sync($id)`.

## Mirror asincrono (`includes/Mirror/AiPlatformMirror.php`)

- `schedule_sync(int $conversation_id)`: `wp_schedule_single_event(time() +
  5, 'nfd_editor_chat_sync', [$conversation_id])`, solo se non già
  pianificato per lo stesso id (`wp_next_scheduled`) — de-dup per raffiche di
  scritture ravvicinate.
- `handle_sync(int $conversation_id)`: hook su `nfd_editor_chat_sync`. Carica
  la riga (anche soft-deleted, per propagare le delete), costruisce il
  payload e fa `POST` a
  `NFD_AI_PLATFORM_SYNC_URL . '/api/v1/editor-chat/conversations/sync'` via
  `wp_remote_post()`, header `Authorization` col token Hiive (riuso di
  `HiiveConnection::get_auth_token()`, già usato in
  `ChatEditor::get_config()`).
- **Retry:** su errore/`WP_Error`, contatore tentativi in transient
  (`nfd_editor_chat_sync_attempts_{id}`), backoff esponenziale (es. 30s,
  2min, 8min, 30min — 4 tentativi). Dopo l'ultimo tentativo: `error_log()` e
  pulizia del transient. Meccanismo: `wp_schedule_single_event` standard
  (nessuna libreria di code trovata nel monorepo).

### Contratto per ai-platform (fuori scope di implementazione qui)

```json
{
  "conversation_id": 123,
  "user_id": 45,
  "site_url_hash": "a1b2c3d4",
  "title": "...",
  "messages": [ /* array messaggi interni */ ],
  "deleted": false,
  "meta": {
    "post_id": 67,
    "post_type": "page",
    "post_modified_seen_at": "2026-07-21 10:00:00"
  }
}
```

Endpoint: `POST /api/v1/editor-chat/conversations/sync`, auth middleware
Hiive esistente. Persistenza di `meta.*` nella colonna meta JSON già presente
su `agent_conversations` — nessuna migrazione schema in ai-platform.

## Client (`src/...`)

**`useEditorChatREST.js`:**
- Nuovo stato `conversationId`. `POST /conversations` al primo messaggio
  utente di una chat nuova; `PUT /conversations/{conversationId}` debounced
  ~1s ad ogni cambio di `messages` (timer in `useRef`, reset ad ogni
  modifica — non blocca mai il typing/streaming).
- Ogni turno completato con successo avanza `post_modified_seen_at` nel
  payload del `PUT`.
- `activeChatStorage.js` non cambia API, scrive in parallelo come fallback
  locale (non più consultato per la cronologia).
- Se il `PUT` fallisce (rete/offline): lo stato resta "dirty" e viene
  ritentato al prossimo trigger di debounce; nessun errore intrusivo
  all'utente, il fallback locale copre crash/reload.

**Migrazione one-shot** (mount effect, versione semplificata):
```js
if (!localStorage.getItem('nfd-editor-chat-migrated')) {
    const { messages } = loadActiveChat(); // rispetta il TTL 24h esistente
    if (messages.length) {
        const { id } = await createConversation({ post_id, post_type, post_modified_seen_at });
        await updateConversation(id, { messages });
        setConversationId(id);
    }
    localStorage.setItem('nfd-editor-chat-migrated', '1');
    clearActiveChat();
}
```
Nessuna chiave scratch intermedia: se `POST` o `PUT` falliscono, flag e
`clearActiveChat()` non vengono eseguiti e si riprova tutto da capo al
prossimo load, accettando nel caso raro di fallimento a metà una possibile
riga vuota duplicata sul server (nessun impatto funzionale). Chat scadute
(>24h TTL) non vengono migrate — stesso comportamento di oggi. Su
multi-dispositivo, ogni browser migra la propria chat attiva
indipendentemente (righe separate, nessun merge cross-device).

**Ambiguità nota e risolta:** il vecchio modello `activeChatStorage` era una
singola chat "rolling" per sito, senza `post_id` associato. Alla migrazione
non esiste quindi un "post di origine" storicamente corretto da recuperare:
la riga migrata viene attribuita al post correntemente aperto nell'editor al
momento del mount effect (la stessa pagina che l'utente sta guardando quando
la migrazione scatta). È un'approssimazione accettata, non un bug: è il
miglior dato disponibile dato che il vecchio modello non era page-scoped.

**Dropdown cronologia — fork mirato:** nuovo
`src/components/sidebar/ConversationHistoryDropdown.jsx` + hook
`useConversationHistory.js`, montato accanto a "+ New Chat" in
`SidebarHeader.jsx`. Riuso da `wp-module-ai-chat` solo dei pattern UI
(portale `createPortal`, posizionamento `useLayoutEffect`, classe `--up` se
manca spazio sotto) — dati sempre via REST (`GET /conversations`
cursor-paginato, 20/pagina). Nessun riuso del data-layer localStorage
esistente (incompatibile con paginazione server-side).

**Visibilità dropdown:** `ChatEditor` espone `isEditor` (stesso check di
`Permissions::is_editor()`) via `wp_localize_script`. Il componente non si
monta se `isEditor` è `false` — nessuna richiesta REST né flash della UI per
utenti non-editor.

**Click su una riga:**
1. Legge `post_status` dalla risposta di `GET /conversations/{id}` (già
   incluso lato server, nessun round-trip extra).
2. `null`/trashed → apre **read-only**, nota "pagina non più esistente" +
   azione elimina chat.
3. Post esistente ma diverso da quello aperto → conferma inline ("Vai alla
   pagina originale" / "Continua qui in lettura"). Naviga → naviga; Continua
   → read-only (input disabilitato).
4. Stesso post → hydrate `messages` + `conversationHistoryRef`.

**Banner drift:** dopo l'hydration, confronta `post_modified_seen_at`
salvato col `post_modified` corrente; se più recente, banner dismissibile
non bloccante sopra la lista messaggi; auto-dismiss al primo nuovo messaggio
utente.

**Nota di ri-contesto post-resume:** flag effimero (`needsResumeNoticeRef`),
settato `true` all'hydration da cronologia, letto e azzerato in
`runChatLoop` al primo turno successivo — aggiunge una riga di sistema al
payload verso il Worker CF ("i tool call precedenti possono riferirsi a
clientId non più esistenti, rileggi sempre l'albero blocchi corrente"). Non
viene mai persistita nei `messages` salvati.

**Delete (X) in dropdown:** rimozione ottimistica dalla lista in state →
`DELETE /conversations/{id}` → su errore, reinserisce la riga (rollback).

**Read-only mode:** input e bottone invio disabilitati; bottone elimina e
banner drift restano attivi; nessuna scrittura (`PUT`) viene mai innescata.

## Testing

Nessuna infrastruttura di test viene introdotta in questo progetto (il
modulo non ne ha oggi, solo lint/format). Verifica manuale:
- **API:** curl/Postman su ciascun endpoint — CRUD, 403 non-editor, 404 su
  conversazioni di altro utente (scoping), 400 su `messages` non-array.
- **UI:** flusso completo nuova chat → salvataggio debounced → riapertura da
  dropdown → banner drift → pagina cestinata → read-only → delete con
  rollback (throttling di rete disattivato per simulare fallimenti).
- **Mirror:** trigger manuale di `handle_sync`, simulazione di fallimento
  (URL errato) per osservare backoff e log finale.

## Decisioni chiave e alternative scartate

| Decisione | Alternativa scartata | Motivo |
|---|---|---|
| ai-platform trattato come solo contratto d'interfaccia | Implementare anche lì | Repo non presente in questo workspace |
| Fork mirato dei componenti history | Riuso diretto di `ChatHistoryList`/`Dropdown` | Sono accoppiati a localStorage, incompatibili con paginazione REST |
| `site_url_hash` calcolato server-side | Fidarsi del valore client | Requisito esplicito "never trust client-supplied identity" |
| Upgrade via version-check su `init` | `register_activation_hook` | Il modulo non ha un activation hook affidabile (caricato da Module Loader) |
| `wp_schedule_single_event` per il mirror | Action Scheduler o altra coda | Nessuna libreria di code trovata nel monorepo |
| Solo PK sulla tabella, nessun indice secondario | Indice composito `(user_id, site_url_hash, updated_at)` | Convenzione del monorepo, volumi previsti bassi |
| Migrazione localStorage semplice (retry integrale) | Chiave scratch per riprendere da `PUT` dopo `POST` riuscito | Complessità non giustificata dal rischio (solo un piccolo overhead di righe duplicate raro) |
| Nessuna infrastruttura di test in questo progetto | Setup wp-browser + test-unit-js | Scope esplicitamente limitato a verifica manuale |
