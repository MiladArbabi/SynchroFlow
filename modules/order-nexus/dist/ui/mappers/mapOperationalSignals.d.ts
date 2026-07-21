import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import type { OperationalControlSnapshot } from './types/operationalControlSnapshot.js';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export declare function mapOperationalSignals(snapshot: OperationalControlSnapshot, currency?: CurrencyContext): OperationalSignal[];
