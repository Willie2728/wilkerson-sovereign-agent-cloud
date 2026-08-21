import crypto from 'node:crypto';
import {assertSafeOutboundUrl, deepRedact, PROVENANCE, TRUST_BOUNDARY} from './security.js';

function envValue(env, key) {
  return String(env[key] || '').trim();
}

function missing(env, keys) {
  return keys.filter(key => !envValue(env, key));
}

async function fetchJson(url, options = {}, timeoutMs = 10_000, networkPolicy = {}) {
  const safeUrl = await assertSafeOutboundUrl(url,networkPolicy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(safeUrl, {...options, redirect:'error', signal:controller.signal});
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = {text:deepRedact(text.slice(0, 500))}; }
    if (!response.ok) {
      const error = new Error(`Provider returned HTTP ${response.status}`);
      error.code = 'provider_http_error';
      error.status = response.status;
      error.details = deepRedact(body);
      throw error;
    }
    return deepRedact(body);
  } finally {
    clearTimeout(timer);
  }
}

function scopedEnvironment(env, requiredEnv) {
  const keys = [...requiredEnv,'WILKERSON_APPROVED_DESTINATIONS','WILKERSON_PRIVATE_DESTINATIONS','WILKERSON_HTTP_DESTINATIONS'];
  return Object.freeze(Object.fromEntries(keys.map(key => [key,envValue(env,key)])));
}

class ProviderAdapter {
  constructor({id, label, requiredEnv = [], capabilities = [], env, probe}) {
    this.id = id;
    this.label = label;
    this.requiredEnv = requiredEnv;
    this.capabilities = capabilities;
    this.scopedEnv = scopedEnvironment(env,requiredEnv);
    this.probeHandler = probe;
  }

  configuration() {
    const missingConfig = missing(this.scopedEnv, this.requiredEnv);
    return {
      id:this.id,
      label:this.label,
      status:missingConfig.length ? 'configuration_required' : 'configured_unverified',
      missingConfig,
      capabilities:this.capabilities,
      credentialScope:this.requiredEnv,
      isolation:TRUST_BOUNDARY.isolation
    };
  }

  async probe() {
    const config = this.configuration();
    if (config.missingConfig.length) return config;
    if (!this.probeHandler) return {...config, status:'configured_unverified', detail:'No safe probe is enabled for this adapter.'};
    const detail = await this.probeHandler(this.scopedEnv);
    return {...config, status:'connected', missingConfig:[], detail};
  }

  async execute(task) {
    if (task.provenance?.classification !== PROVENANCE.TRUSTED_COMMAND && task.provenance?.classification !== PROVENANCE.TRUSTED_SYSTEM) {
      throw Object.assign(new Error('Provider execution requires trusted gateway provenance.'),{code:'trusted_provenance_required'});
    }
    if (task.provenance?.authenticated !== true || !task.provenance?.scope?.includes(`operation:${task.operation}`)) {
      throw Object.assign(new Error('Provider execution is outside the authenticated task scope.'),{code:'task_scope_violation'});
    }
    if (task.operation === 'provider.probe') return this.probe();
    const error = new Error(`Operation ${task.operation} is not enabled for provider ${this.id}.`);
    error.code = 'provider_operation_not_enabled';
    throw error;
  }

  async verify(_task, result) {
    return {verified:Boolean(result), method:'adapter_result_presence'};
  }

  async release() {
    return {released:true};
  }
}

class WilkersonAdapter extends ProviderAdapter {
  constructor(env) {
    super({id:'wilkerson', label:'Wilkerson Modules', env, capabilities:['gateway.verify','system.echo','modules.capabilities','provider.probe']});
  }

  configuration() {
    return {id:this.id, label:this.label, status:'connected', missingConfig:[], capabilities:this.capabilities,credentialScope:[],isolation:TRUST_BOUNDARY.isolation};
  }

  async probe() {
    return {...this.configuration(), detail:{runtime:'existing-wilkerson-stack', phase:'execution-layer-1'}};
  }

  async execute(task) {
    if (task.operation === 'provider.probe') return this.probe();
    if (task.operation === 'gateway.verify') {
      return {
        ok:true,
        command:task.command,
        provider:'wilkerson',
        lifecycle:['command','policy','queue','provider_lease','execution','verification','artifact_audit','release','result'],
        completedAt:new Date().toISOString()
      };
    }
    if (task.operation === 'system.echo') return {ok:true, echo:task.input?.text ?? task.command};
    if (task.operation === 'modules.capabilities') return {ok:true, modules:['sovereign','forge','persona','crawler','browser-pilot','voice','motion','broadcast','skills','agent-core']};
    return super.execute(task);
  }

  async verify(task, result) {
    return {verified:result?.ok === true, method:'wilkerson_phase1_contract', operation:task.operation};
  }
}

function bearer(token) {
  return {Authorization:`Bearer ${token}`, Accept:'application/json'};
}

export function createProviderRegistry(env = process.env) {
  const providers = [
    new WilkersonAdapter(env),
    new ProviderAdapter({
      id:'orgo', label:'Orgo Computers', env,
      requiredEnv:['ORGO_API_KEY','ORGO_WORKSPACE_ID'],
      capabilities:['provider.probe','computers.list','computer.lease','computer.release','computer.action'],
      probe:async currentEnv => fetchJson(`https://www.orgo.ai/api/computers?workspace_id=${encodeURIComponent(currentEnv.ORGO_WORKSPACE_ID)}`, {headers:bearer(currentEnv.ORGO_API_KEY)},10_000,{approvedHosts:['www.orgo.ai'],env:currentEnv})
    }),
    new ProviderAdapter({
      id:'openclaw', label:'OpenClaw Gateway', env,
      requiredEnv:['OPENCLAW_GATEWAY_URL','OPENCLAW_TOKEN'],
      capabilities:['provider.probe','sessions.list','agent.submit','agent.cancel'],
      probe:null
    }),
    new ProviderAdapter({
      id:'hermes', label:'Hermes Runtime', env,
      requiredEnv:['HERMES_BASE_URL','HERMES_API_KEY'],
      capabilities:['provider.probe','job.submit','job.status','job.cancel','job.result'],
      probe:async currentEnv => {
        const target = new URL('/health',currentEnv.HERMES_BASE_URL);
        return fetchJson(target,{headers:bearer(currentEnv.HERMES_API_KEY)},10_000,{approvedHosts:[target.hostname],env:currentEnv});
      }
    }),
    new ProviderAdapter({
      id:'vagon', label:'Vagon Streams', env,
      requiredEnv:['VAGON_API_KEY','VAGON_API_SECRET','VAGON_APPLICATION_ID','VAGON_STREAM_ID'],
      capabilities:['provider.probe','stream.start','stream.assign','stream.stop','machine.status'],
      probe:null
    }),
    new ProviderAdapter({
      id:'highlevel', label:'HighLevel', env,
      requiredEnv:['HIGHLEVEL_TOKEN','HIGHLEVEL_LOCATION_ID'],
      capabilities:['provider.probe','contacts.read','opportunities.read','message.draft','workflow.trigger'],
      probe:async currentEnv => fetchJson(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(currentEnv.HIGHLEVEL_LOCATION_ID)}`, {headers:{...bearer(currentEnv.HIGHLEVEL_TOKEN), Version:'2021-07-28'}},10_000,{approvedHosts:['services.leadconnectorhq.com'],env:currentEnv})
    }),
    new ProviderAdapter({
      id:'github', label:'GitHub', env,
      requiredEnv:['GITHUB_TOKEN','GITHUB_OWNER'],
      capabilities:['provider.probe','repository.read','issue.create','workflow.dispatch'],
      probe:async currentEnv => fetchJson('https://api.github.com/user', {headers:{...bearer(currentEnv.GITHUB_TOKEN), 'User-Agent':'wilkerson-sovereign-stack', 'X-GitHub-Api-Version':'2022-11-28'}},10_000,{approvedHosts:['api.github.com'],env:currentEnv})
    }),
    new ProviderAdapter({
      id:'render', label:'Render', env,
      requiredEnv:['RENDER_API_KEY','RENDER_WORKSPACE_ID'],
      capabilities:['provider.probe','services.read','deploy.trigger','deploy.status','logs.read'],
      probe:async currentEnv => {
        const workspace = await fetchJson(`https://api.render.com/v1/owners/${encodeURIComponent(currentEnv.RENDER_WORKSPACE_ID)}`,{headers:bearer(currentEnv.RENDER_API_KEY)},10_000,{approvedHosts:['api.render.com'],env:currentEnv});
        const services = await fetchJson(`https://api.render.com/v1/services?limit=1&ownerId=${encodeURIComponent(currentEnv.RENDER_WORKSPACE_ID)}`,{headers:bearer(currentEnv.RENDER_API_KEY)},10_000,{approvedHosts:['api.render.com'],env:currentEnv});
        return {workspaceVerified:true,workspaceName:workspace?.name || workspace?.owner?.name || null,serviceReadVerified:Array.isArray(services)};
      }
    })
  ];

  return new Map(providers.map(provider => [provider.id, provider]));
}

export function safeProviderRecord(record) {
  return deepRedact(structuredClone(record));
}

export function constantTimeTokenMatch(expected, provided) {
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
