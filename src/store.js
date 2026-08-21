import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {deepRedact} from './security.js';

const schema = `
CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  label text NOT NULL,
  status text NOT NULL,
  missing_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  credential_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  isolation jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail jsonb,
  last_probe_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  command text NOT NULL,
  provider_id text NOT NULL,
  operation text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by text NOT NULL,
  status text NOT NULL,
  policy jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  security_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  result jsonb,
  verification jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_queue_idx ON tasks(status, run_after, created_at);
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason jsonb NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  decision_note text
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals(status, requested_at);
CREATE TABLE IF NOT EXISTS audits (
  id bigserial PRIMARY KEY,
  task_id uuid,
  event text NOT NULL,
  actor text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audits_task_idx ON audits(task_id, id);
CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  media_type text NOT NULL,
  content jsonb NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(task_id, created_at);
CREATE TABLE IF NOT EXISTS provider_leases (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  status text NOT NULL,
  lease_owner text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS leases_active_idx ON provider_leases(provider_id, status);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS credential_scope jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS isolation jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS security_context jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS security_state (
  id text PRIMARY KEY,
  kill_switch_active boolean NOT NULL DEFAULT false,
  indicator_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  killed_at timestamptz,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO security_state (id) VALUES ('concierge') ON CONFLICT (id) DO NOTHING;
`;

function mapTask(row) {
  if (!row) return null;
  return {
    id:row.id, command:row.command, provider:row.provider_id, operation:row.operation,
    input:row.input, requestedBy:row.requested_by, status:row.status, policy:row.policy,
    provenance:row.provenance, securityContext:row.security_context,
    attempts:row.attempts, result:row.result, verification:row.verification, error:row.error,
    cancelRequestedAt:row.cancel_requested_at, createdAt:row.created_at, updatedAt:row.updated_at,
    startedAt:row.started_at, completedAt:row.completed_at
  };
}

function mapSecurityState(row) {
  if (!row) return {killSwitchActive:false,indicatorCount:0};
  return {killSwitchActive:row.kill_switch_active,indicatorCount:row.indicator_count,windowStartedAt:row.window_started_at,killedAt:row.killed_at,reason:row.reason,updatedAt:row.updated_at};
}

function mapApproval(row) {
  if (!row) return null;
  return {id:row.id, taskId:row.task_id, status:row.status, reason:row.reason, requestedAt:row.requested_at, decidedAt:row.decided_at, decidedBy:row.decided_by, decisionNote:row.decision_note};
}

export class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new Pool({connectionString:databaseUrl, max:8, idleTimeoutMillis:20_000, connectionTimeoutMillis:10_000});
    this.kind = 'postgresql';
  }

  async init() {
    await this.pool.query(schema);
  }

  async close() {
    await this.pool.end();
  }

  async ping() {
    const result = await this.pool.query('SELECT now() AS now');
    return result.rows[0];
  }

  async upsertProvider(provider) {
    const result = await this.pool.query(`
      INSERT INTO providers (id,label,status,missing_config,capabilities,credential_scope,isolation,detail,last_probe_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (id) DO UPDATE SET label=excluded.label,status=excluded.status,missing_config=excluded.missing_config,capabilities=excluded.capabilities,credential_scope=excluded.credential_scope,isolation=excluded.isolation,detail=excluded.detail,last_probe_at=excluded.last_probe_at,updated_at=now()
      RETURNING *`, [provider.id,provider.label,provider.status,JSON.stringify(provider.missingConfig || []),JSON.stringify(provider.capabilities || []),JSON.stringify(provider.credentialScope || []),JSON.stringify(provider.isolation || {}),provider.detail ? JSON.stringify(deepRedact(provider.detail)) : null,provider.lastProbeAt || null]);
    return this.mapProvider(result.rows[0]);
  }

  mapProvider(row) {
    return {id:row.id,label:row.label,status:row.status,missingConfig:row.missing_config,capabilities:row.capabilities,credentialScope:row.credential_scope,isolation:row.isolation,detail:row.detail,lastProbeAt:row.last_probe_at,updatedAt:row.updated_at};
  }

  async listProviders() {
    const result = await this.pool.query('SELECT * FROM providers ORDER BY id');
    return result.rows.map(row => this.mapProvider(row));
  }

  async createTask(task, approvalReason) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tasks (id,command,provider_id,operation,input,requested_by,status,policy,provenance,security_context) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [task.id,task.command,task.provider,task.operation,JSON.stringify(deepRedact(task.input || {})),task.requestedBy,task.status,JSON.stringify(task.policy),JSON.stringify(task.provenance || {}),JSON.stringify(deepRedact(task.securityContext || {}))]);
      let approval = null;
      if (approvalReason) {
        const approvalId = randomUUID();
        const result = await client.query(`INSERT INTO approvals (id,task_id,status,reason) VALUES ($1,$2,'pending',$3) RETURNING *`, [approvalId,task.id,JSON.stringify(approvalReason)]);
        approval = mapApproval(result.rows[0]);
      }
      await client.query(`INSERT INTO audits (task_id,event,actor,data) VALUES ($1,'task.submitted',$2,$3)`, [task.id,task.requestedBy,JSON.stringify({provider:task.provider,operation:task.operation,status:task.status,policy:task.policy,provenance:{classification:task.provenance?.classification,channel:task.provenance?.channel,principal:task.provenance?.principal,agentId:task.provenance?.agentId,scope:task.provenance?.scope,timestamp:task.provenance?.timestamp}})]);
      await client.query('COMMIT');
      return {task:await this.getTask(task.id), approval};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getTask(id) {
    const result = await this.pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
    return mapTask(result.rows[0]);
  }

  async claimNextTask(workerId, leaseSeconds) {
    const result = await this.pool.query(`
      WITH candidate AS (
        SELECT id FROM tasks
        WHERE (status='queued' OR (status='running' AND lease_expires_at < now()))
          AND run_after <= now() AND cancel_requested_at IS NULL
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE tasks t
      SET status='running', lease_owner=$1, lease_expires_at=now()+($2::text || ' seconds')::interval,
          attempts=t.attempts+1, started_at=COALESCE(t.started_at,now()), updated_at=now()
      FROM candidate WHERE t.id=candidate.id RETURNING t.*`, [workerId,String(leaseSeconds)]);
    const task = mapTask(result.rows[0]);
    if (task) await this.audit(task.id,'task.leased','worker',{workerId,attempt:task.attempts});
    return task;
  }

  async createLease(taskId, providerId, workerId) {
    const id = randomUUID();
    await this.pool.query(`INSERT INTO provider_leases (id,task_id,provider_id,status,lease_owner) VALUES ($1,$2,$3,'active',$4)`, [id,taskId,providerId,workerId]);
    await this.audit(taskId,'provider.lease_acquired','worker',{leaseId:id,provider:providerId,workerId});
    return {id,taskId,provider:providerId,status:'active',workerId};
  }

  async releaseLease(id, taskId, metadata = {}) {
    await this.pool.query(`UPDATE provider_leases SET status='released',released_at=now(),metadata=$2 WHERE id=$1`, [id,JSON.stringify(metadata)]);
    await this.audit(taskId,'provider.lease_released','worker',{leaseId:id,...metadata});
  }

  async completeTask(id, result, verification) {
    const query = await this.pool.query(`UPDATE tasks SET status='succeeded',result=$2,verification=$3,completed_at=now(),updated_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND status='running' RETURNING *`, [id,JSON.stringify(deepRedact(result)),JSON.stringify(deepRedact(verification))]);
    await this.audit(id,'task.succeeded','worker',{verification});
    return mapTask(query.rows[0]);
  }

  async failTask(id, error) {
    const safeError = {code:error.code || 'execution_failed',message:error.message || 'Execution failed'};
    const query = await this.pool.query(`UPDATE tasks SET status='failed',error=$2,completed_at=now(),updated_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 RETURNING *`, [id,JSON.stringify(safeError)]);
    await this.audit(id,'task.failed','worker',safeError);
    return mapTask(query.rows[0]);
  }

  async cancelTask(id, actor) {
    const result = await this.pool.query(`UPDATE tasks SET status=CASE WHEN status IN ('queued','awaiting_approval') THEN 'cancelled' ELSE status END,cancel_requested_at=now(),completed_at=CASE WHEN status IN ('queued','awaiting_approval') THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1 AND status NOT IN ('succeeded','failed','cancelled','denied') RETURNING *`, [id]);
    if (result.rows[0]) await this.audit(id,'task.cancel_requested',actor,{});
    return mapTask(result.rows[0]);
  }

  async listApprovals(status = 'pending', limit = 50) {
    const result = await this.pool.query(`SELECT * FROM approvals WHERE ($1='' OR status=$1) ORDER BY requested_at DESC LIMIT $2`, [status,limit]);
    return result.rows.map(mapApproval);
  }

  async decideApproval(id, decision, actor, note) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const approvalResult = await client.query(`UPDATE approvals SET status=$2,decided_at=now(),decided_by=$3,decision_note=$4 WHERE id=$1 AND status='pending' RETURNING *`, [id,decision,actor,note || null]);
      const approval = mapApproval(approvalResult.rows[0]);
      if (!approval) { await client.query('ROLLBACK'); return null; }
      const taskStatus = decision === 'approved' ? 'queued' : 'denied';
      await client.query(`UPDATE tasks SET status=$2,completed_at=CASE WHEN $2='denied' THEN now() ELSE completed_at END,updated_at=now() WHERE id=$1 AND status='awaiting_approval'`, [approval.taskId,taskStatus]);
      await client.query(`INSERT INTO audits (task_id,event,actor,data) VALUES ($1,'approval.decided',$2,$3)`, [approval.taskId,actor,JSON.stringify({approvalId:id,decision,note:note || null})]);
      await client.query('COMMIT');
      return {approval,task:await this.getTask(approval.taskId)};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async audit(taskId, event, actor, data = {}) {
    const result = await this.pool.query(`INSERT INTO audits (task_id,event,actor,data) VALUES ($1,$2,$3,$4) RETURNING *`, [taskId || null,event,actor,JSON.stringify(deepRedact(data))]);
    return result.rows[0];
  }

  async getSecurityState() {
    const result = await this.pool.query(`SELECT * FROM security_state WHERE id='concierge'`);
    return mapSecurityState(result.rows[0]);
  }

  async recordSecuritySignal({taskId = null, actor = 'security', signalWeight = 1, threshold = 6, windowSeconds = 600, indicators = []} = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(`SELECT * FROM security_state WHERE id='concierge' FOR UPDATE`);
      const current = currentResult.rows[0];
      const expired = Date.now() - new Date(current.window_started_at).getTime() > Number(windowSeconds) * 1000;
      const count = (expired ? 0 : current.indicator_count) + Math.max(1,Number(signalWeight) || 1);
      const activate = current.kill_switch_active || count >= Math.max(1,Number(threshold) || 6);
      const updated = await client.query(`UPDATE security_state SET kill_switch_active=$1,indicator_count=$2,window_started_at=CASE WHEN $3 THEN now() ELSE window_started_at END,killed_at=CASE WHEN $1 AND killed_at IS NULL THEN now() ELSE killed_at END,reason=CASE WHEN $1 THEN 'repeated_injection_or_malware_indicators' ELSE reason END,updated_at=now() WHERE id='concierge' RETURNING *`, [activate,count,expired]);
      if (activate && !current.kill_switch_active) {
        await client.query(`UPDATE tasks SET status='cancelled',cancel_requested_at=now(),completed_at=now(),updated_at=now(),lease_owner=NULL,lease_expires_at=NULL WHERE status IN ('queued','awaiting_approval','running')`);
        await client.query(`INSERT INTO audits (task_id,event,actor,data) VALUES ($1,'security.kill_switch_activated',$2,$3)`,[taskId,actor,JSON.stringify({reason:'repeated_injection_or_malware_indicators',indicatorCount:count,indicators:[...new Set(indicators)]})]);
      }
      await client.query('COMMIT');
      return mapSecurityState(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async listAudit(taskId, limit = 100) {
    const result = await this.pool.query(`SELECT * FROM audits WHERE ($1::uuid IS NULL OR task_id=$1) ORDER BY id DESC LIMIT $2`, [taskId || null,limit]);
    return result.rows.map(row => ({id:row.id,taskId:row.task_id,event:row.event,actor:row.actor,data:row.data,createdAt:row.created_at}));
  }

  async createArtifact(artifact) {
    await this.pool.query(`INSERT INTO artifacts (id,task_id,kind,name,media_type,content,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [artifact.id,artifact.taskId,artifact.kind,artifact.name,artifact.mediaType,JSON.stringify(deepRedact(artifact.content)),artifact.sha256]);
    await this.audit(artifact.taskId,'artifact.created','worker',{artifactId:artifact.id,kind:artifact.kind,sha256:artifact.sha256});
    return artifact;
  }

  async getArtifact(id) {
    const result = await this.pool.query('SELECT * FROM artifacts WHERE id=$1', [id]);
    const row = result.rows[0];
    return row ? {id:row.id,taskId:row.task_id,kind:row.kind,name:row.name,mediaType:row.media_type,content:row.content,sha256:row.sha256,createdAt:row.created_at} : null;
  }

  async listArtifacts(taskId, limit = 50) {
    const result = await this.pool.query(`SELECT * FROM artifacts WHERE ($1::uuid IS NULL OR task_id=$1) ORDER BY created_at DESC LIMIT $2`, [taskId || null,limit]);
    return result.rows.map(row => ({id:row.id,taskId:row.task_id,kind:row.kind,name:row.name,mediaType:row.media_type,sha256:row.sha256,createdAt:row.created_at}));
  }
}

export class MemoryStore {
  constructor() {
    this.kind = 'memory-test';
    this.providers = new Map(); this.tasks = new Map(); this.approvals = new Map(); this.audits = []; this.artifacts = new Map(); this.leases = new Map();
    this.securityState = {killSwitchActive:false,indicatorCount:0,windowStartedAt:new Date().toISOString(),killedAt:null,reason:null,updatedAt:new Date().toISOString()};
  }
  async init() {}
  async close() {}
  async ping() { return {now:new Date()}; }
  async upsertProvider(provider) { const value={...provider,updatedAt:new Date().toISOString()}; this.providers.set(provider.id,value); return value; }
  async listProviders() { return [...this.providers.values()].sort((a,b)=>a.id.localeCompare(b.id)); }
  async createTask(task, approvalReason) { this.tasks.set(task.id,{...structuredClone(deepRedact(task)),attempts:0,createdAt:new Date().toISOString()}); let approval=null; if(approvalReason){approval={id:randomUUID(),taskId:task.id,status:'pending',reason:approvalReason,requestedAt:new Date().toISOString()};this.approvals.set(approval.id,approval);} await this.audit(task.id,'task.submitted',task.requestedBy,{status:task.status,provenance:task.provenance}); return {task:structuredClone(this.tasks.get(task.id)),approval}; }
  async getTask(id) { return this.tasks.get(id) || null; }
  async claimNextTask(workerId) { const task=[...this.tasks.values()].find(item=>item.status==='queued'); if(!task)return null; Object.assign(task,{status:'running',attempts:task.attempts+1,startedAt:new Date().toISOString()}); await this.audit(task.id,'task.leased','worker',{workerId}); return structuredClone(task); }
  async createLease(taskId,provider,workerId){const lease={id:randomUUID(),taskId,provider,status:'active',workerId};this.leases.set(lease.id,lease);await this.audit(taskId,'provider.lease_acquired','worker',{leaseId:lease.id,provider});return lease;}
  async releaseLease(id,taskId,metadata={}){Object.assign(this.leases.get(id),{status:'released',metadata});await this.audit(taskId,'provider.lease_released','worker',{leaseId:id});}
  async completeTask(id,result,verification){const task=this.tasks.get(id);Object.assign(task,{status:'succeeded',result:deepRedact(result),verification:deepRedact(verification),completedAt:new Date().toISOString()});await this.audit(id,'task.succeeded','worker',{verification});return structuredClone(task);}
  async failTask(id,error){const task=this.tasks.get(id);Object.assign(task,{status:'failed',error:{code:error.code||'execution_failed',message:error.message},completedAt:new Date().toISOString()});await this.audit(id,'task.failed','worker',task.error);return structuredClone(task);}
  async cancelTask(id,actor){const task=this.tasks.get(id);if(!task)return null;if(['queued','awaiting_approval'].includes(task.status))task.status='cancelled';task.cancelRequestedAt=new Date().toISOString();await this.audit(id,'task.cancel_requested',actor,{});return structuredClone(task);}
  async listApprovals(status='pending'){return [...this.approvals.values()].filter(item=>!status||item.status===status);}
  async decideApproval(id,decision,actor,note){const approval=this.approvals.get(id);if(!approval||approval.status!=='pending')return null;Object.assign(approval,{status:decision,decidedBy:actor,decisionNote:note,decidedAt:new Date().toISOString()});const task=this.tasks.get(approval.taskId);task.status=decision==='approved'?'queued':'denied';await this.audit(task.id,'approval.decided',actor,{decision});return {approval:structuredClone(approval),task:structuredClone(task)};}
  async audit(taskId,event,actor,data={}){const item={id:this.audits.length+1,taskId,event,actor,data:deepRedact(data),createdAt:new Date().toISOString()};this.audits.push(item);return item;}
  async getSecurityState(){return structuredClone(this.securityState);}
  async recordSecuritySignal({taskId=null,actor='security',signalWeight=1,threshold=6,windowSeconds=600,indicators=[]}={}){const expired=Date.now()-new Date(this.securityState.windowStartedAt).getTime()>Number(windowSeconds)*1000;if(expired){this.securityState.indicatorCount=0;this.securityState.windowStartedAt=new Date().toISOString();}this.securityState.indicatorCount+=Math.max(1,Number(signalWeight)||1);if(!this.securityState.killSwitchActive&&this.securityState.indicatorCount>=Math.max(1,Number(threshold)||6)){this.securityState.killSwitchActive=true;this.securityState.killedAt=new Date().toISOString();this.securityState.reason='repeated_injection_or_malware_indicators';for(const task of this.tasks.values()){if(['queued','awaiting_approval','running'].includes(task.status)){task.status='cancelled';task.completedAt=new Date().toISOString();}}await this.audit(taskId,'security.kill_switch_activated',actor,{reason:this.securityState.reason,indicatorCount:this.securityState.indicatorCount,indicators});}this.securityState.updatedAt=new Date().toISOString();return structuredClone(this.securityState);}
  async listAudit(taskId){return this.audits.filter(item=>!taskId||item.taskId===taskId).reverse();}
  async createArtifact(artifact){const safe=deepRedact(artifact);this.artifacts.set(artifact.id,safe);await this.audit(artifact.taskId,'artifact.created','worker',{artifactId:artifact.id});return safe;}
  async getArtifact(id){return this.artifacts.get(id)||null;}
  async listArtifacts(taskId){return [...this.artifacts.values()].filter(item=>!taskId||item.taskId===taskId).map(({content,...item})=>item);}
}
