// Fictional shipments and normalized statuses. No carrier APIs are called.
const shipmentSources = [
  {id:'shopware',category:'shop',name:'Shopware 6',short:'Shopware 6',subtitle:'Bestellungen, Lieferungen, Sendungsnummern',text:'Verbinde Shopware-Aufträge mit Lieferungen und Sendungsnummern. Carrier-Scans ergänzen den tatsächlichen Transportverlauf.',meta:'Aufträge · Lieferungen · Tracking-Zuordnung'},
  {id:'dhl',category:'tracking',name:'DHL',short:'DHL',subtitle:'Sendungsstatus und Tracking-Ereignisse',text:'Vom ersten Scan bis zur gemeldeten Zustellung: Jeder neue Status bekommt einen Zeitpunkt und einen Bezug zum Auftrag.',meta:'Scans · Status · Zustellprognose'},
  {id:'dpd',category:'tracking',name:'DPD',short:'DPD',subtitle:'Zustellversuche und Abweichungen',text:'Erkenne Zustellhindernisse und Änderungen im Sendungsverlauf. Die Originalmeldung bleibt hinter jedem Fact erhalten.',meta:'Verlauf · Zustellversuche · Abweichungen'},
  {id:'ups',category:'tracking',name:'UPS',short:'UPS',subtitle:'Transportverlauf und Zustellmeldungen',text:'Führe Paketstatus, letzte Scans und Zustellmeldungen mit dem Shop-Auftrag in einem gemeinsamen Verlauf zusammen.',meta:'Transport · Scan-Zeit · Zustellstatus'}
];
const shipmentDemo = [
  {id:'dhl',carrier:'DHL',shop:'Shopware 6',order:'#SW-2001',tracking:'DEMO-DHL-2001',orderEvent:'SRC-SW-2001',item:'2 × Tea Bowl Sand',index:0,history:[],steps:[
    {status:'in_transit',label:'Unterwegs',place:'Paketzentrum Hamburg',message:'Die Sendung wurde im Paketzentrum bearbeitet.',scan:'09:58:00',eta:null},
    {status:'out_for_delivery',label:'In Zustellung',place:'Zustelltour Hamburg',message:'Die Sendung wurde in das Zustellfahrzeug geladen.',eta:'31.10. · 13–18 Uhr'},
    {status:'delivered',label:'Zustellung gemeldet',place:'Hamburg',message:'Der Carrier meldet die Sendung als zugestellt.',eta:null}
  ]},
  {id:'dpd',carrier:'DPD',shop:'Shopify',order:'#1036',tracking:'DEMO-DPD-1036',orderEvent:'SRC-SHOP-1036',item:'1 × Tea Bowl Sand',index:0,history:[],steps:[
    {status:'exception',label:'Klärung erforderlich',place:'Depot Berlin',message:'Zustellung nicht möglich. Die Empfängeradresse wird geprüft.',scan:'10:05:00',eta:null},
    {status:'out_for_delivery',label:'Erneut in Zustellung',place:'Zustelltour Berlin',message:'Die Adressklärung ist abgeschlossen. Die Sendung ist erneut auf Zustelltour.',eta:'31.10. · bis 18 Uhr'},
    {status:'delivered',label:'Zustellung gemeldet',place:'Berlin',message:'Der Carrier meldet die Sendung als zugestellt.',eta:null}
  ]},
  {id:'ups',carrier:'UPS',shop:'Shopware 6',order:'#SW-2002',tracking:'DEMO-UPS-2002',orderEvent:'SRC-SW-2002',item:'3 × Tea Bowl Sand',index:0,history:[],steps:[
    {status:'announced',label:'Label erstellt',place:'Versanddaten',message:'Versanddaten wurden elektronisch übermittelt. Ein Übernahmescan liegt noch nicht vor.',scan:'10:12:00',eta:null},
    {status:'in_transit',label:'Übernahme bestätigt',place:'Paketzentrum Köln',message:'Der Carrier hat die Sendung übernommen und im Paketzentrum gescannt.',eta:'02.11. · im Tagesverlauf'},
    {status:'out_for_delivery',label:'In Zustellung',place:'Zustelltour Köln',message:'Die Sendung ist auf Zustelltour.',eta:'31.10. · bis 19 Uhr'},
    {status:'delivered',label:'Zustellung gemeldet',place:'Köln',message:'Der Carrier meldet die Sendung als zugestellt.',eta:null}
  ]}
];
const latestScan = s => s.history.at(-1);
function appendTrackingObservation(s,step,received){
  const n=s.history.length+1;
  const scan=step.scan||received;
  const sourceId=`SRC-${s.id.toUpperCase()}-${String(n).padStart(3,'0')}`;
  const factId=`FAC-${s.id.toUpperCase()}-${String(n).padStart(3,'0')}`;
  const previous=latestScan(s);
  const observation={...step,scan,received,sourceId,factId};
  const raw={demo:true,carrier:s.carrier,tracking_number:s.tracking,order_ref:s.order,normalized_status:step.status,description:step.message,scan_at:`2026-10-31T${scan}+01:00`,received_at:`2026-10-31T${received}+01:00`,location:step.place,estimated_delivery:step.eta};
  events.push({id:sourceId,type:'source',title:`${s.carrier} · ${step.label}`,source:s.carrier,time:received,occurredAt:scan,entity:`${s.order} · ${s.tracking}`,detail:`Originalmeldung aus der ${s.carrier}-Demo. Zugeordnet zu ${s.shop} ${s.order} über ${s.tracking}. Scan-Zeit ${scan}, Empfang ${received}.`,quote:JSON.stringify(raw,null,2),related:[s.orderEvent,factId,...(previous?[previous.sourceId]:[])],proof:'Schema-neutrale Demo-Meldung · kein echter API-Payload'});
  events.push({id:factId,type:'fact',title:`${s.carrier} · ${s.order} · ${step.label}`,source:`${s.carrier} + ${s.shop}`,time:received,occurredAt:scan,entity:`${s.order} · ${s.tracking}`,detail:`${step.message} Letzter Ort: ${step.place}. ${step.eta?'Zustellprognose des Carriers: '+step.eta+'. Diese Schätzung ist keine Zusage.':'Es liegt keine aktuelle Zustellprognose vor.'} Diese Tracking-Beobachtung verändert keine Lagerbestände oder Reservierungen.`,quote:`Sendung ${s.tracking} · Auftrag ${s.order} · Status ${step.status} · gemeldet von ${s.carrier} um ${scan}. ${step.status==='delivered'?'Eine Zustellmeldung ist vorhanden; ein separater Empfangsbeleg wurde nicht importiert.':''}`,related:[sourceId,s.orderEvent,...(previous?[previous.factId]:[])],proof:'Normalisierter Tracking-Fact · aus Originalmeldung abgeleitet'});
  s.history.push(observation);
  return observation;
}
function seedTracking(){
  shipmentDemo.forEach((s,i)=>{
    events.push({id:s.orderEvent,type:'source',title:`${s.shop} · Auftrag ${s.order}`,source:s.shop,time:`10:41:${String(10+i*5).padStart(2,'0')}`,entity:`${s.order} · ${s.tracking}`,detail:`Fiktiver Auftrag aus ${s.shop}: ${s.item}. Die Lieferung ist über ${s.tracking} mit ${s.carrier} verknüpft. Diese Beispieldaten gehören zu einem separaten Artikel und beeinflussen den Olive-Cup-Bestand nicht.`,quote:`order_ref: ${s.order}\nshop: ${s.shop}\nitems: ${s.item}\ncarrier: ${s.carrier}\ntracking_number: ${s.tracking}`,related:[],proof:`${s.shop}-Auftragsauszug · Demo`});
    const observation=appendTrackingObservation(s,s.steps[0],`10:41:${String(11+i*5).padStart(2,'0')}`);
    events.find(e=>e.id===s.orderEvent).related=[observation.sourceId,observation.factId];
  });
  events.sort((a,b)=>a.time.localeCompare(b.time));
}
function shipmentStats(){return shipmentDemo.reduce((a,s)=>{const status=latestScan(s).status;if(status==='exception')a.exceptions++;else if(status==='delivered')a.delivered++;else a.open++;return a},{exceptions:0,delivered:0,open:0})}
function trackingAnswer(){
  const totals=shipmentStats();
  const waiting=shipmentDemo.filter(s=>latestScan(s).status==='exception');
  return {type:'tracking',title:waiting.length?`${waiting[0].carrier} ${waiting[0].order} braucht Aufmerksamkeit.`:totals.delivered===shipmentDemo.length?'Alle drei Carrier melden die Zustellung.':'Aktuell keine gemeldete Zustellstörung.',text:shipmentDemo.map(s=>`${s.carrier} ${s.order}: ${latestScan(s).message}${latestScan(s).eta?' Prognose: '+latestScan(s).eta+'.':''}`).join(' '),math:[[String(totals.open),'offen'],['',''],[String(totals.exceptions),'zur Klärung'],['',''],[String(totals.delivered),'zugestellt gemeldet']],note:'Aus den letzten Demo-Scans abgeleitet. Prognosen sind keine Lieferzusagen; „Label erstellt“ ist noch keine bestätigte Übergabe. Lagerbestand und Reservierungen bleiben unverändert.',refs:shipmentDemo.map(s=>latestScan(s).factId),question:'Wo sind meine Pakete?'};
}
function carrierSourceAction(source){
  if(!state.sources.includes(source.id))return '';
  const shipment=shipmentDemo.find(s=>s.id===source.id);
  const done=shipment.index>=shipment.steps.length-1;
  return `<button class="billing-card-link" data-action="tracking-next" data-id="${source.id}" ${done?'disabled':''}>${icon('wave')}${done?'Demo-Ereignisse aufgezeichnet':'Ereignis im Flugschreiber simulieren'}</button>`;
}
function advanceShipment(id){
  const s=shipmentDemo.find(s=>s.id===id);if(!s||!state.sources.includes(id)||s.index>=s.steps.length-1)return;
  state.elapsed++;
  s.index++;
  appendTrackingObservation(s,s.steps[s.index],currentTime());
  if(state.page==='app')navigate('recorder');
  toast(`${s.carrier}: Originalscan und neuer Fact aufgezeichnet.`);
}
document.addEventListener('click',event=>{const action=event.target.closest('[data-action]');if(!action)return;if(action.dataset.action==='tracking-next')advanceShipment(action.dataset.id)});
