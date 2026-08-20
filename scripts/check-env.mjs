const required = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_WEBHOOK_SECRET',
  'SESSION_SECRET',
  'ADMIN_TELEGRAM_IDS'
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error('Missing required environment variables:\n' + missing.map((x) => ` - ${x}`).join('\n'));
  process.exit(1);
}
if ((process.env.SESSION_SECRET ?? '').length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET ?? '')) {
  console.error('TELEGRAM_WEBHOOK_SECRET must use only A-Z, a-z, 0-9, _ or - and be 16-256 chars.');
  process.exit(1);
}
if (!(process.env.ADMIN_TELEGRAM_IDS ?? '').split(',').every((v) => /^\d{1,24}$/.test(v.trim()))) {
  console.error('ADMIN_TELEGRAM_IDS must be a comma-separated list of Telegram numeric IDs.');
  process.exit(1);
}
console.log('Environment looks valid.');
