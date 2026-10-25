import type { TradeDetailResult } from "../../repositories/tradeCenter.supabase";
import type { StaffTrade, TradeSettings } from "../../../store/lib/tradeCenter";

/** What every part of the trade drawer gets. */
export interface TradePanelProps {
  trade: StaffTrade;
  settings: TradeSettings;
  /** The store owner: payments recorded by hand and cash payouts. */
  owner: boolean;
  /** The action running right now (one at a time), or null. */
  busy: string | null;
  /**
   * Runs one change and shows the trade as the server returns it. Resolves
   * true when it worked; on a failure the message is shown and the trade is
   * reloaded, in case part of it went through.
   */
  run: (key: string, action: () => Promise<TradeDetailResult>, done: string) => Promise<boolean>;
}
