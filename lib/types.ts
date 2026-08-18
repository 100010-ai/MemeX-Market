export type Profile = {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  balance: number;
  coinValue: number;
  giftValue: number;
  netWorth: number;
  pnl: number;
  tier: string;
  joinedAt: string;
  lastGiftSyncAt: string | null;
};

export type Coin = {
  id: string;
  name: string;
  symbol: string;
  description: string;
  currentPrice: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  holderCount: number;
  createdAt: string;
  creatorName?: string | null;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Trade = {
  id: string;
  side: "buy" | "sell";
  quoteAmount: number;
  tokenAmount: number;
  price: number;
  createdAt: string;
  traderName: string;
};

export type Holding = {
  coinId: string;
  name: string;
  symbol: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  pnl: number;
};

export type GiftMediaKind = "static" | "animated" | "video" | "demo";

export type GiftAsset = {
  id: string;
  virtualGiftId: string;
  source: "telegram" | "demo";
  telegramName: string | null;
  giftId: string | null;
  baseName: string;
  number: number;
  modelName: string;
  modelRarityPerMille: number;
  modelRarity: string | null;
  symbolName: string;
  symbolRarityPerMille: number;
  backdropName: string;
  backdropRarityPerMille: number;
  backdropCenter: string;
  backdropEdge: string;
  backdropSymbol: string;
  backdropText: string;
  modelFileId: string | null;
  modelThumbFileId: string | null;
  symbolFileId: string | null;
  symbolThumbFileId: string | null;
  mediaKind: GiftMediaKind;
  demoEmoji: string | null;
  isPremium: boolean;
  isFromBlockchain: boolean;
  referencePrice: number;
  ownerId: string | null;
  ownerName: string | null;
  listingPrice: number | null;
  lastSalePrice: number | null;
  status: "owned" | "listed";
  createdAt: string;
};

export type GiftCollection = {
  baseName: string;
  listedCount: number;
  floorPrice: number | null;
  lastSalePrice: number | null;
  volume24h: number;
  change24h: number;
};

export type GiftTrade = {
  id: string;
  price: number;
  createdAt: string;
  buyerName: string;
  sellerName: string | null;
};

export type GiftOffer = {
  id: string;
  virtualGiftId: string;
  baseName: string;
  number: number;
  amount: number;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: string;
  buyerId: string;
  buyerName: string;
  ownerId: string | null;
  ownerName: string | null;
};

export type MissionPeriod = "onboarding" | "daily" | "weekly";

export type Mission = {
  id: string;
  key: string;
  period: MissionPeriod;
  title: string;
  description: string;
  reward: number;
  target: number;
  progress: number;
  claimed: boolean;
  actionType: string;
};

export type ActivityItem = {
  id: string;
  kind: "coin" | "gift";
  label: string;
  detail: string;
  amount: number;
  createdAt: string;
};
