import crypto, {randomUUID} from 'node:crypto';
import {PostgresStore} from './store.js';
import {createProviderRegistry, constantTimeTokenMatch, safeProviderRecord} from './providers.js';
import {evaluatePolicy, isTerminalStatus} from './policy.js';

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function safeError(error) {
  return {code:error.code || 'execution_failed', message:error.message || 'Execution failed'};
}

export class ExecutionLayer {
  constructor({store, providers, authToken, pollMs = 750, leaseSeconds = 90, workerId = `web-${randomUUID().slice(0,8)}`, selfTestOnBoot = false}) {
    this.store = store;
    this.providers = providers;
    this.authToken = authToken;
    this.pollMs = Math.max(100, Number(pollMs) || 750);
    this.leaseSeconds = Math.max(15, Number(leaseSeconds) || 90);
    this.workerId = workerId;
    this.selfTestOnBoot = selfTestOnBoot;
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
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    return constantTimeTokenMatch(this.authToken, match?.[1] || '');
  }

  async health() {
    try {
      await this.store.ping();
      return {ok:true,status:'ready',service:'wilkerson-sovereign-execution-layer',version:'1.0.0',database:this.store.kind,queue:'postgresql-durable-task-queue',worker:{running:this.running,id:this.workerId},selfTest:this.selfTest,startedAt:this.startedAt};
    } catch (error) {
      return {ok:false,status:'degraded',service:'wilkerson-sovereign-execution-layer',database:this.store.kind,error:safeError(error)};
    }
  }

  async capabilities() {
    return {
      phase:'execution-layer-1',
      lifecycle:['command','policy','queue','provider_lease','execution','verification','artifact_audit','release','structured_result'],
      authentication:'bearer',
      queue:'postgresql',
      providers:(await this.store.listProviders()).map(safeProviderRecord),
      operations:{routine:['gateway.verify','system.echo','modules.capabilities','provider.probe'],consequential:'approval_required'}
    };
  }

  async submit({command, provider = 'wilkerson', operation = 'gateway.verify', input = {}, requestedBy = 'api'}) {
    const cleanCommand = String(command || '').trim();
    if (!cleanCommand) throw Object.assign(new Error('command is required'), {code:'invalid_request'});
    if (!this.providers.has(provider)) throw Object.assign(new Error(`Unknown provider: ${provider}`), {code:'unknown_provider'});
    const policy = evaluatePolicy({command:cleanCommand,provider,operation});
    const task = {id:randomUUID(),command:cleanCommand,provider,operation,input,status:policy.requiresApproval?'awaiting_approval':'queued',policy,requestedBy};
    return this.store.createTask(task, policy.requiresApproval ? {reasons:policy.reasons,command:cleanCommand,provider,operation} : null);
  }

  async status(id) {
    return this.store.getTask(id);
  }

  async result(id) {
    const task = await this.store.getTask(id);
    if (!task) return null;
    return {taskId:task.id,status:task.status,result:task.result,verification:task.verification,error:task.error,artifacts:await this.store.listArtifacts(task.id)};
  }

  async cancel(id, actor = 'api') {
    const task = await this.store.getTask(id);
    if (!task) return null;
    if (isTerminalStatus(task.status)) return task;
    return this.store.cancelTask(id,actor);
  }

  async approvals(status = 'pending') { return this.store.listApprovals(status); }
  async decideApproval(id, decision, actor = 'api', note = '') {
    if (!['approved','denied'].includes(decision)) throw Object.assign(new Error('decision must be approved or denied'),{code:'invalid_request'});
    return this.store.decideApproval(id,decision,actor,note);
  }
  async audit(taskId) { return this.store.listAudit(taskId || null); }
  async artifacts(taskId) { return this.store.listArtifacts(taskId || null); }
  async artifact(id) { return this.store.getArtifact(id); }
  async providersList() { return (await this.store.listProviders()).map(safeProviderRecord); }

  async probeProvider(id, actor = 'api') {
    const adapter = this.providers.get(id);
    if (!adapter) throw Object.assign(new Error(`Unknown provider: ${id}`),{code:'unknown_provider'});
    try {
      const record = await adapter.probe();
      const saved = await this.store.upsertProvider({...record,lastProbeAt:new Date().toISOString()});
      await this.store.audit(null,'provider.probed',actor,{provider:id,status:saved.status});
      return safeProviderRecord(saved);
    } catch (error) {
      const config = adapter.configuration();
      const saved = await this.store.upsertProvider({...config,status:'connection_failed',detail:safeError(error),lastProbeAt:new Date().toISOString()});
      await this.store.audit(null,'provider.probe_failed',actor,{provider:id,error:safeError(error)});
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
      const submitted = await this.submit({command:'Phase 1 harmless remote execution verification',provider:'wilkerson',operation:'gateway.verify',requestedBy:'system:self-test'});
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
    const headers = {Authorization:`Bearer ${this.authToken}`,'Content-Type':'application/json'};
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
      const result = await adapter.execute(task);
      const verification = await adapter.verify(task,result);
      if (!verification?.verified) throw Object.assign(new Error('Provider result verification failed'),{code:'verification_failed'});
      const content = {taskId:task.id,provider:task.provider,operation:task.operation,result,verification};
      const artifact = {id:randomUUID(),taskId:task.id,kind:'execution_result',name:`task-${task.id}-result.json`,mediaType:'application/json',content,sha256:crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex'),createdAt:new Date().toISOString()};
      await this.store.createArtifact(artifact);
      await adapter.release(task,lease);
      await this.store.releaseLease(lease.id,task.id,{outcome:'succeeded'});
      return this.store.completeTask(task.id,result,verification);
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
  const layer = new ExecutionLayer({store:store || new PostgresStore(databaseUrl),providers:createProviderRegistry(env),authToken,pollMs:env.WORKER_POLL_MS,leaseSeconds:env.WORKER_LEASE_SECONDS,workerId:env.WORKER_ID,selfTestOnBoot:String(env.EXECUTION_SELF_TEST_ON_BOOT || '').toLowerCase()==='true'});
  return layer.init({startWorker});
}
