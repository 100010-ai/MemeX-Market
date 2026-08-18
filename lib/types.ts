export type Profile = {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  coinValue: number;
  giftValue: number;
  netWorth: number;
  pnl: number;
  tier: string;
  joinedAt: string;
  lastGiftSyncAt: string | null;
  xp: number;
  level: number;
  levelProgress: number;
  xpForNextLevel: number;
};

export type Coin = {
  id: string;
  creatorId: string | null;
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string;
  currentPrice: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  holderCount: number;
  tradeCount24h: number;
  createdAt: string;
  creatorName: string | null;
  liquidity: number;
  allTimeVolume: number;
  athPrice: number;
  buyVolume24h: number;
  sellVolume24h: number;
  sparkline?: number[];
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
  traderId: string;
  traderName: string;
};

export type Holding = {
  coinId: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  pnl: number;
};

export type GiftMediaKind = "static" | "animated" | "video";

export type GiftAsset = {
  id: string;
  virtualGiftId: string;
  telegramName: string;
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
  modelFileId: string;
  modelThumbFileId: string | null;
  modelMediaUrl: string | null;
  symbolFileId: string;
  symbolThumbFileId: string | null;
  symbolMediaUrl: string | null;
  symbolMediaKind: GiftMediaKind;
  mediaKind: GiftMediaKind;
  isPremium: boolean;
  isBurned: boolean;
  isFromBlockchain: boolean;
  lastSeenAt: string;
  catalogSource: "profile_sync" | "telegram_resale";
  telegramResalePriceTon: number | null;
  bestOffer: number | null;
  offerCount: number;
  ownerId: string;
  ownerName: string;
  acquiredPrice: number;
  listingPrice: number | null;
  lastSalePrice: number | null;
  estimatedValue: number | null;
  status: "owned" | "listed";
  createdAt: string;
};

export type GiftCollection = {
  baseName: string;
  itemCount: number;
  holderCount: number;
  listedCount: number;
  floorPrice: number | null;
  lastSalePrice: number | null;
  volume24h: number;
  change24h: number;
  tradeCount24h: number;
};

export type GiftTrade = {
  id: string;
  price: number;
  createdAt: string;
  buyerId: string;
  buyerName: string;
  sellerId: string | null;
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
  ownerId: string;
  ownerName: string;
  gift: GiftAsset;
};

export type GiftTraitStats = {
  collectionFloor: number | null;
  modelFloor: number | null;
  backdropFloor: number | null;
  symbolFloor: number | null;
  collectionLastSale: number | null;
  estimatedValue: number | null;
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
  kind: "coin" | "gift" | "launch" | "listing" | "offer";
  actorId: string | null;
  label: string;
  detail: string;
  amount: number | null;
  createdAt: string;
  href: string;
};

export type LeaderboardPlayer = {
  rank: number;
  id: string;
  isMe: boolean;
  name: string;
  photoUrl: string | null;
  balance: number;
  coinValue: number;
  giftValue: number;
  netWorth: number;
  realizedPnl: number;
  coinRealizedPnl: number;
  giftRealizedPnl: number;
  coinTrades: number;
  giftTrades: number;
  giftCount: number;
  createdCoinMarketCap: number;
};

export type PublicProfile = {
  id: string;
  name: string;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
  joinedAt: string;
  tier: string;
  xp: number;
  level: number;
  rank: number | null;
  netWorth: number;
  realizedPnl: number;
  coinValue: number;
  giftValue: number;
  tradeCount: number;
  giftCount: number;
  createdCoins: Coin[];
  showcase: GiftAsset[];
};


export type CoinQuote = {
  side: "buy" | "sell";
  inputAmount: number;
  outputAmount: number;
  executionPrice: number;
  currentPrice: number;
  priceImpact: number;
  feeAmount: number;
  projectedPrice: number;
};

export type Watchlist = {
  coinIds: string[];
  giftCollections: string[];
};

export type GiftTraitGroup = {
  name: string;
  count: number;
  listedCount: number;
  floorPrice: number | null;
  rarityPerMille: number | null;
};

export type GiftCollectionDetail = {
  collection: GiftCollection;
  gifts: GiftAsset[];
  candles: Candle[];
  models: GiftTraitGroup[];
  backdrops: GiftTraitGroup[];
  symbols: GiftTraitGroup[];
  recentSales: GiftTrade[];
  watched: boolean;
};
