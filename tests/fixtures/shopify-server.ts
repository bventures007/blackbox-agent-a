import Fastify from 'fastify';
const app=Fastify({logger:false});
let revision=0;
export function fixtureOrder(n:number,amount:string){return {id:`gid://shopify/Order/${n}`,updatedAt:revision?'2026-10-31T10:30:00Z':'2026-10-31T10:00:00Z',createdAt:'2026-10-30T09:00:00Z',test:true,currencyCode:'EUR',currentTotalPriceSet:{shopMoney:{amount:revision?'130.00':amount,currencyCode:'EUR'}},lineItems:{nodes:[{id:`gid://shopify/LineItem/${n}`,quantity:2}],pageInfo:{hasNextPage:false,endCursor:null}},transactions:[{id:`gid://shopify/OrderTransaction/${n+100}`,kind:'CAPTURE',status:'SUCCESS',processedAt:'2026-10-31T09:05:00Z',test:true,amountSet:{shopMoney:{amount,currencyCode:'EUR'}},parentTransaction:{id:`gid://shopify/OrderTransaction/${n+200}`}},{id:`gid://shopify/OrderTransaction/${n+200}`,kind:'AUTHORIZATION',status:'SUCCESS',processedAt:'2026-10-31T09:00:00Z',test:true,amountSet:{shopMoney:{amount,currencyCode:'EUR'}},parentTransaction:null}]};}
app.post('/admin/api/2026-10/graphql.json',async req=>{
 if(req.headers['x-shopify-access-token']!=='synthetic-fixture-token')return {errors:[{message:'Unauthorized'}]};
 const body=req.body as {variables:{after:string|null},query:string};if(!body.query.includes('transactions'))return {errors:[{message:'Missing selection'}]};
 const second=body.variables.after==='page-1';return {data:{orders:{nodes:[fixtureOrder(second?202:101,second?'55.73':'119.00')],pageInfo:{hasNextPage:!second,endCursor:second?'page-2':'page-1'}}}};
});
app.post('/revision',async req=>{revision=(req.body as {revision:number}).revision;return {ok:true};});
await app.listen({host:'0.0.0.0',port:8082});
