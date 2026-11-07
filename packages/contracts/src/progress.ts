export type CourseProgress = { enrollmentId:string; offeringId:string; title:string; version:string; requiredWeight:number|null; completedWeight:number; priorWeight:number; newWeight:number; requiredSteps:number; completedSteps:number; percentage:number|null; classificationNeeded:boolean };
export type ProgressData = {
 accountId:string; timezone:string; sourceRevision:number; calculatedAt:string; window:{start:string;end:string};
 courses:CourseProgress[];
 time:{learningSeconds:number;workSeconds:number;timerSeconds:number;manualSeconds:number;pendingSeconds:number;eligibleSeconds:number};
 rhythm:{activeDays:number;days:string[];source:'time-ledger-and-work-events';goal:number|null};
 planHealth:{status:string;missingEstimates:number;provisionalEstimates:number;outcomes:Array<{enrollmentId:string;targetDate:string;forecastDate:string|null;status:string}>};
};
