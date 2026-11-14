import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { atomic, canonical, fingerprint, sha256, timestamp } from '../core/index.ts';
import type { Policy, Offer, Order, Usage, Decision, SettlementEvidence } from '../core/index.ts';
import { validatePolicy, evaluatePolicy } from '../policy/index.ts';

type Row = { id: string; principal: string; offer: string; fingerprint: string; policy_version: string; payment: Order['paymentState']; delivery: Order['deliveryState']; payload: string | null; payload_hash: string | null; transaction_id: string | null; result: string | null; created_at: string };
export type OwnerRevisionApproval = { expectedOrderId: string; expectedRevision: string };
export type Authorization = { kind: 'authorized' | 'replay' | 'denied' | 'awaiting_approval'; decision: Decision; order?: Order };

/** Trusted control-service component. Never expose this DB or signer methods to an agent. */
export class Ledger {
  private db: DatabaseSync;
  private policyState: Policy;
  readonly storagePath: string;
  get policy(): Policy { return structuredClone(this.policyState); }
  constructor(path: string, input: unknown) {
    this.storagePath = path;
    this.policyState = structuredClone(validatePolicy(input));
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, principal TEXT NOT NULL, offer TEXT NOT NULL, fingerprint TEXT NOT NULL, policy_version TEXT NOT NULL, payment TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT 'not_delivered', payload TEXT, payload_hash TEXT UNIQUE, transaction_id TEXT UNIQUE, result TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operation_heads (key TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id));
      CREATE TABLE IF NOT EXISTS revision_terms (operation_key TEXT NOT NULL, revision TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(operation_key,revision));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);`);
    try { this.tx(() => {
      const current = this.db.prepare('SELECT value FROM config WHERE key=?').get('policy') as {value:string}|undefined;
      const encoded = canonical(this.policy);
      if (current && current.value !== encoded) throw new Error('Policy is pinned to this ledger; policy migration requires a separate owner-controlled implementation');
      this.db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES (?,?)').run('policy', encoded);
    }); } catch(error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private event(value: Record<string, unknown>) {
    const previous = this.db.prepare('SELECT hash FROM audit ORDER BY sequence DESC LIMIT 1').get() as {hash:string}|undefined;
    const previousHash = previous?.hash ?? '0'.repeat(64), event = canonical(value);
    this.db.prepare('INSERT INTO audit(event,previous_hash,hash) VALUES (?,?,?)').run(event, previousHash, sha256(previousHash + event));
  }
  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM orders WHERE id=?').get(id) as Row|undefined;
    if (!row) throw new Error('Order not found');
    return row;
  }
  private owned(principal: string, id: string): Row {
    const row = this.row(id);
    if (row.principal !== principal) throw new Error('Order belongs to another principal');
    return row;
  }
  private view(row: Row): Order {
    return { id: row.id, principalId: row.principal, offer: JSON.parse(row.offer), fingerprint: row.fingerprint,
      policyVersion: row.policy_version, paymentState: row.payment, deliveryState: row.delivery,
      ...(row.payload_hash ? {payloadHash:row.payload_hash} : {}), ...(row.transaction_id ? {transactionId:row.transaction_id} : {}),
      ...(row.result ? {result:JSON.parse(row.result)} : {}), createdAt:row.created_at };
  }
  private stopped(): boolean { return Boolean(this.db.prepare("SELECT value FROM config WHERE key='stopped'").get()); }
  private usage(principal: string, exclude?: string): Usage {
    const rows = this.db.prepare("SELECT id,principal,offer FROM orders WHERE payment IN ('reserved','issued','pending','settled')").all() as {id:string;principal:string;offer:string}[];
    let job=0n, agent=0n;
    for (const row of rows) { if (row.id === exclude) continue; const amount=atomic(JSON.parse(row.offer).amountAtomic); job+=amount; if (row.principal===principal) agent+=amount; }
    return { jobCommittedAtomic:job.toString(), principalCommittedAtomic:agent.toString() };
  }
  budget(principal: string): Usage { return this.usage(principal); }
  get(principal: string, id: string): Order { return this.view(this.owned(principal,id)); }
  private decision(code: string, explanation: string, allowed=false): Decision { return {allowed,code,explanation,policyVersion:this.policy.version}; }
  authorize(principal: string, offer: Offer, now = new Date(), ownerApproval?: OwnerRevisionApproval): Authorization {
    return this.tx(() => {
      if(!this.policy.grants.some(grant=>grant.principalId===principal)){this.event({type:'denied',principal,code:'unknown_principal'});return {kind:'denied',decision:this.decision('unknown_principal','Principal has no grant')};}
      // Exact authenticated replay remains available after offer/grant expiry.
      if(offer && typeof offer==='object' && ['jobId','supplierId','operationId'].every(k=>typeof (offer as any)[k]==='string')) {
        const oldKey=canonical([offer.jobId,offer.supplierId,offer.operationId]);
        const existing=this.db.prepare('SELECT order_id FROM operation_heads WHERE key=?').get(oldKey) as {order_id:string}|undefined;
        if(ownerApproval && (!existing || existing.order_id!==ownerApproval.expectedOrderId || (JSON.parse(this.row(existing.order_id).offer) as Offer).revision!==ownerApproval.expectedRevision)) {
          this.event({type:'denied',principal,code:'stale_owner_approval'});
          return {kind:'denied',decision:this.decision('stale_owner_approval','Owner approval must match this operation and its current revision')};
        }
        if(existing){const old=this.row(existing.order_id);if(old.principal!==principal)return {kind:'denied',decision:this.decision('wrong_principal','Operation belongs to another principal')};if(old.fingerprint===fingerprint(offer)) {
          if(old.payment==='deferred') {
            const decision=this.stopped()?this.decision('job_stopped','Owner stopped new spending'):evaluatePolicy(this.policy,principal,offer,this.usage(principal),now);
            if(!decision.allowed){this.event({type:'denied',principal,orderId:old.id,code:decision.code});return {kind:'denied',decision};}
            this.db.prepare("UPDATE orders SET payment='reserved' WHERE id=?").run(old.id);
            this.event({type:'reserved_again',principal,orderId:old.id});
            return {kind:'authorized',decision,order:this.view(this.row(old.id))};
          }
          this.event({type:'replay',principal,orderId:old.id});
          return {kind:'replay',decision:this.decision('replay','Existing exact terms; no new authorization',true),order:this.view(old)};
        }}
      }
      // A new authorization must pass all present-time policy checks.
      const structural = evaluatePolicy(this.policy, principal, offer, {jobCommittedAtomic:'0',principalCommittedAtomic:'0'}, now);
      if (!structural.allowed) { this.event({type:'denied',principal,code:structural.code}); return {kind:'denied',decision:structural}; }
      const key = canonical([offer.jobId,offer.supplierId,offer.operationId]);
      const head = this.db.prepare('SELECT order_id FROM operation_heads WHERE key=?').get(key) as {order_id:string}|undefined;
      const digest = fingerprint(offer);
      const previousTerms=this.db.prepare('SELECT fingerprint FROM revision_terms WHERE operation_key=? AND revision=?').get(key,offer.revision) as {fingerprint:string}|undefined;
      if(previousTerms && previousTerms.fingerprint!==digest) return {kind:'denied',decision:this.decision('terms_mutated','Previously recorded revision has different terms')};
      let superseded: string | undefined;
      if (head) {
        const old=this.owned(principal,head.order_id), oldOffer=JSON.parse(old.offer) as Offer;
        if (oldOffer.revision===offer.revision) {
          if (old.fingerprint !== digest) { this.event({type:'denied',principal,code:'terms_mutated',orderId:old.id}); return {kind:'denied',decision:this.decision('terms_mutated','Terms changed within the same operation revision')}; }
          return {kind:'replay',decision:this.decision('replay','Existing operation; no new authorization',true),order:this.view(old)};
        }
        if (['issued','pending','settled'].includes(old.payment)) return {kind:'denied',decision:this.decision('operation_locked','Reconcile the existing payment; a new revision cannot cause another charge')};
        if (previousTerms) return {kind:'denied',decision:this.decision('superseded_revision','A superseded revision cannot become current again')};
        if (!ownerApproval) return {kind:'awaiting_approval',decision:this.decision('new_revision','A new operation revision needs owner approval')};
        if(ownerApproval.expectedOrderId!==old.id || ownerApproval.expectedRevision!==oldOffer.revision) return {kind:'denied',decision:this.decision('stale_owner_approval','Owner approval refers to an old current revision')};
        if (['reserved','deferred'].includes(old.payment)) superseded=old.id;
      }
      if (this.stopped()) return {kind:'denied',decision:this.decision('job_stopped','Owner stopped new spending')};
      const decision=evaluatePolicy(this.policy,principal,offer,this.usage(principal,superseded),now);
      if (!decision.allowed) { this.event({type:'denied',principal,code:decision.code}); return {kind:'denied',decision}; }
      if(superseded) this.db.prepare("UPDATE orders SET payment='cancelled' WHERE id=?").run(superseded);
      this.db.prepare('INSERT OR IGNORE INTO revision_terms(operation_key,revision,fingerprint) VALUES (?,?,?)').run(key,offer.revision,digest);
      const id=randomUUID();
      this.db.prepare("INSERT INTO orders(id,principal,offer,fingerprint,policy_version,payment,created_at) VALUES (?,?,?,?,?,'reserved',?)").run(id,principal,canonical(offer),digest,this.policy.version,now.toISOString());
      this.db.prepare('INSERT INTO operation_heads(key,order_id) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET order_id=excluded.order_id').run(key,id);
      this.event({type:'reserved',principal,orderId:id,termsHash:digest,policyVersion:this.policy.version,amountAtomic:offer.amountAtomic});
      return {kind:'authorized',decision,order:this.view(this.row(id))};
    });
  }
  /** Only the trusted coordinator calls this. Payload commits before returning. */
  issue(principal: string, id: string, build: (order: Order) => string, now = new Date()): {payload:string;order:Order} {
    return this.tx(() => {
      const row=this.owned(principal,id);
      if (['failed','cancelled'].includes(row.payment)) throw new Error('Terminal payment cannot be issued again');
      if (row.payload) return {payload:row.payload,order:this.view(row)};
      if (row.payment!=='reserved') throw new Error('Order is not reservable for issuance');
      if (this.stopped()) throw new Error('Owner stopped new spending');
      const offer=JSON.parse(row.offer) as Offer;
      const valid=evaluatePolicy(this.policy,principal,offer,this.usage(principal,id),now);
      if (!valid.allowed) throw new Error(valid.code);
      // One shared NEAR signing account: later nonces must not overtake unresolved attempts.
      const pending=this.db.prepare("SELECT id FROM orders WHERE payment IN ('issued','pending') AND id<>? LIMIT 1").get(id);
      if (pending) throw new Error('Signer has an unresolved attempt; reconcile it before issuing another nonce');
      const payload=build(this.view(row));
      if (typeof payload!=='string' || payload.length===0 || payload.length>65536) throw new Error('Invalid signing result');
      this.db.prepare("UPDATE orders SET payment='issued',payload=?,payload_hash=? WHERE id=?").run(payload,sha256(payload),id);
      this.event({type:'issued',principal,orderId:id,payloadHash:sha256(payload)});
      return {payload,order:this.view(this.row(id))};
    });
  }
  submission(id: string, transactionId: string): Order {
    return this.tx(() => {
      const row=this.row(id);
      if (!['issued','pending'].includes(row.payment) || !row.payload_hash) throw new Error('Submission requires an issued payment');
      if (!transactionId || transactionId.length>256) throw new Error('Invalid transaction ID');
      if (row.transaction_id && row.transaction_id!==transactionId) throw new Error('Transaction identity is immutable');
      this.db.prepare("UPDATE orders SET transaction_id=?,payment='pending' WHERE id=?").run(transactionId,id);
      this.event({type:'submitted',orderId:id,transactionId});
      return this.view(this.row(id));
    });
  }
  /** Evidence must come from a trusted rail adapter, never an agent HTTP body. */
  reconcile(evidence: SettlementEvidence): Order {
    return this.tx(() => {
      if(typeof evidence.final!=='boolean'||typeof evidence.noFurtherExecution!=='boolean'||!['success','failure','unknown'].includes(evidence.outcome)) throw new Error('Invalid settlement evidence');
      const row=this.row(evidence.orderId), offer=JSON.parse(row.offer) as Offer;
      if (!row.payload_hash || row.payload_hash!==evidence.payloadHash || !row.transaction_id || row.transaction_id!==evidence.transactionId) throw new Error('Settlement identity mismatch');
      for (const field of ['network','asset','payer','payTo','amountAtomic'] as const) if (evidence[field]!==offer[field]) throw new Error('Settlement terms mismatch: '+field);
      if (!evidence.final || evidence.outcome==='unknown') return this.view(row);
      const next=evidence.outcome==='success' ? 'settled' : evidence.noFurtherExecution ? 'failed' : 'pending';
      if (['settled','failed','cancelled'].includes(row.payment)) {
        if (row.payment!==next) throw new Error('Contradictory terminal settlement evidence');
        return this.view(row);
      }
      if (!['issued','pending'].includes(row.payment)) throw new Error('No active issued attempt');
      this.db.prepare('UPDATE orders SET payment=? WHERE id=?').run(next,row.id);
      this.event({type:'settlement',orderId:row.id,outcome:next,transactionId:row.transaction_id});
      return this.view(this.row(row.id));
    });
  }
  deliver(principal: string,id: string,text: string): Order {
    return this.tx(() => {
      const row=this.owned(principal,id);
      if (row.payment!=='settled') throw new Error('Payment has not settled');
      if (typeof text!=='string'||Buffer.byteLength(text)>65536) throw new Error('Result exceeds delivery limit');
      const result=canonical({text,digest:sha256(text)});
      if (row.result && row.result!==result) throw new Error('Delivered artifact is immutable');
      if (!row.result) { this.db.prepare("UPDATE orders SET result=?,delivery='delivered' WHERE id=?").run(result,id); this.event({type:'delivered',principal,orderId:id,digest:sha256(text)}); }
      return this.view(this.row(id));
    });
  }
  cancel(principal: string,id: string): Order {
    return this.tx(() => { const row=this.owned(principal,id); if(!['reserved','deferred'].includes(row.payment)) throw new Error('Issued payments cannot be cancelled locally'); this.db.prepare("UPDATE orders SET payment='cancelled' WHERE id=?").run(id);this.event({type:'cancelled',principal,orderId:id});return this.view(this.row(id)); });
  }
  /** Release only an unissued hold after a controller failure. Exact retry must authorize afresh. */
  defer(principal: string,id: string): Order {
    return this.tx(() => {const row=this.owned(principal,id);if(row.payment!=='reserved'||row.payload)throw new Error('Only an unissued reservation can be deferred');this.db.prepare("UPDATE orders SET payment='deferred' WHERE id=?").run(id);this.event({type:'deferred',principal,orderId:id});return this.view(this.row(id));});
  }
  stop() { this.tx(() => { this.db.prepare("INSERT OR REPLACE INTO config(key,value) VALUES ('stopped','true')").run();this.event({type:'stopped'}); }); }
  audit(): {sequence:number;event:string;previous_hash:string;hash:string}[] { return this.db.prepare('SELECT * FROM audit ORDER BY sequence').all() as {sequence:number;event:string;previous_hash:string;hash:string}[]; }
}
