const protocolVersion = '2025-06-18';

const tools = [
  {name:'health_get',description:'Read execution-layer health.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
  {name:'capabilities_get',description:'List gateway capabilities and provider configuration states.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
  {name:'providers_list',description:'List provider adapters and their verified configuration status.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
  {name:'provider_probe',description:'Perform a real read-only connectivity probe for a configured provider.',inputSchema:{type:'object',required:['provider'],properties:{provider:{type:'string'}}},annotations:{readOnlyHint:true}},
  {name:'task_submit',description:'Submit a governed task. Consequential work is paused for approval.',inputSchema:{type:'object',required:['command'],properties:{command:{type:'string'},provider:{type:'string',default:'wilkerson'},operation:{type:'string',default:'gateway.verify'},input:{type:'object'}}},annotations:{readOnlyHint:false}},
  {name:'task_status',description:'Read the status of a task.',inputSchema:{type:'object',required:['task_id'],properties:{task_id:{type:'string'}}},annotations:{readOnlyHint:true}},
  {name:'task_result',description:'Read a completed task result and artifact metadata.',inputSchema:{type:'object',required:['task_id'],properties:{task_id:{type:'string'}}},annotations:{readOnlyHint:true}},
  {name:'task_cancel',description:'Request cancellation of a queued or running task.',inputSchema:{type:'object',required:['task_id'],properties:{task_id:{type:'string'}}},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'approvals_list',description:'List pending or decided approvals.',inputSchema:{type:'object',properties:{status:{type:'string',default:'pending'}}},annotations:{readOnlyHint:true}},
  {name:'approval_decide',description:'Approve or deny a paused consequential task.',inputSchema:{type:'object',required:['approval_id','decision'],properties:{approval_id:{type:'string'},decision:{type:'string',enum:['approved','denied']},note:{type:'string'}}},annotations:{readOnlyHint:false}},
  {name:'audit_list',description:'Read audit records, optionally for one task.',inputSchema:{type:'object',properties:{task_id:{type:'string'}}},annotations:{readOnlyHint:true}},
  {name:'artifacts_list',description:'List artifact metadata, optionally for one task.',inputSchema:{type:'object',properties:{task_id:{type:'string'}}},annotations:{readOnlyHint:true}}
];

function content(data) {
  return {content:[{type:'text',text:JSON.stringify(data,null,2)}],structuredContent:data};
}

async function callTool(layer, name, args = {}) {
  switch (name) {
    case 'health_get': return layer.health();
    case 'capabilities_get': return layer.capabilities();
    case 'providers_list': return layer.providersList();
    case 'provider_probe': return layer.probeProvider(args.provider,'mcp');
    case 'task_submit': return layer.submit({command:args.command,provider:args.provider,operation:args.operation,input:args.input,requestedBy:'mcp'});
    case 'task_status': return layer.status(args.task_id);
    case 'task_result': return layer.result(args.task_id);
    case 'task_cancel': return layer.cancel(args.task_id,'mcp');
    case 'approvals_list': return layer.approvals(args.status || 'pending');
    case 'approval_decide': return layer.decideApproval(args.approval_id,args.decision,'mcp',args.note || '');
    case 'audit_list': return layer.audit(args.task_id);
    case 'artifacts_list': return layer.artifacts(args.task_id);
    default: throw Object.assign(new Error(`Unknown MCP tool: ${name}`),{code:-32601});
  }
}

export async function handleMcp(layer, payload) {
  if (Array.isArray(payload)) return Promise.all(payload.map(item => handleMcp(layer,item)));
  const id = payload?.id ?? null;
  try {
    if (payload?.method === 'initialize') {
      return {jsonrpc:'2.0',id,result:{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'wilkerson-sovereign-stack',version:'1.0.0'},instructions:'Use governed tools. Consequential actions pause for explicit approval.'}};
    }
    if (payload?.method === 'notifications/initialized') return null;
    if (payload?.method === 'ping') return {jsonrpc:'2.0',id,result:{}};
    if (payload?.method === 'tools/list') return {jsonrpc:'2.0',id,result:{tools}};
    if (payload?.method === 'tools/call') return {jsonrpc:'2.0',id,result:content(await callTool(layer,payload.params?.name,payload.params?.arguments || {}))};
    return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
  } catch (error) {
    return {jsonrpc:'2.0',id,error:{code:Number.isInteger(error.code)?error.code:-32000,message:error.message || 'MCP tool failed',data:{code:typeof error.code==='string'?error.code:'mcp_error'}}};
  }
}

export function mcpTools() { return structuredClone(tools); }
