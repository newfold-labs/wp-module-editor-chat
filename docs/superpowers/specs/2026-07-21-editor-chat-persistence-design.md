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

Questo design copre **esclusivamente wp-module-editor-chat**, lato WP:
tabella custom, REST API, client. Non viene definita né verificata alcuna
suite di test automatica in questo progetto: la verifica è manuale (vedi
sezione Testing).

**Il mirror asincrono verso `ai-platform` è rinviato (deferred).** Un'analisi
dello schema reale di `ai-platform` (repo Laravel in
`/Users/ziamanu/Herd/ai-platform`, non presente in questo workspace) ha
rivelato che le premesse del ticket originale sulla tabella
`agent_conversations` sono errate (non esiste una colonna `meta`, non esiste
una colonna `messages` — i messaggi sono normalizzati riga-per-riga in una
tabella separata, `user_id` punta a uno spazio di identità Laravel diverso da
quello WP). Il contratto va quindi rinegoziato con il team di ai-platform
prima di poter implementare `AiPlatformMirror`. Le domande aperte sono
raccolte nell'Appendice come testo pronto per un ticket separato.
`AiPlatformMirror::schedule_sync()`/`handle_sync()` **non vengono
implementati in questa fase** — nessuna chiamata al mirror viene aggiunta a
`ConversationsController`.

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
3. **Mirror asincrono (deferred)** — in una fase futura, ogni `PUT`/`DELETE`
   riuscito pianificherà un evento WP-Cron one-off verso `ai-platform`; non
   implementato in questa fase (vedi sezione Scope e Appendice).
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

**Mirror asincrono:** nessuna chiamata in questa fase — vedi Scope e
Appendice. Quando il contratto con ai-platform sarà chiarito, questo è il
punto dove andrà agganciato `AiPlatformMirror::schedule_sync($id)`.

## Mirror asincrono — rinviato (deferred)

`includes/Mirror/AiPlatformMirror.php` **non viene creato in questa fase**.
L'analisi dello schema reale di ai-platform (vedi Appendice) ha invalidato le
assunzioni del ticket originale (nessuna colonna `meta` su
`agent_conversations`, nessuna colonna `messages`, `user_id` in uno spazio di
identità diverso da quello WP, nessun endpoint di sync esistente). Prima di
implementare il mirror serve una risposta dal team ai-platform alle domande
in Appendice. Una volta chiarito il contratto, questa sezione verrà
aggiornata con lo schema payload definitivo e il piano di implementazione
riprenderà `schedule_sync`/`handle_sync` come lavoro separato.

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
| Mirror asincrono rinviato, solo lato client/WP in questo progetto | Implementare `AiPlatformMirror` ora con le assunzioni del ticket | Lo schema reale di ai-platform contraddice il ticket (niente colonna `meta`/`messages`, `user_id` non mappabile) — serve chiarire il contratto in un ticket separato prima di scrivere codice |
| Fork mirato dei componenti history | Riuso diretto di `ChatHistoryList`/`Dropdown` | Sono accoppiati a localStorage, incompatibili con paginazione REST |
| `site_url_hash` calcolato server-side | Fidarsi del valore client | Requisito esplicito "never trust client-supplied identity" |
| Upgrade via version-check su `init` | `register_activation_hook` | Il modulo non ha un activation hook affidabile (caricato da Module Loader) |
| Solo PK sulla tabella, nessun indice secondario | Indice composito `(user_id, site_url_hash, updated_at)` | Convenzione del monorepo, volumi previsti bassi |
| Migrazione localStorage semplice (retry integrale) | Chiave scratch per riprendere da `PUT` dopo `POST` riuscito | Complessità non giustificata dal rischio (solo un piccolo overhead di righe duplicate raro) |
| Nessuna infrastruttura di test in questo progetto | Setup wp-browser + test-unit-js | Scope esplicitamente limitato a verifica manuale |

## Appendice — domande per un ticket separato su ai-platform

Testo pronto da incollare come ticket nel repo `ai-platform` (Laravel/Herd),
per chiarire il contratto prima di implementare `AiPlatformMirror` lato WP.

---

**Titolo:** Definire contratto di ingest per il mirror analytics di
wp-module-editor-chat

**Contesto:** wp-module-editor-chat (plugin WP) vuole specchiare in
`ai-platform`, a scopo di sola analisi, le conversazioni della chat
dell'editor persistite in una tabella custom WP. WP resta sempre la fonte di
verità; ai-platform è un mirror best-effort, mai nel percorso critico
dell'utente. Analizzando lo schema attuale (`database/migrations/..._create_
agent_conversations_table.php`, model `Laravel\Ai\Models\Conversation` /
`ConversationMessage`), sono emersi dei disallineamenti rispetto al ticket
originale che li aveva assunti diversi. Serve una decisione prima di
procedere:

1. **Metadati WP (`post_id`, `post_type`, `post_modified_seen_at`).**
   `agent_conversations` non ha alcuna colonna `meta`/`metadata` oggi.
   Proponiamo di aggiungere una **nuova colonna `meta` (JSON, nullable)** a
   `agent_conversations` via migration additiva — generica e riusabile per
   futuri metadati esterni, non solo WP. Alternativa: colonne dedicate
   `post_id`/`post_type`/`post_modified_seen_at` direttamente su
   `agent_conversations`, più esplicite ma specifiche a WordPress su una
   tabella di un package vendor generico (`laravel/ai`). Quale preferite?

2. **Identità utente.** `agent_conversations.user_id` è un FK verso gli
   utenti Laravel di ai-platform, che non corrispondono agli utenti WP.
   Proponiamo di lasciare `user_id` sempre `null` per le conversazioni
   sincronizzate esternamente, e di portare l'identità reale
   (`site_url_hash` + WP `user_id`) dentro il nuovo campo `meta`. Va bene, o
   esiste già una mappatura sito/utente Hiive da riusare per popolare
   `user_id` correttamente?

3. **Messaggi.** I messaggi non sono un blob unico ma righe separate in
   `agent_conversation_messages` (`tool_calls`/`tool_results`/`usage`/`meta`
   come colonne distinte). Dato che WP è la fonte di verità e ogni sync
   manda lo snapshot completo della conversazione, proponiamo che l'endpoint
   di ingest faccia **delete-and-reinsert** di tutte le righe messaggio per
   quel `conversation_id` ad ogni sync (idempotente, niente logica di
   upsert-per-messaggio, niente bisogno di generare UUID stabili lato WP).
   È accettabile, o preferite un upsert incrementale per messaggio (richiede
   ID messaggio stabili e compatibili `varchar(36)` generati lato WP)?

4. **Autenticazione.** Il middleware Hiive (`HiiveTokenAuthentication`) ha
   già una whitelist con chiave `ai_chat_worker`
   (`config/sitegen.php`, env `SITEGEN_AI_CHAT_WORKER_HIIVE_TOKEN`) che
   sembra pensata per un worker/plugin esterno con token statico condiviso,
   alternativa alla verifica remota completa via Hiive capabilities. È
   questo il meccanismo giusto per autenticare le richieste di sync dal
   plugin WP verso il nuovo endpoint?

5. **Endpoint.** Non esiste oggi nessuna rotta di ingest/sync per
   conversazioni esterne. Proponiamo `POST
   /api/v1/editor-chat/conversations/sync`, protetta dal middleware Hiive di
   cui al punto 4, corpo della richiesta:
   ```json
   {
     "wp_conversation_id": 123,
     "title": "...",
     "deleted": false,
     "meta": {
       "site_url_hash": "a1b2c3d4",
       "wp_user_id": 45,
       "post_id": 67,
       "post_type": "page",
       "post_modified_seen_at": "2026-07-21 10:00:00"
     },
     "messages": [
       { "role": "user", "content": "...", "tool_calls": [], "tool_results": [], "usage": null }
     ]
   }
   ```
   Il `wp_conversation_id` andrebbe usato come chiave di lookup (nuova
   colonna indicizzata su `agent_conversations`, dato che l'`id` nativo è un
   UUID generato da Laravel) per capire se creare o aggiornare la
   conversazione mirror. Va bene questo schema?

---
