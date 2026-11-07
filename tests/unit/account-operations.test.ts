import { describe, expect, it } from 'vitest';
import { freshEmailProof } from '../../apps/web/src/server/account-operations';
import { accountDeletionCommandSchema } from '../../packages/contracts/src/operations';
const now=Date.parse('2026-11-01T12:01:00Z'),started='2026-11-01T12:00:00Z',timestamp=Math.floor(Date.parse(started)/1000);
describe('fresh mailbox proof for account deletion',()=>{
 it('accepts a same-account OTP issued in the challenge second',()=>{
  expect(freshEmailProof({sub:'owner',amr:[{method:'otp',timestamp}]},'owner',started,now)).toBe(true);
 });
 it('rejects another account, old proof, future proof, missing proof and OAuth/refresh timestamps',()=>{
  for(const value of [
   {sub:'other',amr:[{method:'otp',timestamp}]},
   {sub:'owner',amr:[{method:'otp',timestamp:timestamp-1}]},
   {sub:'owner',amr:[{method:'otp',timestamp:timestamp+120}]},
   {sub:'owner',amr:[{method:'oauth',timestamp}]},
   {sub:'owner',iat:timestamp+30,amr:[{method:'password',timestamp}]},
   {sub:'owner',iat:timestamp+30},
  ])expect(freshEmailProof(value,'owner',started,now)).toBe(false);
 });
 it('requires explicit destructive confirmation and does not accept a caller-provided proof token',()=>{
  const input={type:'confirm',requestId:'14027ea3-3cff-416e-9f1a-cf397f3bf512',code:'123456',confirmation:'DELETE'};
  expect(accountDeletionCommandSchema.safeParse(input).success).toBe(true);
  expect(accountDeletionCommandSchema.safeParse({...input,confirmation:'delete'}).success).toBe(false);
  expect(accountDeletionCommandSchema.safeParse({...input,proofToken:'external-token'}).success).toBe(false);
  expect(accountDeletionCommandSchema.safeParse({...input,actorId:'another-user'}).success).toBe(false);
 });
});
