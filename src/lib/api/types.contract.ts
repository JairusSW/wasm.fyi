// Compile-time contract checks. This file has no runtime imports or UI effects.
import type {OverviewCard, CohortCell, NativeFunctionPage, ResultSummaryData, SessionJobPage, APIError, PlanRegistration, RegisteredSession, ProgressUpdate, AttemptProgressPage, HistoryChange, HistoryBinding, HistoryContext, RequestStats} from './types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type OverviewValue = Assert<Equal<OverviewCard['value'], number | null>>;
export type CohortValue = Assert<Equal<CohortCell['value'], number | null>>;
export type ExactSourceValue = Assert<Equal<CohortCell['sourceValue'], number | string | null | undefined>>;
export type ProducerOrder = Assert<Equal<NativeFunctionPage['order'], 'producer-order'>>;
export type ReferencedMethod = Assert<Equal<ResultSummaryData['measurementMethodId'], string | undefined>>;

export type SessionJobSort = Assert<Equal<SessionJobPage['sort'], 'machine-corpus-attempt-id'>>;
export type SessionReportReferences = Assert<Equal<SessionJobPage['items'][number]['reports'], Array<string>>>;
export type OptionalErrorCode = Assert<Equal<APIError['code'], APIError['code'] | undefined>>;

export type RegistrationSchema = Assert<Equal<PlanRegistration['schema'], 1>>;
export type RegistrationHasNoAttempt = Assert<Equal<Extract<keyof PlanRegistration, 'attempt' | 'exports' | 'machine'>, never>>;

export type RegisteredStatus = Assert<Equal<RegisteredSession['status'], 'registered'>>;
export type RegisteredScopeHasNoInventory = Assert<Equal<Extract<keyof RegisteredSession, 'jobs' | 'reports' | 'chunks'>, never>>;

export type ProgressStatus = Assert<Equal<ProgressUpdate['status'], 'running' | 'completed' | 'interrupted' | 'failed'>>;
export type ProgressHasNoEvidence = Assert<Equal<Extract<keyof ProgressUpdate, 'samples' | 'reports' | 'exports'>, never>>;

export type AttemptPageSort = Assert<Equal<AttemptProgressPage['sort'], 'machine-corpus-attempt'>>;

export type HistoryChangeRatio = Assert<Equal<HistoryChange['ratio'], number | null>>;
export type HistoryChangeNoEvidence = Assert<Equal<Extract<keyof HistoryChange, 'members' | 'samples' | 'reports'>, never>>;
export type HistoryChangeUncertainty = Assert<Equal<HistoryChange['uncertainty'], 'unavailable'>>;

export type HistoryBuildRole = Assert<Equal<HistoryBinding['buildRole'], 'source' | 'release' | 'unknown'>>;
export type HistoryCollectionTime = Assert<Equal<HistoryContext['collectedAt'], string | null>>;
export type HistoryInterpretationTrust = Assert<Equal<HistoryContext['interpretationSource'], 'trusted-publisher-assertion'>>;

export type RequestTelemetryVersion = Assert<Equal<RequestStats['version'], 'http-requests-v1'>>;
export type RequestTelemetryNoIdentity = Assert<Equal<Extract<keyof RequestStats['routes'][number], 'path' | 'query' | 'client' | 'token'>, never>>;
