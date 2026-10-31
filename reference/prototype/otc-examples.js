// Agent ideas grouped by the decision they support, not by department.
const otcExamples = [
  {
    id:'order', number:'01', label:'Auftrag', title:'Auftrag & Verfügbarkeit', agent:'Auftragscheck', team:'Sales · Operations', icon:'box',
    benefit:'Realistische Zusagen geben und Überverkäufe früher erkennen.',
    scope:'Was können wir dem Kunden verbindlich zusagen?',
    tracks:['fact','commitment','reservation'], sources:'Shopify / Shopware · Bestandsdaten · Zusagen',
    questions:[
      {q:'Kann ich noch 100 Olive Cups verkaufen?', method:'Physischen Bestand um offene Reservierungen reduzieren. Zugesagte Zugänge separat zeigen, bis ein tatsächlicher Wareneingang vorliegt.', need:'Artikel-ID, Bestandsstand, aktive Reservierungen und offene Lieferzusagen.', result:'Verfügbare Menge, Fehlmenge und Belege zum aktuellen Stand.', demo:'inventory'},
      {q:'Welche offenen Aufträge sind vollständig aus verfügbarem Bestand erfüllbar?', method:'Jede offene Position gegen Bestand und bereits zugeteilte Reservierungen prüfen. Dieselben Stücke nur einem Auftrag zuordnen.', need:'Offene Auftragspositionen, Reservierungszuordnung und aktuelle Bestände je Lager.', result:'Liste: vollständig erfüllbar, teilweise erfüllbar oder blockiert – mit Grund.'},
      {q:'Bei welchen Aufträgen passt die zugesagte Menge nicht zur Reservierung?', method:'Aktuelle Auftragsmenge und aktive Reservierung je Position vergleichen. Stornierte oder ausgelieferte Mengen berücksichtigen.', need:'Auftragsänderungen, Positionen, Reservierungen, Stornos und gebuchte Auslieferungen.', result:'Abweichung je Auftrag und Position, mit fehlender oder überzähliger Menge.'},
      {q:'Welche offenen Aufträge werden von einer verschobenen Warenankunft betroffen?', method:'Die geänderte Zugangszusage über Artikel und Zuteilung mit offenen Kundenaufträgen verbinden. Fehlende Zuteilungen als ungeklärte Betroffenheit markieren.', need:'Versionierte Zugangszusage, Artikel-Zuordnung, Auftragszuteilung und Kundentermine.', result:'Betroffene Aufträge und gefährdete Zusagen zur manuellen Prüfung.'}
    ]
  },
  {
    id:'delivery', number:'02', label:'Lieferung', title:'Lieferung & Kundeninformation', agent:'Lieferbegleiter', team:'Customer Success · Operations', icon:'truck',
    benefit:'Lieferprobleme früher sehen und Kunden mit belegbaren Angaben helfen.',
    scope:'Was passiert mit der Ware auf dem Weg zum Kunden?',
    tracks:['source','fact','commitment','movement'], sources:'Shop · DHL / DPD / UPS · Kundenkommunikation',
    questions:[
      {q:'Wo sind meine Pakete – und welche brauchen Aufmerksamkeit?', method:'Den letzten Carrier-Status mit Auftrag, Scan-Zeit und gemeldeter Prognose zusammenführen. Alte Scans bleiben in der Historie sichtbar.', need:'Auftrag-Sendung-Zuordnung, Carrier-Scans und vorhandene Zustellprognosen.', result:'Sendungsübersicht mit letztem bekannten Status und Auffälligkeiten.', demo:'tracking'},
      {q:'Welche Lieferzusagen an Kunden sind überschritten oder gefährdet?', method:'Kundenzusage und tatsächlichen Versand- bzw. Zustellstatus vergleichen. Eine Carrier-Prognose als Schätzung ausweisen.', need:'Explizite Kundenzusage, Zeitzone, Sendungsstatus und ggf. Carrier-Prognose.', result:'Priorisierte Fälle mit zugesagtem Termin, aktuellem Stand und Begründung.'},
      {q:'Bei welchen Teillieferungen fehlt noch Ware?', method:'Bestellte Mengen je Position den bestätigten Teillieferungen gegenüberstellen. Stornierte Positionen und reine Versandlabels gesondert behandeln.', need:'Auftragspositionen, Teillieferungen, enthaltene Mengen und Übergabe-/Zustellereignisse.', result:'Offene Restmengen je Auftrag sowie die zugehörigen Sendungen.'},
      {q:'Was kann ich diesem Kunden zum Lieferstatus verlässlich antworten?', method:'Auftrag, letzte Scans und bereits gemachte Zusagen in einen Antwortentwurf überführen. Unbekannte Ankunftstermine ausdrücklich offenlassen.', need:'Kunden-Auftrags-Zuordnung, Carrier-Verlauf und bisherige Kommunikation.', result:'Kundenfreundlicher Antwortentwurf mit internen Belegen; Versand bleibt ein eigener Schritt.'}
    ]
  },
  {
    id:'invoice', number:'03', label:'Rechnung', title:'Rechnung & Forderung', agent:'Rechnungsprüfer', team:'Finance · Backoffice', icon:'list',
    benefit:'Beleglücken finden und den aktuellen Forderungsstand nachvollziehen.',
    scope:'Was wurde dem Kunden in Rechnung gestellt?',
    tracks:['source','fact','commitment'], sources:'Shop · Rechnungstool · Belegzuordnung',
    questions:[
      {q:'Welche Rechnungen sind noch offen?', method:'Je Rechnung den aktuellen Stand aus Originalbetrag, Korrekturen und gemeldeten Zahlungen bilden. Ersetzte Stände nicht erneut summieren.', need:'Rechnung, Korrekturbelege, gemeldeter Zahlungsstand und Fälligkeit.', result:'Offene Beträge und Fälligkeiten mit Belegkette; Zahlungsmarkierungen sind noch kein Banknachweis.', demo:'billing'},
      {q:'Für welche Aufträge fehlt nach unserer Regel noch eine Rechnung?', method:'Aufträge anhand der hinterlegten Fakturierungsregel prüfen, zum Beispiel nach Versand. Zugeordnete Rechnungen und Stornos abgleichen.', need:'Fakturierungsregel, Auftrags-/Lieferstatus, Rechnungszuordnung und vollständiger Importstand.', result:'Prüfliste potenziell fehlender Rechnungen; bei Datenlücken bleibt der Status unbekannt.'},
      {q:'Wo weicht der Rechnungsbetrag vom vereinbarten Auftragsbetrag ab?', method:'Positionen, Mengen, Rabatte, Versandkosten, Währung und ausgewiesene Steuern vergleichen. Teilrechnungen berücksichtigen.', need:'Versionierter Auftrag und Rechnungspositionen einschließlich Teilrechnungsbezug.', result:'Betragsdifferenz je Position und eine nachvollziehbare Erklärung des Abgleichs.'},
      {q:'Welche Rechnungen wurden erstellt, aber noch nicht nachweislich versendet?', method:'Erstellte Belege mit dem Versandereignis des Rechnungstools verbinden. Ohne vollständige Versanddaten nur fehlenden Nachweis melden.', need:'Rechnungs-ID, Erstellzeit, Versandstatus und Zeitpunkt der letzten Synchronisierung.', result:'Liste der Belege ohne Versandnachweis – mit Datenstand statt pauschalem Versandurteil.'}
    ]
  },
  {
    id:'collection', number:'04', label:'Kundenzahlung', title:'Kundenzahlung & Klärung', agent:'Zahlungsklärer', team:'Finance · Customer Success', icon:'check',
    benefit:'Zahlungsprobleme gezielt klären und unnötige Zahlungserinnerungen vermeiden.',
    scope:'Hat der Kunde seine Zahlung geleistet?',
    tracks:['fact','commitment','movement'], sources:'Shop / Rechnung · Payment-Provider · Zahlungsbelege',
    questions:[
      {q:'Welche Aufträge sind nur autorisiert, tatsächlich bezahlt oder noch ausstehend?', method:'Autorisierung, erfolgreichen Einzug und fehlgeschlagene Versuche getrennt lesen. Auftragsstatus und Transaktionsstatus nebeneinander zeigen.', need:'Auftrags-ID, eindeutige Transaktionsreferenz, Betrag, Währung und letzter Zahlungsstatus.', result:'Zahlungsstatus je Auftrag mit Beleg; eine Autorisierung zählt nicht als Einzug.'},
      {q:'Welche fehlgeschlagenen Zahlungen wurden inzwischen erfolgreich nachgeholt?', method:'Alle Versuche desselben Auftrags zeitlich ordnen. Einen späteren Erfolg berücksichtigen, ohne den Fehler aus der Historie zu entfernen.', need:'Zahlungsversuche mit gemeinsamer Auftragsreferenz und bestätigtem Einzugsbetrag.', result:'Noch offene Zahlungsprobleme getrennt von bereits gelösten Fällen.'},
      {q:'Bei welchen Rechnungen passen Teilzahlungen und Restbetrag nicht zusammen?', method:'Zugeordnete Kundenzahlungen und Korrekturbelege gegen die Forderung rechnen. Provider-Gebühren nicht dem Kunden als Fehlbetrag anlasten.', need:'Rechnung, Zahlungszuordnungen, Bruttobeträge, Währungen und Korrekturbelege.', result:'Restbetrag oder Überzahlung mit Rechenweg; unzugeordnete Zahlungen separat.'},
      {q:'Welche fälligen Forderungen sollte Finance heute prüfen?', method:'Nach Fälligkeit und offenem Betrag priorisieren. Gemeldete Zahlungen, laufende Klärungen und vereinbarte Fristen berücksichtigen.', need:'Forderungsstand, Fälligkeit, Zahlungseingänge, Klärungsstatus und geltende Erinnerungsregeln.', result:'Belegte Prüfliste mit Gründen und offenen Fragen. Keine automatische Mahnung.'}
    ]
  },
  {
    id:'settlement', number:'05', label:'Auszahlung', title:'Auszahlung & Bankabgleich', agent:'Cash-Abgleich', team:'Finance · Founder', icon:'arrow',
    benefit:'Verstehen, wo das Geld liegt und welche Differenzen noch zu klären sind.',
    scope:'Ist das eingezogene Geld auf unserem Bankkonto angekommen?',
    tracks:['fact','movement','reservation','commitment'], sources:'Payment-Provider · Auszahlungsbericht · Bankbeleg',
    questions:[
      {q:'Wo steckt mein Geld bei den Payment-Providern?', method:'In Abwicklung, verfügbar, gebunden, unterwegs und per Bankbeleg bestätigt getrennt ausweisen. Je Provider nur den aktuellen Stand zählen.', need:'Transaktionen, Gebühren, Einbehalte, Erstattungen, Auszahlungen und separate Bankbelege.', result:'Belegte Geldpositionen je Provider. Eine Auszahlung ist kein neuer Umsatz.', demo:'payments'},
      {q:'Warum ist die Auszahlung niedriger als die eingezogenen Kundenzahlungen?', method:'Die im Auszahlungsbericht enthaltenen Transaktionen aufschlüsseln: Einzüge minus Gebühren, Erstattungen und weitere belegte Abzüge.', need:'Auszahlungsreferenz und vollständige Liste der enthaltenen Transaktionen und Anpassungen.', result:'Überleitung vom Brutto zum Netto; eine verbleibende Differenz wird als ungeklärt ausgewiesen.'},
      {q:'Welche angekündigten oder abgegangenen Auszahlungen haben noch keinen Banknachweis?', method:'Ankündigung und tatsächlichen Abgang unterscheiden. Abgegangene Beträge über Referenz, Betrag und Währung mit Bankbuchungen abgleichen.', need:'Auszahlungsstatus, Referenz, Betrag, Währung, Bankbuchungen und deren Importstand.', result:'Ausstehende Nachweise mit Alter und Datenstand; ohne Bankdaten kein Urteil über den Eingang.'},
      {q:'Welche Beträge sind einbehalten und welche Freigabe ist nur angekündigt?', method:'Aktive Einbehalte und offene Freigabezusagen getrennt von tatsächlichen Freigaben zeigen. Historische Einbehalte nicht addieren.', need:'Provider-Salden, Einbehaltsgrund, Statuswechsel und vorhandene Freigabetermine.', result:'Gebundene Beträge nach Provider und Grund; erwartete Termine ausdrücklich als Zusage.'}
    ]
  },
  {
    id:'reversal', number:'06', label:'Rückabwicklung', title:'Storno, Retoure & Erstattung', agent:'Retourenbegleiter', team:'Customer Success · Finance', icon:'refresh',
    benefit:'Offene Rückabwicklungen schließen und doppelte Erstattungen vermeiden.',
    scope:'Was muss nach einem Storno oder einer Rückgabe noch passieren?',
    tracks:['fact','commitment','movement','reservation'], sources:'Shop / Retourensystem · Rechnungstool · Provider',
    questions:[
      {q:'Welche Rückgaben sind angekündigt, eingegangen oder bereits erstattet?', method:'Rückgabeanfrage, tatsächlichen Wareneingang, Belegkorrektur und Geldrückfluss als eigenständige Schritte lesen.', need:'Retouren-ID, Auftragspositionen, Rücksendestatus, Wareneingang und Erstattungsreferenz.', result:'Stand je Retoure mit dem nächsten ungeklärten Schritt. Eine Ankündigung bestätigt keinen Wareneingang.'},
      {q:'Bei welchen Gutschriften fehlt die zugehörige Erstattung?', method:'Gutschriften mit dem ursprünglichen Zahlungsstand und Erstattungen verbinden. Offene Forderungen können durch Gutschrift sinken, ohne Geld zurückzuzahlen.', need:'Gutschrift, ursprüngliche Kundenzahlung, Erstattungsanspruch und Provider-Nachweis.', result:'Nur tatsächlich offene Erstattungsfälle – getrennt von reinen Forderungskorrekturen.'},
      {q:'Was muss nach einem Storno bei Bestand, Rechnung und Zahlung noch korrigiert werden?', method:'Den Storno mit Reservierungsfreigabe, Belegkorrektur und Zahlungsrückabwicklung abgleichen. Bereits erledigte Schritte erkennen.', need:'Stornoereignis, Reservierungsverlauf, Rechnungsbelege und Zahlungs-/Erstattungsstatus.', result:'Checkliste offener Schritte je Auftrag mit Belegen; keine automatische Buchung.'},
      {q:'Droht eine doppelte Rückzahlung durch Erstattung und Chargeback?', method:'Rückzahlungen und vom Provider tatsächlich gebuchte Rückbelastungen auf dieselbe Ursprungstransaktion beziehen. Offene Streitfälle getrennt behandeln.', need:'Ursprungstransaktion, Erstattungs-IDs, Chargeback-Buchungen, Beträge und Status.', result:'Verdachtsfälle zur Prüfung mit Betragsvergleich. Ein offener Streitfall allein ist noch keine Rückzahlung.'}
    ]
  }
];
let otcFilter='all';
function otcExampleCard(group){
  return `<article class="otc-card" data-otc-group="${group.id}" ${otcFilter!=='all'&&otcFilter!==group.id?'hidden':''}>
    <div class="otc-card-top"><span class="otc-step">${group.number}</span><span class="otc-team">${group.team}</span>${icon(group.icon)}</div>
    <h3>${group.title}</h3><p class="otc-scope">${group.scope}</p>
    <div class="otc-benefit"><span>MÖGLICHER AGENT · ${group.agent.toUpperCase()}</span><p>${group.benefit}</p></div>
    <div class="otc-questions">${group.questions.map((question,i)=>`<details class="otc-question"><summary><span>${question.q}</span>${icon('plus')}</summary><div class="otc-question-body"><p>${question.method}</p><dl><div><dt>Benötigte Facts & Belege</dt><dd>${question.need}</dd></div><div><dt>Das bekommst du</dt><dd>${question.result}</dd></div></dl>${question.demo?`<button class="otc-demo-link" data-action="otc-demo" data-id="${question.demo}">${icon('play')}Demo-Antwort mit Belegen ansehen ${icon('arrow')}</button>`:'<p class="otc-data-note">Agenten-Idee · Mit den genannten Daten umsetzbar; keine vollständige Antwort in diesem Demo-Datensatz.</p>'}</div></details>`).join('')}</div>
    <div class="otc-evidence"><div>${group.tracks.map(id=>`<span style="${trackStyle(id)}">${trackById(id).label}</span>`).join('')}</div><p>${icon('plug')}${group.sources}</p></div>
  </article>`;
}
function otcExamplesSection(){
  return `<section class="otc-section" id="otc-examples" aria-labelledby="otc-title">
    <div class="otc-intro"><div><div class="eyebrow">VOM KONTEXT ZUM KONKRETEN NUTZEN</div><h2 id="otc-title">Ein Auftrag. Viele gute Fragen.</h2><p>Diese Agenten könntest du auf deinem Flugschreiber aufbauen. Wir starten mit Order to Cash: von der Auftragszusage bis zum Geld auf dem Konto – einschließlich Rückabwicklung.</p></div><div class="otc-counter"><strong>24</strong><span>FRAGEN<br>6 AUFGABEN</span></div></div>
    <div class="otc-journey"><span>${icon('box')}Auftrag</span>${icon('chevron')}<span>${icon('truck')}Lieferung</span>${icon('chevron')}<span>${icon('list')}Rechnung</span>${icon('chevron')}<span>${icon('check')}Kundenzahlung</span>${icon('chevron')}<span>${icon('arrow')}Auszahlung</span><span class="otc-loop">${icon('refresh')}Rückabwicklung</span></div>
    <p class="otc-grouping">Nach Aufgabe geordnet, für mehrere Teams nutzbar. Kundenzahlung und Bankeingang bleiben getrennt; Stornos, Retouren und Erstattungen sind in der Rückabwicklung gebündelt. Die Reihenfolge kann je Zahlungsart variieren.</p>
    <div class="otc-filterbar"><div class="otc-filters" role="group" aria-label="Order-to-Cash-Beispiele filtern"><button data-action="otc-filter" data-id="all" aria-pressed="${otcFilter==='all'}">Alle Fragen</button>${otcExamples.map(g=>`<button data-action="otc-filter" data-id="${g.id}" aria-pressed="${otcFilter===g.id}">${g.number} ${g.label}</button>`).join('')}</div><span class="otc-count" id="otc-count" role="status">${otcFilter==='all'?'24':'4'} Fragen</span></div>
    <div class="otc-grid">${otcExamples.map(otcExampleCard).join('')}</div>
    <div class="otc-start"><div>${icon('spark')}<h3>Stück für Stück zum eigenen Agenten.</h3></div><ol><li><span>1</span><p><strong>Eine Frage beantworten</strong>Mit Quellen, Datenstand und klar benannten Lücken.</p></li><li><span>2</span><p><strong>Eine Prüfliste erstellen</strong>Offene Fälle nach Betrag, Alter oder Dringlichkeit ordnen.</p></li><li><span>3</span><p><strong>Einen Entwurf vorbereiten</strong>Zum Beispiel eine Kundenantwort – zur Freigabe durch dein Team.</p></li></ol><p class="otc-start-note">Konzeptbeispiele für einen künftigen MCP-Zugang. Vier Fragen zeigen schon Antworten aus dem Demo-Datensatz. Für vollständige Abläufe müssen Auftrag, Beleg, Sendung und Zahlung über eindeutige IDs verknüpft sein. Fehlender Nachweis bedeutet „unbekannt“.</p></div>
  </section>`;
}
function filterOtcExamples(id){
  if(id!=='all'&&!otcExamples.some(group=>group.id===id))return;
  otcFilter=id;
  document.querySelectorAll('[data-otc-group]').forEach(card=>{card.hidden=id!=='all'&&card.dataset.otcGroup!==id;});
  document.querySelectorAll('[data-action="otc-filter"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.id===id)));
  const count=document.getElementById('otc-count');if(count)count.textContent=`${id==='all'?24:4} Fragen`;
}
function showOtcDemo(id){
  if(!['inventory','tracking','billing','payments'].includes(id))return;
  showOverlay(`${closeButton()}<div class="eyebrow otc-dialog-eyebrow">${icon('spark')}ORDER TO CASH · DEMO-ANTWORT</div>${answerHTML(id)}<div class="demo-callout">Diese Antwort nutzt den aktuellen Stand der Beispieldaten. Es wird kein externer Agent aufgerufen. Die Lager-, Versand-, Rechnungs- und Payment-Demos sind eigenständige Szenarien.</div>`);
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;if(button.dataset.action==='otc-jump')document.getElementById('otc-examples')?.scrollIntoView({behavior:'smooth',block:'start'});if(button.dataset.action==='otc-filter')filterOtcExamples(button.dataset.id);if(button.dataset.action==='otc-demo')showOtcDemo(button.dataset.id);});
