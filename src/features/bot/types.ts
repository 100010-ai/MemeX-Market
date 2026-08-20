export interface TgUser { id: number; is_bot?: boolean; first_name: string; last_name?: string; username?: string; }
export interface TgChat { id: number; type: 'private'|'group'|'supergroup'|'channel'; title?: string; username?: string; }
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  reply_to_message?: TgMessage;
}
export interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string; }
export interface TgUpdate { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallbackQuery; }
