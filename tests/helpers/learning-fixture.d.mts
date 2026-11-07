import type { LearningState } from '../../packages/contracts/src/learning';
export function seedSyntheticLearningState(userId: string, state: LearningState, profileRevision: number): Promise<LearningState>;
