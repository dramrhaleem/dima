import { describe, it, expect } from 'vitest';
import { courseAdvances } from '../../packages/ui/src/course-journey-motion';
import type { CourseLiveData } from '../../packages/contracts/src/course-live';
const member = {profileId:'peer',displayName:'Learner',avatarUrl:null,percent:20,completedCount:2,totalCount:10,modules:[],latest:{taskId:'task-2',taskTitle:'Step two',moduleId:'module',moduleTitle:'Module',completedAt:'2026-11-01T12:00:05Z',kind:'new' as const}};
const snapshot = (overrides: Partial<CourseLiveData> = {}): CourseLiveData => ({accountId:'owner',offeringId:'course',version:'1',scopeId:'scope',title:'Course',calculatedAt:'2026-11-01T12:00:10Z',refreshAfterSeconds:15,sharing:{enabled:true,revision:1,rankingEnabled:true},rows:[member],totalParticipants:1,truncated:false,...overrides});
describe('earned course celebration',()=>{
 it('celebrates a saved new step between fresh snapshots',()=>{ const before=snapshot({calculatedAt:'2026-11-01T12:00:00Z',rows:[{...member,completedCount:1,percent:10,latest:null}]});expect(courseAdvances(before,snapshot())).toEqual(['peer']); });
 it('never celebrates initial load, reconnect, prior work or a newly visible person',()=>{
  expect(courseAdvances(null,snapshot())).toEqual([]);
  expect(courseAdvances(snapshot({calculatedAt:'2026-11-01T11:55:00Z'}),snapshot())).toEqual([]);
  const before=snapshot({calculatedAt:'2026-11-01T12:00:00Z',rows:[{...member,completedCount:1,latest:null}]});
  expect(courseAdvances(before,snapshot({rows:[{...member,latest:{...member.latest,kind:'prior'}}]}))).toEqual([]);
  expect(courseAdvances(snapshot({calculatedAt:'2026-11-01T12:00:00Z',rows:[]}),snapshot())).toEqual([]);
 });
 it('ignores undo, stale or cross-scope snapshots and old completion replay',()=>{
  const before=snapshot({calculatedAt:'2026-11-01T12:00:00Z',rows:[{...member,completedCount:1,latest:null}]});
  expect(courseAdvances(before,snapshot({accountId:'another'}))).toEqual([]);
  expect(courseAdvances(before,snapshot({scopeId:'another'}))).toEqual([]);
  expect(courseAdvances(before,snapshot({calculatedAt:'2026-11-01T11:59:59Z'}))).toEqual([]);
  expect(courseAdvances(before,snapshot({rows:[{...member,completedCount:0}]}))).toEqual([]);
  expect(courseAdvances(before,snapshot({rows:[{...member,latest:{...member.latest,completedAt:'2026-10-31T12:00:00Z'}}]}))).toEqual([]);
 });
});
