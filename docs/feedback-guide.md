# Pilot tester guide / Testanleitung für den Pilot

Local pilot 0.1.0-dev on a Mac with Apple Silicon. Everything runs on your machine in Docker Desktop; nothing is sent anywhere.
Lokaler Pilot 0.1.0-dev auf einem Mac mit Apple Silicon. Alles läuft lokal in Docker Desktop; nichts verlässt den Rechner.

## English

### 1. Start
1. Install Docker Desktop 4.30 or newer and start it.
2. Download `blackbox-<version>-macos-arm64.tar.gz` from the landing page (or unpack the archive you were given) into a folder of your choice, open Terminal in that folder.
3. `./blackbox doctor` — every line must show ✓. If not, the message names the prerequisite.
4. `./blackbox setup` — creates the local configuration, loads the bundled images, starts PostgreSQL, applies migrations and prints **your personal access key once**. Save it in your password manager now. It is never shown again (`./blackbox reset-access` issues a new one and signs everything out).
5. `./blackbox up` and open <http://127.0.0.1:19080/>. Sign in with the key. Choose EN/DE at the top; the choice persists.

### 2. First data and first answer
- **Synthetic example (no external account needed):** Sources → *Replay* (marked synthetic) → *Connect* → *Run the example*. The Golden Order-to-Cash scenario is recorded through the real pipeline (journal → engine → answers). Then open *Questions & Answers* and ask, for example, *Available to sell* for item `CUP-OLV` or *Order payment state* for `#1001`. Every answer shows its calculation, cutoffs, coverage and evidence; click a citation to open the journal entry.
- **Your Shopify store (optional, needs your own custom-app token with read scopes):** Sources → Shopify → paste the Admin API token, choose the import period (for example *last 30 days*) and connect. The run shows requested/accessible periods, pages, counts and the next poll. Partial answers stay partial until prerequisite capabilities are imported; nothing is invented.
- **Bank statement (optional):** Sources → Bank CSV → upload a CSV export, confirm the column profile in the preview, import. Amount-only matches are never linked automatically; they appear under *Needs review*.

### 3. A local agent (MCP)
Agents & MCP → *New agent key* → copy the `bbx_agent_…` key once. Configure your MCP client with the stdio bridge:
```json
{ "mcpServers": { "blackbox": { "command": "blackbox-mcp", "env": { "BLACKBOX_API_URL": "http://127.0.0.1:19080", "BLACKBOX_AGENT_KEY": "<your agent key>" } } } }
```
(`blackbox-mcp` is `node apps/mcp-bridge/dist/main.js` inside the installation folder.) The agent can only read business records and evidence of this workspace; it cannot administer, see source secrets or technical logs. Revoke the key on the same page; the next request is denied immediately.

### 4. Restart, stop, recover
- `./blackbox down` stops; `./blackbox up` starts again. Journal, cursors and sessions survive; answers at a fixed cutoff are identical afterwards.
- Backups: `./blackbox backup --configure --destination <folder outside the installation>` prints a **recovery key once** (save it separately from the access key); `./blackbox backup --now` writes one encrypted generation. `./blackbox backup --status` shows generations and when the next one is due.
- Restore into a separate folder: `./blackbox restore <file.bbx> --into <empty folder> --port 19081` (asks for the recovery key). The restored installation gets a new access key, agent keys are revoked and provider connections are paused until you review them.
- Upgrade: `./blackbox upgrade --from <extracted new release>`; it takes a backup first, fences writers, migrates, verifies and reports.
- If the UI is unavailable: `./blackbox status` and `./blackbox logs --since 2h --level warn` read the retained logs directly from disk.

### 5. What to report
Please note the version (`./blackbox version`), what you did, what you expected and what you saw. `./blackbox diagnostics export --since 24h --output blackbox-diagnostics.json` writes a local bundle (versions, health, error counts, sanitized log excerpts, max 10 MiB) you can attach; it contains no keys, tokens or business payloads.
Known external blockers of this pilot: live Shopify/Shopify Payments verification needs an authorized store (none was available during the build); only the bundled synthetic store was exercised.

## Deutsch

### 1. Start
1. Docker Desktop 4.30 oder neuer installieren und starten.
2. `blackbox-<version>-macos-arm64.tar.gz` von der Landing-Seite laden (oder das erhaltene Archiv entpacken), im Terminal in diesen Ordner wechseln.
3. `./blackbox doctor` — jede Zeile muss ✓ zeigen; sonst nennt die Meldung die fehlende Voraussetzung.
4. `./blackbox setup` — erstellt die lokale Konfiguration, lädt die gebündelten Images, startet PostgreSQL, wendet Migrationen an und zeigt **den persönlichen Zugangsschlüssel einmalig**. Jetzt im Passwort-Manager speichern; er wird nie wieder angezeigt (`./blackbox reset-access` erzeugt einen neuen und meldet alles ab).
5. `./blackbox up`, dann <http://127.0.0.1:19080/> öffnen und mit dem Schlüssel anmelden. EN/DE oben wählen; die Wahl bleibt gespeichert.

### 2. Erste Daten, erste Antwort
- **Synthetisches Beispiel (ohne externes Konto):** Quellen → *Replay* (als synthetisch gekennzeichnet) → *Verbinden* → *Beispiel ausführen*. Das Golden-Order-to-Cash-Szenario läuft durch die echte Pipeline (Journal → Engine → Antworten). Danach unter *Fragen & Antworten* z. B. *Verfügbar zum Verkauf* für Artikel `CUP-OLV` oder *Zahlungsstatus der Bestellung* für `#1001` fragen. Jede Antwort zeigt Berechnung, Stichtage, Abdeckung und Belege; ein Klick auf einen Beleg öffnet den Journaleintrag.
- **Eigener Shopify-Shop (optional, eigener Custom-App-Token mit Lese-Rechten):** Quellen → Shopify → Admin-API-Token einfügen, Importzeitraum wählen (z. B. *letzte 30 Tage*), verbinden. Der Lauf zeigt angeforderte/erreichbare Zeiträume, Seiten, Zähler und die nächste Prüfung. Teilantworten bleiben Teilantworten, bis die nötigen Fähigkeiten importiert sind; nichts wird erfunden.
- **Kontoauszug (optional):** Quellen → Bank-CSV → CSV-Export hochladen, Spaltenprofil in der Vorschau bestätigen, importieren. Reine Betragsübereinstimmungen werden nie automatisch verknüpft; sie erscheinen unter *Prüfung erforderlich*.

### 3. Ein lokaler Agent (MCP)
Agenten & MCP → *Neuer Agentenschlüssel* → den `bbx_agent_…`-Schlüssel einmalig kopieren. MCP-Client mit der stdio-Brücke konfigurieren (siehe JSON oben; `blackbox-mcp` ist `node apps/mcp-bridge/dist/main.js` im Installationsordner). Der Agent liest nur Geschäftsdaten und Belege dieses Arbeitsbereichs; keine Verwaltung, keine Quellgeheimnisse, keine technischen Logs. Widerruf auf derselben Seite; die nächste Anfrage wird sofort abgelehnt.

### 4. Neustart, Stopp, Wiederherstellung
- `./blackbox down` stoppt, `./blackbox up` startet erneut. Journal, Cursor und Sitzungen bleiben erhalten; Antworten zu einem festen Stichtag sind danach identisch.
- Sicherungen: `./blackbox backup --configure --destination <Ordner außerhalb der Installation>` zeigt einen **Wiederherstellungsschlüssel einmalig** (getrennt vom Zugangsschlüssel aufbewahren); `./blackbox backup --now` schreibt eine verschlüsselte Generation. `./blackbox backup --status` zeigt Generationen und Fälligkeit.
- Wiederherstellung in einen eigenen Ordner: `./blackbox restore <Datei.bbx> --into <leerer Ordner> --port 19081` (fragt den Wiederherstellungsschlüssel ab). Die wiederhergestellte Installation erhält einen neuen Zugangsschlüssel; Agentenschlüssel sind widerrufen, Anbieterverbindungen pausiert, bis du sie prüfst.
- Aktualisierung: `./blackbox upgrade --from <entpacktes neues Release>`; sichert zuerst, sperrt Schreiber, migriert, prüft und berichtet.
- Wenn die Oberfläche nicht erreichbar ist: `./blackbox status` und `./blackbox logs --since 2h --level warn` lesen die gespeicherten Logs direkt von der Platte.

### 5. Was du melden solltest
Bitte Version (`./blackbox version`), Schritte, Erwartung und Beobachtung notieren. `./blackbox diagnostics export --since 24h --output blackbox-diagnostics.json` schreibt ein lokales Bündel (Versionen, Zustand, Fehlerzähler, bereinigte Logauszüge, max. 10 MiB) zum Anhängen; es enthält keine Schlüssel, Tokens oder Geschäftsdaten.
Bekannte externe Blocker dieses Piloten: die Live-Prüfung mit Shopify/Shopify Payments braucht einen autorisierten Shop (während des Builds stand keiner zur Verfügung); geprüft wurde nur der gebündelte synthetische Shop.
