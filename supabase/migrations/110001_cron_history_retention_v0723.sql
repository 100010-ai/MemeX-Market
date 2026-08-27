-- MemeX Market v0.72.3
-- pg_cron stores every execution in cron.job_run_details and does not prune
-- history automatically. The conditional-order worker runs every 10 seconds,
-- so keep a bounded seven-day diagnostic window.

select cron.schedule(
  'mxm-prune-cron-history-v0723',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$
);
