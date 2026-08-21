import crypto, {randomUUID} from 'node:crypto';
import {PostgresStore} from './store.js';
import {createProviderRegistry, constantTimeTokenMatch, safeProviderRecord} from './providers.js';
import {evaluatePolicy, isTerminalStatus} from './policy.js';
import {deepRedact, prepareTaskInput, PROVENANCE, SECURITY_POLICY_VERSION, TRUST_BOUNDARY} from './security.js';

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function safeError(error) {
  return {code:error.code || 'execution_failed', message:error.message || 'Execution failed'};
}

function parseAgentCredentials(raw) {
  if (!String(raw || '').trim()) return [];
  let parsed;
  try { parsed = JSON.parse(String(raw)); }
  catch { throw new Error('WILKERSON_AGENT_TOKENS_JSON must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('WILKERSON_AGENT_TOKENS_JSON must be an object keyed by agent ID.');
  return Object.entries(parsed).map(([agentId,record]) => {
    const token = String(record?.token || '').trim();
    const scope = Array.isArray(record?.scope) ? record.scope.map(item => String(item)) : [];
    if (!token || !scope.length) throw new Error(`Agent credential ${agentId} requires token and scope.`);
    return {agentId:String(agentId).slice(0,160),principal:String(record.principal || `agent:${agentId}`).slice(0,160),token,scope};
  });
}

export class ExecutionLayer {
  #authoritySeal = Symbol('wilkerson-authenticated-command');

  constructor({store, providers, authToken, agentCredentials = '', pollMs = 750, leaseSeconds = 90, workerId = `web-${randomUUID().slice(0,8)}`, selfTestOnBoot = false, injectionKillThreshold = 6, injectionWindowSeconds = 600}) {
    this.store = store;
    this.providers = providers;
    this.authToken = authToken;
    this.agentCredentials = parseAgentCredentials(agentCredentials);
    this.pollMs = Math.max(100, Number(pollMs) || 750);
    this.leaseSeconds = Math.max(15, Number(leaseSeconds) || 90);
    this.workerId = workerId;
    this.selfTestOnBoot = selfTestOnBoot;
    this.injectionKillThreshold = Math.max(1,Number(injectionKillThreshold) || 6);
    this.injectionWindowSeconds = Math.max(60,Number(injectionWindowSeconds) || 600);
    this.selfTest = {status:selfTestOnBoot ? 'pending' : 'disabled'};
    this.running = false;
    this.workerPromise = null;
    this.startedAt = new Date().toISOString();
  }

  async init({startWorker = true} = {}) {
    await this.store.init();
    for (const adapter of this.providers.values()) await this.store.upsertProvider(adapter.configuration());
    await this.store.audit(null,'execution_layer.started','system',{workerId:this.workerId,store:this.store.kind});
    if (startWorker) {
      this.startWorker();
    }
    return this;
  }

  authenticate(header = '') {
    return this.authenticateRequest(header).authenticated;
  }

  authenticateRequest(header = '') {
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    const provided = match?.[1] || '';
    if (constantTimeTokenMatch(this.authToken,provided)) {
      const fingerprint = crypto.createHash('sha256').update(provided).digest('hex').slice(0,16);
      return {authenticated:true,principal:`gateway:${fingerprint}`,agentId:'founder-gateway',scope:['*'],credentialType:'founder_gateway'};
    }
    for (const credential of this.agentCredentials) {
      if (constantTimeTokenMatch(credential.token,provided)) return {authenticated:true,principal:credential.principal,agentId:credential.agentId,scope:credential.scope,credentialType:'scoped_agent'};
    }
    return {authenticated:false};
  }

  createAuthenticatedContext({principal = 'gateway-principal', agentId = 'gateway-client', transport = 'rest', scope = ['*'], credentialType = 'internal_test'} = {}) {
    const context = {
      classification:PROVENANCE.TRUSTED_COMMAND,
      authenticated:true,
      channel:'wilkerson_sovereign_concierge_gateway',
      principal:String(principal || 'gateway-principal').slice(0,160),
      agentId:String(agentId || 'gateway-client').slice(0,160),
      transport:String(transport || 'rest').slice(0,40),
      scope:Array.isArray(scope) && scope.length ? scope.map(item => String(item).slice(0,160)) : ['*'],
      credentialType:String(credentialType).slice(0,80),
      timestamp:new Date().toISOString(),
      [this.#authoritySeal]:true
    };
    return Object.freeze(context);
  }

  createSystemContext({principal = 'wilkerson-system', agentId = 'execution-layer', scope = ['*']} = {}) {
    return Object.freeze({
      classification:PROVENANCE.TRUSTED_SYSTEM,
      authenticated:true,
      channel:'wilkerson_sovereign_system',
      principal,agentId,transport:'internal',scope:scope.length?scope:['*'],credentialType:'trusted_system',
      timestamp:new Date().toISOString(),
      [this.#authoritySeal]:true
    });
  }

  requireAuthority(context) {
    if (!context || context[this.#authoritySeal] !== true || context.authenticated !== true) {
      throw Object.assign(new Error('Executable tasks require authenticated Wilkerson Sovereign Gateway provenance.'),{code:'authenticated_gateway_provenance_required'});
    }
    return context;
  }

  requireScope(context, required = []) {
    const authority = this.requireAuthority(context);
    if (!authority.scope.includes('*') && !required.every(item => authority.scope.includes(item))) {
      throw Object.assign(new Error('The authenticated agent credential does not grant the required scope.'),{code:'agent_scope_violation'});
    }
    return authority;
  }

  async health() {
    try {
      await this.store.ping();
      const security = await this.store.getSecurityState();
      return {ok:true,status:security.killSwitchActive?'security_halt':'ready',service:'wilkerson-sovereign-execution-layer',version:'1.1.0',database:this.store.kind,queue:'postgresql-durable-task-queue',worker:{running:this.running,id:this.workerId},security,selfTest:this.selfTest,startedAt:this.startedAt};
    } catch (error) {
      return {ok:false,status:'degraded',service:'wilkerson-sovereign-execution-layer',database:this.store.kind,error:safeError(error)};
    }
  }

  async capabilities() {
    const security = await this.store.getSecurityState();
    return {
      phase:'execution-layer-1.1-concierge-defense',
      lifecycle:['command','policy','queue','provider_lease','execution','verification','artifact_audit','release','structured_result'],
      authentication:'bearer',
      queue:'postgresql',
      providers:(await this.store.listProviders()).map(safeProviderRecord),
      operations:{routine:['gateway.verify','system.echo','modules.capabilities','provider.probe'],consequential:'approval_required'},
      trustBoundary:TRUST_BOUNDARY,
      provenanceLabels:PROVENANCE,
      security:{policyVersion:SECURITY_POLICY_VERSION,killSwitch:security,externalContentMayAuthorize:false,agentCredentials:{mode:'per_agent_scoped_tokens',configured:this.agentCredentials.length}}
    };
  }

  async submit({command, provider = 'wilkerson', operation = 'gateway.verify', input = {}}, authorityContext) {
    const requiredScope = [`provider:${provider}`,`operation:${operation}`];
    const authority = this.requireScope(authorityContext,requiredScope);
    const securityState = await this.store.getSecurityState();
    if (securityState.killSwitchActive) throw Object.assign(new Error('The Concierge security kill switch is active.'),{code:'security_kill_switch_active'});
    const cleanCommand = String(command || '').trim();
    if (!cleanCommand) throw Object.assign(new Error('command is required'), {code:'invalid_request'});
    if (!this.providers.has(provider)) throw Object.assign(new Error(`Unknown provider: ${provider}`), {code:'unknown_provider'});
    const policy = evaluatePolicy({command:cleanCommand,provider,operation});
    const id = randomUUID();
    const prepared = prepareTaskInput(input);
    const scope = requiredScope;
    const provenance = {
      classification:authority.classification,
      authenticated:true,
      channel:authority.channel,
      taskId:id,
      principal:authority.principal,
      agentId:authority.agentId,
      transport:authority.transport,
      credentialType:authority.credentialType,
      scope,
      timestamp:authority.timestamp,
      policyDecision:policy.decision,
      policyVersion:policy.policyVersion
    };
    const task = {
      id,command:cleanCommand,provider,operation,input:prepared.input,
      status:policy.requiresApproval?'awaiting_approval':'queued',policy,
      requestedBy:authority.principal,provenance,
      securityContext:{
        policyVersion:SECURITY_POLICY_VERSION,
        labels:{command:authority.classification,system:PROVENANCE.TRUSTED_SYSTEM,external:PROVENANCE.UNTRUSTED_EXTERNAL_CONTENT},
        externalContentMayAuthorize:false,
        observations:prepared.observations,
        indicators:prepared.indicators,
        isolation:TRUST_BOUNDARY.isolation
      }
    };
    const created = await this.store.createTask(task, policy.requiresApproval ? {reasons:policy.reasons,command:cleanCommand,provider,operation,provenance:{principal:authority.principal,agentId:authority.agentId,scope}} : null);
    if (prepared.indicators.length) {
      const event = prepared.indicators.some(item => /executable|macro|archive/.test(item)) ? 'security.malware_indicator_detected' : 'security.prompt_injection_detected';
      await this.store.audit(id,event,authority.principal,{classification:PROVENANCE.UNTRUSTED_EXTERNAL_CONTENT,indicators:prepared.indicators,observationCount:prepared.observations.length,action:'ignored_and_returned_as_observation'});
      await this.store.recordSecuritySignal({taskId:id,actor:authority.principal,signalWeight:prepared.signalWeight,threshold:this.injectionKillThreshold,windowSeconds:this.injectionWindowSeconds,indicators:prepared.indicators});
      created.task = await this.store.getTask(id);
    }
    return created;
  }

  async recordExternalObservation({sourceType = 'external_content', content}, authorityContext) {
    const authority = this.requireAuthority(authorityContext);
    const prepared = prepareTaskInput({[sourceType]:content});
    if (prepared.indicators.length) {
      const event = prepared.indicators.some(item => /executable|macro|archive/.test(item)) ? 'security.malware_indicator_detected' : 'security.prompt_injection_detected';
      await this.store.audit(null,event,authority.principal,{classification:PROVENANCE.UNTRUSTED_EXTERNAL_CONTENT,sourceType,indicators:prepared.indicators,observationCount:prepared.observations.length,action:'ignored_and_returned_as_observation'});
      await this.store.recordSecuritySignal({actor:authority.principal,signalWeight:prepared.signalWeight,threshold:this.injectionKillThreshold,windowSeconds:this.injectionWindowSeconds,indicators:prepared.indicators});
    }
    return {observations:prepared.observations,indicators:prepared.indicators,externalContentMayAuthorize:false};
  }

  async status(id) {
    return this.store.getTask(id);
  }

  async result(id) {
    const task = await this.store.getTask(id);
    if (!task) return null;
    return {taskId:task.id,status:task.status,result:task.result,verification:task.verification,error:task.error,artifacts:await this.store.listArtifacts(task.id)};
  }

  async cancel(id, authorityContext) {
    const authority = this.requireScope(authorityContext,['task:cancel']);
    const task = await this.store.getTask(id);
    if (!task) return null;
    if (isTerminalStatus(task.status)) return task;
    return this.store.cancelTask(id,authority.principal);
  }

  async approvals(status = 'pending') { return this.store.listApprovals(status); }
  async decideApproval(id, decision, authorityContext, note = '') {
    const authority = this.requireScope(authorityContext,['approval:decide']);
    if (!['approved','denied'].includes(decision)) throw Object.assign(new Error('decision must be approved or denied'),{code:'invalid_request'});
    return this.store.decideApproval(id,decision,authority.principal,note);
  }
  async audit(taskId) { return this.store.listAudit(taskId || null); }
  async artifacts(taskId) { return this.store.listArtifacts(taskId || null); }
  async artifact(id) { return this.store.getArtifact(id); }
  async providersList() { return (await this.store.listProviders()).map(safeProviderRecord); }

  async probeProvider(id, authorityContext) {
    const authority = this.requireScope(authorityContext,[`provider:${id}`,'operation:provider.probe']);
    const adapter = this.providers.get(id);
    if (!adapter) throw Object.assign(new Error(`Unknown provider: ${id}`),{code:'unknown_provider'});
    try {
      const record = await adapter.probe();
      const saved = await this.store.upsertProvider({...record,lastProbeAt:new Date().toISOString()});
      await this.store.audit(null,'provider.probed',authority.principal,{provider:id,status:saved.status});
      return safeProviderRecord(saved);
    } catch (error) {
      const config = adapter.configuration();
      const saved = await this.store.upsertProvider({...config,status:'connection_failed',detail:safeError(error),lastProbeAt:new Date().toISOString()});
      await this.store.audit(null,'provider.probe_failed',authority.principal,{provider:id,error:safeError(error)});
      return safeProviderRecord(saved);
    }
  }

  startWorker() {
    if (this.running) return;
    this.running = true;
    this.workerPromise = this.workerLoop();
  }

  async stopWorker() {
    this.running = false;
    await Promise.race([this.workerPromise || Promise.resolve(), wait(5_000)]);
  }

  async workerLoop() {
    while (this.running) {
      try {
        const task = await this.store.claimNextTask(this.workerId,this.leaseSeconds);
        if (!task) { await wait(this.pollMs); continue; }
        await this.executeTask(task);
      } catch (error) {
        await this.store.audit(null,'worker.loop_error','worker',safeError(error)).catch(()=>{});
        await wait(Math.max(this.pollMs,1000));
      }
    }
  }

  async processOne() {
    const task = await this.store.claimNextTask(this.workerId,this.leaseSeconds);
    if (!task) return null;
    return this.executeTask(task);
  }

  async runSelfTest() {
    this.selfTest = {status:'running',transport:'internal_contract',startedAt:new Date().toISOString()};
    try {
      const submitted = await this.submit({command:'Phase 1 harmless remote execution verification',provider:'wilkerson',operation:'gateway.verify'},this.createSystemContext({principal:'system:self-test',agentId:'boot-self-test'}));
      const deadline = Date.now() + 20_000;
      let task = submitted.task;
      while (!isTerminalStatus(task.status) && Date.now() < deadline) {
        await wait(150);
        task = await this.status(task.id);
      }
      const result = await this.result(task.id);
      if (task.status !== 'succeeded' || task.verification?.verified !== true || !result?.artifacts?.length) throw Object.assign(new Error(`Self-test ended with status ${task.status}`),{code:'self_test_failed'});
      const audit = await this.audit(task.id);
      this.selfTest = {status:'passed',taskId:task.id,verification:task.verification,artifactCount:result.artifacts.length,auditEvents:audit.map(item=>item.event),completedAt:new Date().toISOString()};
      await this.store.audit(task.id,'self_test.passed','system',{artifactCount:result.artifacts.length});
    } catch (error) {
      this.selfTest = {status:'failed',error:safeError(error),completedAt:new Date().toISOString()};
      await this.store.audit(null,'self_test.failed','system',safeError(error)).catch(()=>{});
    }
  }

  async runRemoteSelfTest(baseUrl) {
    if (!this.selfTestOnBoot) return;
    this.selfTest = {status:'running',transport:'authenticated_http',startedAt:new Date().toISOString()};
    const headers = {Authorization:`Bearer ${this.authToken}`,'Content-Type':'application/json','X-Wilkerson-Principal':'system:self-test','X-Wilkerson-Agent-Id':'remote-self-test'};
    try {
      const submittedResponse = await fetch(new URL('/api/tasks',baseUrl),{method:'POST',headers,body:JSON.stringify({command:'Phase 1 harmless remote execution verification',provider:'wilkerson',operation:'gateway.verify'})});
      if (!submittedResponse.ok) throw Object.assign(new Error(`Remote submit returned HTTP ${submittedResponse.status}`),{code:'self_test_submit_failed'});
      const submitted = await submittedResponse.json();
      const taskId = submitted.task?.id;
      if (!taskId) throw Object.assign(new Error('Remote submit did not return a task ID'),{code:'self_test_submit_invalid'});
      const deadline = Date.now()+20_000;
      let result;
      while (Date.now()<deadline) {
        await wait(150);
        const response = await fetch(new URL(`/api/tasks/${taskId}/result`,baseUrl),{headers});
        if (!response.ok) throw Object.assign(new Error(`Remote result returned HTTP ${response.status}`),{code:'self_test_result_failed'});
        result = await response.json();
        if (isTerminalStatus(result.status)) break;
      }
      if (result?.status!=='succeeded' || result.verification?.verified!==true || !result.artifacts?.length) throw Object.assign(new Error(`Remote self-test ended with status ${result?.status || 'unknown'}`),{code:'self_test_failed'});
      const auditResponse = await fetch(new URL(`/api/audit?task_id=${encodeURIComponent(taskId)}`,baseUrl),{headers});
      if (!auditResponse.ok) throw Object.assign(new Error(`Remote audit returned HTTP ${auditResponse.status}`),{code:'self_test_audit_failed'});
      const audit = await auditResponse.json();
      this.selfTest = {status:'passed',transport:'authenticated_http',taskId,verification:result.verification,artifactCount:result.artifacts.length,auditEvents:audit.audit.map(item=>item.event),completedAt:new Date().toISOString()};
      await this.store.audit(taskId,'self_test.remote_passed','system',{transport:'authenticated_http',artifactCount:result.artifacts.length});
    } catch (error) {
      this.selfTest = {status:'failed',transport:'authenticated_http',error:safeError(error),completedAt:new Date().toISOString()};
      await this.store.audit(null,'self_test.remote_failed','system',safeError(error)).catch(()=>{});
    }
  }

  async executeTask(task) {
    const securityState = await this.store.getSecurityState();
    if (securityState.killSwitchActive) return this.store.failTask(task.id,Object.assign(new Error('The Concierge security kill switch is active.'),{code:'security_kill_switch_active'}));
    if (!task.provenance?.authenticated || task.provenance?.taskId !== task.id || ![PROVENANCE.TRUSTED_COMMAND,PROVENANCE.TRUSTED_SYSTEM].includes(task.provenance?.classification)) {
      await this.store.audit(task.id,'security.untrusted_execution_blocked','worker',{classification:task.provenance?.classification || 'missing',reason:'trusted_gateway_provenance_required'});
      return this.store.failTask(task.id,Object.assign(new Error('Trusted gateway provenance is required.'),{code:'trusted_provenance_required'}));
    }
    if (!task.provenance.scope?.includes(`provider:${task.provider}`) || !task.provenance.scope?.includes(`operation:${task.operation}`)) {
      await this.store.audit(task.id,'security.scope_violation_blocked','worker',{provider:task.provider,operation:task.operation});
      return this.store.failTask(task.id,Object.assign(new Error('Task execution is outside its authenticated scope.'),{code:'task_scope_violation'}));
    }
    const adapter = this.providers.get(task.provider);
    if (!adapter) return this.store.failTask(task.id,Object.assign(new Error('Provider adapter not found'),{code:'provider_missing'}));
    const config = adapter.configuration();
    if (config.status === 'configuration_required') {
      const error = Object.assign(new Error(`Provider ${task.provider} requires configuration: ${config.missingConfig.join(', ')}`),{code:'configuration_required'});
      return this.store.failTask(task.id,error);
    }
    let lease;
    try {
      lease = await this.store.createLease(task.id,task.provider,this.workerId);
      await this.store.audit(task.id,'task.execution_started','worker',{provider:task.provider,operation:task.operation});
      const result = await adapter.execute(Object.freeze(structuredClone(task)));
      const verification = deepRedact(await adapter.verify(task,result));
      if (!verification?.verified) throw Object.assign(new Error('Provider result verification failed'),{code:'verification_failed'});
      const safeResult = deepRedact(result);
      const observations = task.securityContext?.observations || [];
      const structuredResult = observations.length
        ? {providerResult:safeResult,observations,externalContentMayAuthorize:false}
        : safeResult;
      const content = {taskId:task.id,provider:task.provider,operation:task.operation,result:structuredResult,verification,provenance:task.provenance,security:{externalContentMayAuthorize:false,observationCount:observations.length}};
      const artifact = {id:randomUUID(),taskId:task.id,kind:'execution_result',name:`task-${task.id}-result.json`,mediaType:'application/json',content,sha256:crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex'),createdAt:new Date().toISOString()};
      await this.store.createArtifact(artifact);
      await adapter.release(task,lease);
      await this.store.releaseLease(lease.id,task.id,{outcome:'succeeded'});
      return this.store.completeTask(task.id,structuredResult,verification);
    } catch (error) {
      if (lease) {
        await adapter.release(task,lease).catch(()=>{});
        await this.store.releaseLease(lease.id,task.id,{outcome:'failed',error:safeError(error)}).catch(()=>{});
      }
      return this.store.failTask(task.id,error);
    }
  }

  async close() {
    await this.stopWorker();
    await this.store.close();
  }
}

export async function createExecutionLayer({env = process.env, store, startWorker = true} = {}) {
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!store && !databaseUrl) return null;
  const authToken = String(env.GATEWAY_API_TOKEN || '').trim();
  if (!authToken) throw new Error('GATEWAY_API_TOKEN is required when the execution layer is enabled.');
  const layer = new ExecutionLayer({store:store || new PostgresStore(databaseUrl),providers:createProviderRegistry(env),authToken,agentCredentials:env.WILKERSON_AGENT_TOKENS_JSON,pollMs:env.WORKER_POLL_MS,leaseSeconds:env.WORKER_LEASE_SECONDS,workerId:env.WORKER_ID,selfTestOnBoot:String(env.EXECUTION_SELF_TEST_ON_BOOT || '').toLowerCase()==='true',injectionKillThreshold:env.INJECTION_KILL_THRESHOLD,injectionWindowSeconds:env.INJECTION_WINDOW_SECONDS});
  return layer.init({startWorker});
}
