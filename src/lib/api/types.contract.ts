// Compile-time contract checks. This file has no runtime imports or UI effects.
import type {OverviewCard, CohortCell, NativeFunctionPage, ResultSummaryData, SessionJobPage, APIError, PlanRegistration} from './types';

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
