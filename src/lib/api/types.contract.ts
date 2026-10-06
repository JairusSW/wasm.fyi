// Compile-time contract checks. This file has no runtime imports or UI effects.
import type {OverviewCard, CohortCell, NativeFunctionPage, ResultSummaryData} from './types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type OverviewValue = Assert<Equal<OverviewCard['value'], number | null>>;
export type CohortValue = Assert<Equal<CohortCell['value'], number | null>>;
export type ExactSourceValue = Assert<Equal<CohortCell['sourceValue'], number | string | null | undefined>>;
export type ProducerOrder = Assert<Equal<NativeFunctionPage['order'], 'producer-order'>>;
export type ReferencedMethod = Assert<Equal<ResultSummaryData['measurementMethodId'], string | undefined>>;
