// Independent, fictional invoice scenarios. No vendor or banking APIs are called.
const billingSources = [
  {id:'lexware',category:'billing',name:'Lexware Office',short:'Lexware',subtitle:'Rechnungen und Buchhaltung',text:'Rechnungsbelege, Fälligkeiten und gemeldete Zahlungen zusammenführen. Jede Änderung bleibt beim ursprünglichen Beleg.',meta:'Rechnungen · Offene Posten · Zahlungsstatus'},
  {id:'sevdesk',category:'billing',name:'sevdesk',short:'sevdesk',subtitle:'Rechnungen und Buchhaltung',text:'Vom offenen Beleg bis zur Zahlung: Verfolge Rechnungen und Mahnungen mit Betrag, Fälligkeit und Quellenbezug.',meta:'Belege · Fälligkeiten · Mahnungen'},
  {id:'easybill',category:'billing',name:'easybill',short:'easybill',subtitle:'Rechnungen für den Onlinehandel',text:'Rechnungen und Rechnungskorrekturen mit dem Shop-Auftrag verknüpfen. Das Original bleibt auch nach einem Storno erhalten.',meta:'Rechnungen · Korrekturen · Stornos'},
  {id:'billbee',category:'billing',name:'Billbee',short:'Billbee',subtitle:'Auftragsabwicklung und Rechnungen',text:'Auftrag, Rechnungsbeleg und Gutschrift im selben Verlauf sehen. Belegänderungen bekommen einen nachvollziehbaren Kontext.',meta:'Aufträge · Rechnungen · Gutschriften'},
  {id:'sufio',category:'billing',name:'Sufio',short:'Sufio',subtitle:'Rechnungen für Shopify',text:'Shopify-Bestellungen mit ihren Rechnungen und Gutschriften verbinden – bis zum gemeldeten Versand- und Zahlungsstatus.',meta:'Shopify · Rechnungen · Belegversand'}
];
const invoiceDemo = [
  {id:'lexware',invoice:'DEMO-LX-2101',order:'#B-2101',shop:'Shopify',gross:119000,net:100000,tax:19000,due:'07.11.2026',overdue:false,index:0,history:[],steps:[
    {event:'invoice.issued',label:'Rechnung erstellt',message:'Die Rechnung wurde erstellt. Der Gesamtbetrag ist noch offen.',paid:0,credit:0,status:'Offen'},
    {event:'invoice.sent',label:'Rechnung versendet',message:'Das Rechnungstool meldet den Versand an den Kunden. Eine Zahlung ist noch nicht gemeldet.',paid:0,credit:0,status:'Offen'},
    {event:'payment.recorded',label:'Teilzahlung gemeldet',message:'Im Rechnungstool sind 595,00 € als Teilzahlung erfasst.',paid:59500,credit:0,status:'Teilbezahlt'},
    {event:'payment.recorded',label:'Vollständig bezahlt gemeldet',message:'Im Rechnungstool ist der gesamte Rechnungsbetrag als bezahlt erfasst.',paid:119000,credit:0,status:'Bezahlt gemeldet'}
  ]},
  {id:'sevdesk',invoice:'DEMO-SV-2102',order:'#B-2102',shop:'Shopware 6',gross:47600,net:40000,tax:7600,due:'26.10.2026',overdue:true,index:0,history:[],steps:[
    {event:'invoice.open',label:'Offene Rechnung importiert',message:'Der offene Rechnungsbetrag war am 26. Oktober fällig. Im Demo-Stand vom 31. Oktober ist er fünf Tage überfällig.',paid:0,credit:0,status:'Überfällig'},
    {event:'reminder.sent',label:'Mahnung versendet',message:'Das Rechnungstool meldet eine versendete Mahnung. Der offene Betrag bleibt unverändert.',paid:0,credit:0,status:'Gemahnt'},
    {event:'payment.recorded',label:'Vollständig bezahlt gemeldet',message:'Das Rechnungstool meldet die vollständige Zahlung von 476,00 €.',paid:47600,credit:0,status:'Bezahlt gemeldet'}
  ]},
  {id:'easybill',invoice:'DEMO-EB-2103',order:'#B-2103',shop:'Shopware 6',gross:23800,net:20000,tax:3800,due:'07.11.2026',overdue:false,index:0,history:[],steps:[
    {event:'invoice.issued',label:'Rechnung erstellt',message:'Die ursprüngliche Rechnung über 238,00 € ist offen.',paid:0,credit:0,status:'Offen'},
    {event:'credit_note.issued',label:'Rechnungskorrektur erstellt',message:'Ein neuer Korrekturbeleg über 119,00 € reduziert die offene Forderung. Die Originalrechnung bleibt erhalten.',paid:0,credit:11900,status:'Teilweise korrigiert',document:'DEMO-EB-K1'},
    {event:'invoice.cancelled',label:'Restbetrag storniert',message:'Ein weiterer Korrekturbeleg über 119,00 € gleicht den verbleibenden Betrag aus. Es wurde keine Zahlung gemeldet.',paid:0,credit:23800,status:'Storniert',document:'DEMO-EB-K2'}
  ]},
  {id:'billbee',invoice:'DEMO-BB-2104',order:'#B-2104',shop:'Shopify',gross:11900,net:10000,tax:1900,due:'05.11.2026',overdue:false,index:0,history:[],steps:[
    {event:'invoice.issued',label:'Rechnung erstellt',message:'Der Auftrag ist mit einer offenen Rechnung über 119,00 € verknüpft.',paid:0,credit:0,status:'Offen'},
    {event:'credit_note.issued',label:'Gutschrift erstellt',message:'Eine Gutschrift über 29,75 € ist dem Auftrag zugeordnet. Sie reduziert die offene Forderung; eine Auszahlung wurde nicht gemeldet.',paid:0,credit:2975,status:'Teilweise gutgeschrieben',document:'DEMO-BB-G1'},
    {event:'payment.recorded',label:'Restbetrag bezahlt gemeldet',message:'Der verbleibende Betrag von 89,25 € ist im Tool als bezahlt erfasst.',paid:8925,credit:2975,status:'Bezahlt gemeldet'}
  ]},
  {id:'sufio',invoice:'DEMO-SF-2105',order:'#B-2105',shop:'Shopify',gross:17850,net:15000,tax:2850,due:'07.11.2026',overdue:false,index:0,history:[],steps:[
    {event:'invoice.issued',label:'Rechnung erstellt',message:'Die Rechnung ist mit der Shopify-Bestellung verknüpft.',paid:0,credit:0,status:'Offen'},
    {event:'invoice.sent',label:'Rechnung versendet',message:'Der Versand der Rechnung an den Kunden ist im Demo-Verlauf erfasst.',paid:0,credit:0,status:'Offen'},
    {event:'payment.recorded',label:'Vollständig bezahlt gemeldet',message:'Der gesamte Rechnungsbetrag ist im Tool als bezahlt erfasst.',paid:17850,credit:0,status:'Bezahlt gemeldet'}
  ]}
];
const invoiceMoney = cents => (cents/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const latestInvoice = invoice => invoice.history.at(-1);
function appendInvoiceObservation(invoice,step,time){
  const vendor=billingSources.find(s=>s.id===invoice.id);
  const n=String(invoice.history.length+1).padStart(3,'0');
  const prefix=`BILL-${invoice.id.toUpperCase()}-${n}`;
  const previous=latestInvoice(invoice);
  const observation={...step,time,sourceId:`SRC-${prefix}`,factId:`FAC-${prefix}`,commitmentId:`COM-${prefix}`,open:invoice.gross-step.credit-step.paid};
  const relatedBase=[invoice.orderEvent,...(previous?[previous.factId]:[])];
  const raw={demo:true,schema:'blackbox.demo.billing.v1',provider:vendor.name,event:step.event,invoice_ref:invoice.invoice,document_ref:step.document||invoice.invoice,order_ref:invoice.order,currency:'EUR',original_net_cents:invoice.net,original_tax_cents:invoice.tax,original_gross_cents:invoice.gross,reported_paid_total_cents:step.paid,credit_total_cents:step.credit,due_date:invoice.due,status:step.status,observed_at:`2026-10-31T${time}+01:00`};
  events.push({id:observation.sourceId,type:'source',title:`${vendor.short} · ${step.label}`,source:vendor.name,time,entity:invoice.invoice,detail:`${step.message} Zugeordnet zu ${invoice.shop} ${invoice.order}.`,quote:JSON.stringify(raw,null,2),related:[observation.factId,...relatedBase],proof:'Schema-neutrale Demo-Meldung · kein echter API-Payload'});
  events.push({id:observation.factId,type:'fact',title:`${invoice.invoice} · ${invoiceMoney(observation.open)} offen`,source:vendor.name,time,entity:`${invoice.invoice} · ${invoice.order}`,detail:`${step.message} Offener Betrag laut Rechnungsdaten: ${invoiceMoney(observation.open)}. Der Zahlungsstatus ist nicht mit einem Bankbeleg abgeglichen.`,quote:`Original brutto ${invoiceMoney(invoice.gross)} − Korrekturen/Gutschriften ${invoiceMoney(step.credit)} − im Tool als bezahlt erfasst ${invoiceMoney(step.paid)} = ${invoiceMoney(observation.open)} offen. Fällig: ${invoice.due}.`,related:[observation.sourceId,observation.commitmentId,...relatedBase],proof:'Aus Rechnungsbeleg und aktuellem Tool-Status abgeleitet'});
  events.push({id:observation.commitmentId,type:'commitment',title:`${invoice.invoice} · Forderung ${invoiceMoney(observation.open)}`,source:vendor.name,time,entity:invoice.invoice,status:observation.open>0?'Offen':'Ausgeglichen laut Tool',detail:`Stand der Kundenforderung: ${invoiceMoney(observation.open)}, fällig am ${invoice.due}. ${previous?'Dieser Stand löst '+previous.commitmentId+' ab; die ursprüngliche Aufzeichnung bleibt erhalten. ':''}Kein gebuchter Bankeingang und keine Änderung am separaten Cash-Demo-Snapshot.`,quote:`Beleg ${invoice.invoice} · offener Betrag ${invoiceMoney(observation.open)} · Status ${step.status}`,related:[observation.sourceId,observation.factId,...(previous?[previous.commitmentId]:[])],proof:'Versionierter Forderungsstand · Demo'});
  invoice.history.push(observation);
  return observation;
}
function seedInvoices(){
  invoiceDemo.forEach((invoice,i)=>{
    invoice.orderEvent=`SRC-BILL-ORDER-${i+1}`;
    events.push({id:invoice.orderEvent,type:'source',title:`${invoice.shop} · Auftrag ${invoice.order}`,source:invoice.shop,time:`10:41:${30+i*4}`,entity:invoice.order,detail:'Eigenständiger fiktiver Auftrag für diese Rechnungsdemo. Die fünf Rechnungen gehören zu fünf verschiedenen Aufträgen und werden nicht mit dem ursprünglichen Cash-Szenario verrechnet.',quote:`Auftrag ${invoice.order}\nRechnung ${invoice.invoice}\nBrutto ${invoiceMoney(invoice.gross)}\nWährung EUR`,related:[],proof:'Shop-Auftragsauszug · Rechnungsdemo'});
    const first=appendInvoiceObservation(invoice,invoice.steps[0],`10:41:${31+i*4}`);
    events.find(e=>e.id===invoice.orderEvent).related=[first.sourceId,first.factId];
  });
  events.sort((a,b)=>a.time.localeCompare(b.time));
}
function invoiceTotals(){return invoiceDemo.reduce((total,invoice)=>{const last=latestInvoice(invoice);total.open+=last.open;total.paid+=last.paid;total.credit+=last.credit;if(last.open>0){total.count++;if(invoice.overdue)total.overdue+=last.open;}return total},{open:0,paid:0,credit:0,count:0,overdue:0})}
function billingAnswer(){
  const totals=invoiceTotals();
  return {type:'billing',title:totals.open?`${invoiceMoney(totals.open)} sind noch offen.`:'Alle fünf Demo-Rechnungen sind ausgeglichen.',text:invoiceDemo.map(invoice=>`${billingSources.find(s=>s.id===invoice.id).name}: ${invoiceMoney(latestInvoice(invoice).open)} offen (${invoice.invoice}, ${latestInvoice(invoice).status.toLowerCase()}).`).join(' '),math:[[invoiceMoney(totals.open),'offene Forderungen'],['',''],[invoiceMoney(totals.overdue),'davon überfällig'],['',''],[invoiceMoney(totals.credit),'Korrekturen / Gutschriften']],note:'Fünf eigenständige Demo-Aufträge. Es zählt nur der letzte Stand je Rechnung. Als bezahlt erfasste Beträge sind keine hier bestätigten Bankbewegungen. Diese Rechnungsdemo ist getrennt vom Cash-Szenario.',refs:invoiceDemo.map(invoice=>latestInvoice(invoice).factId),question:'Welche Rechnungen sind noch offen?'};
}
function invoiceDetail(id){
  const invoice=invoiceDemo.find(invoice=>invoice.id===id);if(!invoice)return;
  const vendor=billingSources.find(s=>s.id===id),last=latestInvoice(invoice),connected=state.sources.includes(id),done=invoice.index===invoice.steps.length-1;
  showOverlay(`${closeButton()}<div class="eyebrow">${icon('list')}RECHNUNGSVERLAUF · DEMO</div><div class="billing-detail-heading">${sourceIcon(id)}<div><h2>${vendor.name}</h2><p>${invoice.invoice} · ${invoice.shop} ${invoice.order}</p></div></div><div class="billing-balance"><span>Aktuell offen</span><strong>${invoiceMoney(last.open)}</strong><small>${last.status} · Fällig ${invoice.due}</small></div><dl class="detail-meta"><div><dt>Originalbetrag netto</dt><dd>${invoiceMoney(invoice.net)}</dd></div><div><dt>Umsatzsteuer im Demo-Beleg</dt><dd>${invoiceMoney(invoice.tax)} · 19 %</dd></div><div><dt>Originalbetrag brutto</dt><dd>${invoiceMoney(invoice.gross)}</dd></div><div><dt>Korrekturen / Gutschriften</dt><dd>${invoiceMoney(last.credit)}</dd></div><div><dt>Laut Tool bezahlt</dt><dd>${invoiceMoney(last.paid)}</dd></div></dl><div class="billing-demo-controls">${connected?`<button class="btn primary full" data-action="billing-next" data-id="${id}" ${done?'disabled':''}>${icon('play')}${done?'Demo-Verlauf abgeschlossen':'Nächstes Rechnungsereignis simulieren'}</button>${!done?`<p>Als Nächstes: ${invoice.steps[invoice.index+1].label}</p>`:''}`:`<button class="btn primary full" data-action="billing-activate" data-id="${id}">${icon('plus')}Demo-Quelle aktivieren</button><p>Danach kannst du den Rechnungsverlauf Schritt für Schritt durchspielen.</p>`}</div><div class="eyebrow" style="font-size:9px">VERLAUF · NEUESTE ZUERST</div><div class="shipment-history">${invoice.history.slice().reverse().map(observation=>`<div class="shipment-history-row"><i class="status-dot"></i><div><time>31.10. · ${observation.time} CET</time><h3>${observation.label}</h3><p>${observation.message}</p><div class="billing-history-balance">${invoiceMoney(observation.open)} zu diesem Zeitpunkt offen</div><button class="citation-btn" data-action="event" data-id="${observation.sourceId}">Originalmeldung ${icon('arrow')}</button><button class="citation-btn" data-action="event" data-id="${observation.factId}">Abgeleiteter Fact ${icon('arrow')}</button><button class="citation-btn" data-action="event" data-id="${observation.commitmentId}">Forderungsstand ${icon('arrow')}</button></div></div>`).join('')}</div><button class="detail-link" data-action="event" data-id="${invoice.orderEvent}">Shop-Auftrag ${invoice.order} ${icon('arrow')}</button><div class="demo-callout">Simulierter Verlauf. Änderungen ergänzen die Historie. Zahlungsmarkierungen und Gutschriften bestätigen keinen Geldfluss. Keine echte Verbindung zu ${vendor.name}.</div>`,true);
}
function billingConnectionModal(source){
  const connected=state.sources.includes(source.id);
  showOverlay(`${closeButton()}<div style="margin-bottom:22px">${sourceIcon(source.id)}</div><h2>${source.name} ${connected?'verwalten.':'verbinden.'}</h2><p>${source.text}</p><div class="flow-summary"><div>${icon('list')}<span>Belege und Änderungen aufzeichnen<small>Rechnung · Versand · Korrektur · Gutschrift · Storno</small></span></div><div>${icon('clock')}<span>Forderungen nachverfolgen<small>Brutto / Netto · Fälligkeit · Mahnung · Zahlungsstatus</small></span></div><div>${icon('link')}<span>Mit dem Auftrag verbinden<small>Originalbeleg → Fact → aktueller Forderungsstand</small></span></div></div><div class="demo-callout">Die Demo zeigt ausgewählte Ereignisse. Im Live-Betrieb hängt die verfügbare Abdeckung von Schnittstelle, Tarif und Berechtigungen ab. Es werden keine Zugangsdaten abgefragt.</div><button class="btn primary full" data-action="${connected?'billing-detail':'billing-activate'}" data-id="${source.id}">${icon('play')}${connected?'Rechnungsverlauf ausprobieren':'Demo aktivieren & Verlauf öffnen'}</button>${connected?`<button class="btn secondary full billing-disconnect" data-action="toggle-source" data-id="${source.id}">Demo-Quelle trennen</button>`:''}`);
}
function advanceInvoice(id){
  const invoice=invoiceDemo.find(invoice=>invoice.id===id);if(!invoice||!state.sources.includes(id)||invoice.index===invoice.steps.length-1)return;
  state.elapsed++;invoice.index++;
  appendInvoiceObservation(invoice,invoice.steps[invoice.index],currentTime());
  if(state.page==='app')document.getElementById('app-content').innerHTML=renderTab();
  invoiceDetail(id);toast('Originalmeldung, Fact und Forderungsstand aufgezeichnet.');
}
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');if(!action)return;
  const id=action.dataset.id;
  if(action.dataset.action==='billing-detail')invoiceDetail(id);
  if(action.dataset.action==='billing-next')advanceInvoice(id);
  if(action.dataset.action==='billing-activate'){
    if(!billingSources.some(s=>s.id===id))return;
    if(!state.sources.includes(id))state.sources.push(id);
    persist();if(state.page==='app')renderApp();invoiceDetail(id);toast('Rechnungsquelle für die Demo aktiviert.');
  }
  if(action.dataset.action==='billing-question'){state.answer='billing';navigate('answers');}
});
