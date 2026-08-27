import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationDir = path.join(root, "supabase", "migrations");
const required = [
  "100024_admin_analytics_permissions_v0670.sql",
  "100025_admin_funnel_consistency_v0671.sql",
  "100026_system_hardening_v0700.sql",
  "100027_remaining_fk_indexes_v0700.sql",
  "100028_tonapi_content_media_v0700.sql",
  "100029_stars_weekly_seasons_verification_v071.sql",
  "100030_case_weights_fix_v071.sql",
  "100031_weekly_reward_kind_fix_v071.sql",
  "100032_social_league_missions_cases_v0722.sql",
  "100033_social_missions_v0722.sql",
  "100034_social_league_v0722.sql",
  "100035_social_cases_v0722.sql",
  "100036_social_schema_reload_v0722.sql",
  "110000_missing_fk_indexes_v0723.sql",
  "110001_cron_history_retention_v0723.sql",
  "120000_memecoin_pulse_v0730.sql",
];

const missing = required.filter((name) => !fs.existsSync(path.join(migrationDir, name)));
if (missing.length) {
  console.error("MIGRATION BASELINE FAILED");
  console.error("Production-tracked migrations are missing from Git:");
  for (const name of missing) console.error(`- ${name}`);
  process.exit(1);
}

console.log(`Migration baseline OK (${required.length} protected files)`);
