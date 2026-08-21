import {PROVENANCE, SECURITY_POLICY_VERSION} from './security.js';

const consequentialPattern = /\b(send|publish|post|message|email|buy|purchase|pay|charge|refund|transfer|delete|remove|destroy|deploy|release|credential|password|secret|account|permission|invite|contract|sign|submit|book|schedule|cancel appointment|install|execute|run command|change policy|disable security)\b/i;

const routineOperations = new Set([
  'gateway.verify',
  'system.echo',
  'modules.capabilities',
  'provider.probe',
  'providers.list'
]);

export function evaluatePolicy({command = '', operation = '', provider = 'wilkerson'}) {
  const reasons = [];
  let requiresApproval = false;

  if (consequentialPattern.test(command) || consequentialPattern.test(operation)) {
    requiresApproval = true;
    reasons.push('consequential_action');
  }

  if (!routineOperations.has(operation) && provider !== 'wilkerson') {
    requiresApproval = true;
    reasons.push('external_provider_write_or_unknown_operation');
  }

  return {
    decision: requiresApproval ? 'approval_required' : 'allow',
    requiresApproval,
    reasons,
    commandClassification:PROVENANCE.TRUSTED_COMMAND,
    externalContentClassification:PROVENANCE.UNTRUSTED_EXTERNAL_CONTENT,
    externalContentMayAuthorize:false,
    policyVersion:SECURITY_POLICY_VERSION
  };
}

export function isTerminalStatus(status) {
  return ['succeeded', 'failed', 'cancelled', 'denied', 'security_blocked'].includes(status);
}
