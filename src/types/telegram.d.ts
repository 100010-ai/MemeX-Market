export {};

type AutoSyndicateAuthIssue = {
  code: string;
  message: string;
  status?: number;
  at: number;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id?: number; first_name?: string; username?: string; photo_url?: string };
        };
        ready?: () => void;
        expand?: () => void;
        HapticFeedback?: {
          impactOccurred?: (style: string) => void;
          notificationOccurred?: (type: string) => void;
        };
      };
    };
    __AUTOSYNDICATE_AUTHENTICATED__?: boolean;
    __AUTOSYNDICATE_SERVER_SESSION__?: {
      playerId: string;
      username: string | null;
      name: string;
      telegramId?: number;
    } | null;
    __AUTOSYNDICATE_SUPABASE_SESSION__?: boolean;
    __AUTOSYNDICATE_REAUTH__?: () => Promise<boolean>;
    __AUTOSYNDICATE_AUTH_ERROR__?: AutoSyndicateAuthIssue | null;
  }
}
