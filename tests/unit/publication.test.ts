import { describe, expect, it } from 'vitest';
import { publicationCommandSchema } from '../../packages/contracts/src/publication';
import { publicationDto } from '../../apps/web/src/server/publication';
import seeds from '../../apps/web/src/server/data/catalog.json';

const submit={type:'submit',operationId:'14027ea3-3cff-416e-9f1a-cf397f3bf512',expectedRevision:2,draftId:'my-course',provider:'Course author',summary:'An independently written course outline.',language:'English',scopeLabel:'Required lessons only',orderPolicy:'Follow source sequence',sourceNotes:'Original outline based on the linked public source.',rightsAttested:true};
describe('publication privacy boundary',()=>{
 it('requires explicit rights and source attestations',()=>{
  expect(publicationCommandSchema.safeParse(submit).success).toBe(true);
  expect(publicationCommandSchema.safeParse({...submit,rightsAttested:false}).success).toBe(false);
  expect(publicationCommandSchema.safeParse({...submit,sourceNotes:''}).success).toBe(false);
 });
 it('does not accept a client snapshot, owner, progress or role',()=>{
  for(const key of ['snapshot','ownerId','completions','role'])expect(publicationCommandSchema.safeParse({...submit,[key]:'injected'}).success).toBe(false);
 });
 it('requires an explicit reason and revision for publication administration',()=>{
  const command={type:'setPublication',operationId:submit.operationId,expectedRevision:1,offeringId:'cs50-business',published:false,reason:'Source rights review requested'};
  expect(publicationCommandSchema.safeParse(command).success).toBe(true);
  expect(publicationCommandSchema.safeParse({...command,reason:''}).success).toBe(false);
  expect(publicationCommandSchema.safeParse({...command,expectedRevision:-1}).success).toBe(false);
 });
 it('projects only submitted outline fields even if database row carries owner data',()=>{
  const row={id:submit.operationId,draft_id:'draft',offering_id:seeds.offerings[0].id,snapshot:seeds.offerings[0],source_notes:submit.sourceNotes,rights_attested:true as const,status:'pending' as const,revision:1,created_at:'2026-11-01T00:00:00Z',reviewed_at:null,decision_reason:null,owner_id:'private-owner',email:'private@example.invalid',progress:99};
  const result=publicationDto(row);
  expect(result.snapshot).toEqual(seeds.offerings[0]);
  expect(result).not.toHaveProperty('owner_id');expect(result).not.toHaveProperty('email');expect(result).not.toHaveProperty('progress');
 });
});
