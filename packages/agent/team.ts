import { runAgent } from './index.ts';
import type { ModelAdapter, Tool } from './index.ts';

export type AgentService = { id: string; description: string; principals: readonly string[] };
/** Model-visible output must be schema-selected by the host; never return raw merchant bodies or credentials. */
export type ServiceReceipt = { orderId: string; transactionId: string; digest: string; summary: string };
export type TeamMember = { principalId: string; model: (previous: readonly { principalId: string; output: unknown }[]) => ModelAdapter };
export type TeamOptions = {
 services: readonly AgentService[];
 members: readonly TeamMember[];
 /** Host binds principal and service to an immutable offer and durable controller; models supply neither. */
 purchase: (principalId: string, serviceId: string, signal: AbortSignal) => Promise<ServiceReceipt>;
 maxPurchases: number;
 maxSteps: number;
 /** Deadline per member; a team runs at most members.length times this duration. */
 timeoutMs: number;
};
/** Sequential peer handoff with host-pinned capabilities. Purchase attempts are coalesced, including failures. */
export async function runAgentTeam(options: TeamOptions): Promise<{ principalId: string; output: unknown }[]> {
 const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
 if (!Number.isInteger(options.maxPurchases) || options.maxPurchases < 0 || options.maxPurchases > 100 || !options.members.length || options.members.length > 16 || options.services.length > 64) throw new Error('Invalid team limits');
 const members = [...options.members], services = structuredClone(options.services);
 if (members.some(member => !validId(member.principalId)) || new Set(members.map(member => member.principalId)).size !== members.length || services.some(service => !validId(service.id) || typeof service.description !== 'string' || service.description.length > 1024 || !Array.isArray(service.principals) || service.principals.some(id => !validId(id))) || new Set(services.map(service => service.id)).size !== services.length) throw new Error('Invalid team catalog');
 const results: { principalId: string; output: unknown }[] = [], attempts = new Map<string, Promise<ServiceReceipt>>();
 let purchaseCount = 0;
 for (const member of members) {
  const available = services.filter(service => service.principals.includes(member.principalId));
  const tools: Record<string, Tool> = {
   list_services: async () => available.map(({ id, description }) => ({ id, description })),
   purchase_service: async (input, signal) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'serviceId')) throw new Error('Expected only serviceId');
    const serviceId = (input as { serviceId: unknown }).serviceId;
    if (!validId(serviceId) || !available.some(service => service.id === serviceId)) throw new Error('Service is not granted to this principal');
    signal.throwIfAborted();
    const key = member.principalId + ':' + serviceId;
    if (!attempts.has(key)) {
     if (purchaseCount >= options.maxPurchases) throw new Error('Team purchase limit reached');
     purchaseCount++;
     // Retain rejected/uncertain attempts: no implicit new issuance after a timeout or failure.
     attempts.set(key, Promise.resolve().then(() => { signal.throwIfAborted(); return options.purchase(member.principalId, serviceId, signal); }).then(receipt => {
      const selected = { orderId: receipt.orderId, transactionId: receipt.transactionId, digest: receipt.digest, summary: receipt.summary };
      if (Object.values(selected).some(value => typeof value !== 'string') || selected.summary.length > 8192 || !/^[a-f0-9]{64}$/.test(selected.digest) || selected.orderId.length > 256 || selected.transactionId.length > 256) throw new Error('Invalid host receipt projection');
      return selected;
     }).catch(() => { throw new Error('Purchase unresolved; retain the same operation and recover through the host'); }));
    }
    return structuredClone(await attempts.get(key)!);
   },
  };
  const completed = await runAgent(member.model(structuredClone(results)), tools, { maxSteps: options.maxSteps, timeoutMs: options.timeoutMs });
  const output = JSON.stringify(completed.output);
  if (output === undefined || Buffer.byteLength(output) > 16384) throw new Error('Team handoff exceeds limit');
  results.push({ principalId: member.principalId, output: JSON.parse(output) });
 }
 return results;
}
