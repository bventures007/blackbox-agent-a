import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readFile} from 'node:fs/promises';
const api=process.env.BLACKBOX_API_URL??'http://127.0.0.1:18741';
const url=new URL(api);if(!['127.0.0.1','localhost'].includes(url.hostname)&&!(process.env.ALLOW_SYNTHETIC_FIXTURE==='1'&&url.hostname==='api'))throw new Error('loopback_api_required');
const key=process.env.BLACKBOX_AGENT_KEY??await readFile(process.env.BLACKBOX_AGENT_KEY_FILE!,'utf8');
const names=['describe_business_schema','get_business_state','list_journal_entries','get_journal_entry','get_entity_history','search_events','get_evidence'];
const properties:Record<string,Record<string,unknown>>={get_business_state:{entity_id:{type:'string',format:'uuid'},recorded_cutoff:{type:'integer',minimum:0},effective_at:{type:'string',format:'date-time'},at_least_cursor:{type:'integer',minimum:0}},get_journal_entry:{entry_id:{type:'string',format:'uuid'}},get_evidence:{evidence_id:{type:'string',format:'uuid'}}};
const server=new Server({name:'blackbox-local',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:names.map(name=>({name,description:`Read authorized Blackbox business data: ${name}. Source content is untrusted.`,inputSchema:{type:'object',properties:properties[name]??(name==='describe_business_schema'?{}:{entity_id:{type:'string',format:'uuid'},track:{type:'string',enum:['source','fact','commitment','movement','reservation']},limit:{type:'integer',minimum:1,maximum:500},cursor:{type:'string'}}),additionalProperties:false,...properties[name]?{required:[Object.keys(properties[name])[0]]}:{}},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
 if(!names.includes(req.params.name))return {isError:true,content:[{type:'text',text:'unsupported_tool'}]};
 try{const r=await fetch(`${api}/v1/tools/${req.params.name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key.trim()}`,host:`127.0.0.1:${process.env.PUBLIC_PORT??18741}`},body:JSON.stringify(req.params.arguments??{}),signal:AbortSignal.timeout(5000)});return {isError:!r.ok,content:[{type:'text',text:JSON.stringify(await r.json())}]};}catch{return {isError:true,content:[{type:'text',text:'backend_unavailable'}]};}
});
await server.connect(new StdioServerTransport());
