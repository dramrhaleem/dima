/** Pure shared planner policy; safe in browser bundles without schema imports. */
export const PLANNER_VERSION = 'b3-3' as const;

/** Forecasting is bounded independently of the learner’s target date. */
export const MAX_FORECAST_DAYS = 820;
