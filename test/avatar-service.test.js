import test from 'node:test';
import assert from 'node:assert/strict';
import {AvatarService} from '../src/avatar-service.js';
import {MemoryStore} from '../src/store.js';
import {createExecutionLayer} from '../src/execution-layer.js';
import {handleMcp} from '../src/mcp.js';

test('avatar profiles require an explicit lawful likeness basis and persist', async () => {
  const store = new MemoryStore();
  const service = new AvatarService(store);
  await assert.rejects(()=>service.createProfile({name:'Unconsented person'}),error=>error.code==='invalid_avatar_input');
  const profile = await service.createProfile({name:'WISDOM Human Guide',provider:'tavus',providerPersonaId:'persona_1',providerReplicaId:'replica_1',likenessConsent:'synthetic',systemPrompt:'Be a helpful production guide.'},'founder');
  assert.equal(profile.name,'WISDOM Human Guide');
  assert.equal(profile.likenessConsent,'synthetic');
  assert.equal((await service.listProfiles()).length,1);
  assert.equal((await service.getProfile(profile.id)).providerReplicaId,'replica_1');
});

test('avatar sessions retain reusable identity and lifecycle state', async () => {
  const store = new MemoryStore();
  const service = new AvatarService(store);
  const profile = await service.createProfile({name:'Founder Guide',provider:'tavus',likenessConsent:'self'},'founder');
  const session = await service.createSession({avatarId:profile.id,providerSessionId:'conversation_1',conversationUrl:'https://example.invalid/session',status:'active',context:'Guide the user.'},'founder');
  assert.equal(session.avatarId,profile.id);
  assert.equal(session.status,'active');
  assert.equal((await service.listSessions(profile.id)).length,1);
  const ended = await service.endSession(session.id,'founder');
  assert.equal(ended.status,'ended');
  assert.equal(ended.endedBy,'founder');
});

test('authorized agents can create and list reusable avatars through MCP', async () => {
  const layer = await createExecutionLayer({env:{GATEWAY_API_TOKEN:'test-token'},store:new MemoryStore(),startWorker:false});
  const context = layer.createAuthenticatedContext({principal:'avatar-agent',agentId:'casting-agent',transport:'test',scope:['avatar:read','avatar:write']});
  const created = await handleMcp(layer,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'avatar_profile_create',arguments:{name:'Synthetic Host',provider:'wilkerson-local',likeness_consent:'synthetic'}}},context);
  assert.equal(created.result.structuredContent.name,'Synthetic Host');
  const listed = await handleMcp(layer,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'avatar_profiles_list',arguments:{}}},context);
  assert.equal(listed.result.structuredContent.length,1);
  await layer.close();
});
