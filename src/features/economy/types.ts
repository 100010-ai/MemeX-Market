export type EconomyReason =
  | 'race_reward' | 'case_purchase' | 'case_reward' | 'market_buy' | 'market_sale'
  | 'tuning_purchase' | 'casino_bet' | 'casino_payout' | 'referral' | 'admin_adjustment';

export interface LedgerEntry {
  id: string;
  playerId: string;
  delta: number;
  balanceAfter: number;
  reason: EconomyReason;
  idempotencyKey: string;
  createdAt: string;
}
