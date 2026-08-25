import {randomUUID} from 'node:crypto';

const consentValues = new Set(['self','authorized','synthetic']);
const providers = new Set(['tavus','wilkerson-local','unreal','other']);

function cleanText(value, max, field, required = false) {
  const text = String(value || '').trim();
  if (required && !text) throw Object.assign(new Error(`${field} is required.`),{code:'invalid_avatar_input'});
  return text.slice(0,max);
}

export class AvatarService {
  constructor(store) { this.store = store; }

  async createProfile(input = {}, actor = 'unknown') {
    const consent = cleanText(input.likenessConsent,32,'likenessConsent',true);
    if (!consentValues.has(consent)) throw Object.assign(new Error('likenessConsent must be self, authorized, or synthetic.'),{code:'invalid_avatar_consent'});
    const provider = providers.has(input.provider) ? input.provider : 'wilkerson-local';
    const profile = {
      id:randomUUID(),
      name:cleanText(input.name,120,'name',true),
      provider,
      providerPersonaId:cleanText(input.providerPersonaId,160,'providerPersonaId'),
      providerReplicaId:cleanText(input.providerReplicaId,160,'providerReplicaId'),
      voiceProfile:cleanText(input.voiceProfile,160,'voiceProfile'),
      systemPrompt:cleanText(input.systemPrompt,16_000,'systemPrompt'),
      knowledgeTags:Array.isArray(input.knowledgeTags) ? input.knowledgeTags.map(value=>cleanText(value,80,'knowledgeTag')).filter(Boolean).slice(0,50) : [],
      capabilities:['conversation','speech','agent_tools'],
      likenessConsent:consent,
      consentReference:cleanText(input.consentReference,500,'consentReference'),
      status:'ready_for_provider',
      createdBy:actor,
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    return this.store.createAvatarProfile(profile);
  }

  listProfiles() { return this.store.listAvatarProfiles(); }
  getProfile(id) { return this.store.getAvatarProfile(id); }

  async createSession(input = {}, actor = 'unknown') {
    const avatarId = cleanText(input.avatarId,64,'avatarId',true);
    const avatar = await this.store.getAvatarProfile(avatarId);
    if (!avatar) throw Object.assign(new Error('Avatar profile not found.'),{code:'avatar_not_found'});
    const session = {
      id:randomUUID(),avatarId,provider:avatar.provider,
      providerSessionId:cleanText(input.providerSessionId,160,'providerSessionId'),
      conversationUrl:cleanText(input.conversationUrl,2_000,'conversationUrl'),
      status:input.status === 'active' ? 'active' : 'prepared',
      context:cleanText(input.context,12_000,'context'),
      createdBy:actor,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),endedAt:null
    };
    return this.store.createAvatarSession(session);
  }

  listSessions(avatarId = null) { return this.store.listAvatarSessions(avatarId); }

  async endSession(id, actor = 'unknown') {
    const session = await this.store.updateAvatarSession(id,{status:'ended',endedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),endedBy:actor});
    if (!session) throw Object.assign(new Error('Avatar session not found.'),{code:'avatar_session_not_found'});
    return session;
  }
}
