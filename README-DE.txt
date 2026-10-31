BLACKBOX — STARTPAKET FÜR ZWEI UNABHÄNGIGE CODE-AGENTEN
Stand: 31.10.2026

Dieses Paket enthält den Bauauftrag, vorgeschlagene Architektur, Abnahmekriterien und die aktuelle Designvorlage. Es enthält noch keine neue Produktionssoftware.

SO BENUTZT DU ES
1. Lege zwei getrennte, private Repositories oder Arbeitsverzeichnisse an: blackbox-agent-a und blackbox-agent-b. Keine gemeinsame beschreibbare Datenbank und keine gemeinsam verwendeten Entwicklungsgeheimnisse.
2. Gib beiden exakt dieses ZIP als Referenz und denselben Inhalt aus BUILD-PROMPT-EN.txt. Die Umsetzungssprache des Auftrags ist Englisch; das Produkt soll Englisch als Standard und Deutsch vollständig unterstützen.
3. Gib beiden dieselben Umgebungsbedingungen und denselben Umfang an Testzugängen. Für den ersten Vergleich sind echte Geschäftsdaten und kostenpflichtige APIs nicht nötig: der Golden Scenario muss offline mit synthetischen Ereignissen durchlaufen.
4. Lass beide bis zum ersten gemeinsamen Prüfpunkt bauen: M0–M3 plus lokale Installation. Der vollständige Auftrag enthält danach reale Anbindungen und Betriebshärtung. Du kannst für einen kürzeren Vergleich ausdrücklich den Stopp nach diesem Prüfpunkt ergänzen.
5. Lass die Ergebnisse aus einem frischen Checkout installieren. Prüfe die Abnahmekriterien unabhängig; die Selbstauskunft des jeweiligen Agenten genügt nicht. Variiere Beträge, IDs, Reihenfolge, fehlende Belege und zwei Mandanten.
6. Lass nach Abschluss die Implementierungen gegenseitig und durch einen unabhängigen technischen Reviewer prüfen. Wähle eine Grundlage aus. Übernimm gezielt Verbesserungen statt beide Repositories automatisch zu verschmelzen.

KURZER STARTPROMPT
GO. Implementiere den beiliegenden BUILD-PROMPT-EN.txt in diesem Repository. Nutze die mitgelieferte Designvorlage. Arbeite die Meilensteine selbstständig ab und liefere ausführbare Software, Tests, Docker-Installation und Abnahmebericht. Dokumentiere fehlende externe Zugänge getrennt; behaupte keine ungeprüften Integrationen. Routineentscheidungen triffst du selbst. Frage nur bei wirklich blockierenden Produktentscheidungen oder nötigen externen Freigaben.

INHALT
BUILD-PROMPT-EN.txt          Vollständiger, agentenunabhängiger Bauauftrag
ARCHITECTURE-DE.txt          Architektur, Betriebsarten und Vorgehensvorschlag
REVIEW-PROMPT-EN.txt         Auftrag für unabhängige Prüfung nach der Umsetzung
ACCEPTANCE.json             Verbindliche Abnahmefälle und Vergleichsregeln
GOLDEN-ORDER-TO-CASH.json     Synthetischer End-to-End-Fall mit erwarteten Zuständen
SCORECARD.json               Gewichtung für den unabhängigen Vergleich
reference/prototype/        Aktueller HTML/CSS/JS-Prototyp ohne Hosting-Metadaten
reference/screenshots/      Aktuelle Referenzansichten
reference/questions.json   Die 24 Order-to-Cash-Fragen mit benötigten Daten
reference/manifest.json    Herkunft und Umfang der Designvorlage
templates/                  Vorlagen für AGENTS.md und neue Feature-Ideen

WICHTIG
- Die JSON-Abnahmefälle sind Spezifikationen, noch keine lauffähige Testsuite. Die Agenten müssen sie in ausführbare Tests übertragen.
- Die aufgeführten ./blackbox-Kommandos sind ein zu implementierendes Bedienziel.
- „Auf meinem Mac getestet“, „Docker für ARM gebaut“ und „in CI emuliert“ sind verschiedene Nachweise.
- Shopify, Shopify Payments, easybill und DHL sind die vorgeschlagene erste Live-Auswahl, keine Behauptung über bereits vorhandene Zugänge.
- Fehlender Provider-Zugang darf übrige Arbeit nicht aufhalten, verhindert aber das Prädikat „live geprüft“.
- Keine automatische Veröffentlichung, Kontoerstellung, Zahlung oder Nutzung echter Kundendaten ist durch dieses Referenzpaket autorisiert.
- SaaS-Abonnementabrechnung deiner eigenen Software ist von den Händlerzahlungen im Flugschreiber getrennt; sie ist eine spätere kommerzielle Entscheidung.
