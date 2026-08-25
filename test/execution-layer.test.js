import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionLayer} from '../src/execution-layer.js';
import {MemoryStore} from '../src/store.js';
import {handleMcp} from '../src/mcp.js';

function testEnv() {
  return {GATEWAY_API_TOKEN:'test-token',WORKER_POLL_MS:'10',WORKER_LEASE_SECONDS:'30'};
}

function commandContext(layer, principal = 'test-principal') {
  return layer.createAuthenticatedContext({principal,agentId:'test-agent',transport:'test'});
}

test('harmless task completes through queue, lease, verification, artifact and audit', async () => {
  const layer = await createExecutionLayer({env:testEnv(),store:new MemoryStore(),startWorker:false});
  const submitted = await layer.submit({command:'Verify Phase 1 execution path',provider:'wilkerson',operation:'gateway.verify'},commandContext(layer));
  assert.equal(submitted.task.status,'queued');
  const completed = await layer.processOne();
  assert.equal(completed.status,'succeeded');
  assert.equal(completed.verification.verified,true);
  const result = await layer.result(completed.id);
  assert.equal(result.artifacts.length,1);
  const events = (await layer.audit(completed.id)).map(item=>item.event);
  for (const expected of ['task.submitted','task.leased','provider.lease_acquired','task.execution_started','artifact.created','provider.lease_released','task.succeeded']) assert.ok(events.includes(expected),expected);
  await layer.close();
});

test('consequential task pauses until explicit approval', async () => {
  const layer = await createExecutionLayer({env:testEnv(),store:new MemoryStore(),startWorker:false});
  const context = commandContext(layer);
  const submitted = await layer.submit({command:'Publish this message',provider:'wilkerson',operation:'system.echo'},context);
  assert.equal(submitted.task.status,'awaiting_approval');
  assert.equal((await layer.processOne()),null);
  const decision = await layer.decideApproval(submitted.approval.id,'approved',context,'approved for test');
  assert.equal(decision.task.status,'queued');
  const completed = await layer.processOne();
  assert.equal(completed.status,'succeeded');
  await layer.close();
});

test('unconfigured providers report configuration_required and are not connected', async () => {
  const layer = await createExecutionLayer({env:testEnv(),store:new MemoryStore(),startWorker:false});
  const providers = await layer.providersList();
  assert.equal(providers.find(item=>item.id==='wilkerson').status,'connected');
  assert.equal(providers.find(item=>item.id==='orgo').status,'configuration_required');
  assert.ok(providers.find(item=>item.id==='orgo').missingConfig.includes('ORGO_API_KEY'));
  assert.equal(providers.find(item=>item.id==='tavus').status,'configuration_required');
  assert.ok(providers.find(item=>item.id==='tavus').capabilities.includes('conversation.create'));
  assert.ok(providers.find(item=>item.id==='tavus').missingConfig.includes('TAVUS_API_KEY'));
  await layer.close();
});

test('Tavus conversation creation is agent-callable but pauses for approval', async () => {
  const env = {...testEnv(),TAVUS_API_KEY:'test-tavus-key',TAVUS_PERSONA_ID:'persona_test',TAVUS_REPLICA_ID:'replica_test'};
  const layer = await createExecutionLayer({env,store:new MemoryStore(),startWorker:false});
  const submitted = await layer.submit({command:'Create a real-time avatar conversation',provider:'tavus',operation:'conversation.create',input:{name:'Acceptance session',testMode:true}},commandContext(layer));
  assert.equal(submitted.task.status,'awaiting_approval');
  assert.ok(submitted.approval);
  await layer.close();
});

test('MCP initializes, lists tools and calls read-only health', async () => {
  const layer = await createExecutionLayer({env:testEnv(),store:new MemoryStore(),startWorker:false});
  const context = commandContext(layer);
  const initialized = await handleMcp(layer,{jsonrpc:'2.0',id:1,method:'initialize',params:{}});
  assert.equal(initialized.result.serverInfo.name,'wilkerson-sovereign-stack');
  const listed = await handleMcp(layer,{jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert.ok(listed.result.tools.some(tool=>tool.name==='task_submit'));
  const called = await handleMcp(layer,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'health_get',arguments:{}}},context);
  assert.equal(called.result.structuredContent.ok,true);
  await layer.close();
});

test('boot self-test publishes non-secret end-to-end evidence', async () => {
  const env = {...testEnv(),EXECUTION_SELF_TEST_ON_BOOT:'true'};
  const layer = await createExecutionLayer({env,store:new MemoryStore(),startWorker:true});
  void layer.runSelfTest();
  const deadline = Date.now()+3000;
  let health = await layer.health();
  while (health.selfTest.status==='running' && Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,20));
    health = await layer.health();
  }
  assert.equal(health.selfTest.status,'passed');
  assert.equal(health.selfTest.verification.verified,true);
  assert.equal(health.selfTest.artifactCount,1);
  assert.ok(health.selfTest.auditEvents.includes('provider.lease_released'));
  await layer.close();
});
