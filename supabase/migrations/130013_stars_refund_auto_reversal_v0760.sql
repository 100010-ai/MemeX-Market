-- v0.76.0 — make every Stars refund converge on the same virtual reversal path.
-- Telegram can refund outside Advanced Ops (legacy admin action / webhook), so
-- the database itself guarantees that a transition to `refunded` attempts the
-- idempotent v0.74 fulfillment reversal.

create or replace function public.star_purchase_auto_reversal_v0760()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_error text;
begin
  begin
    v_result := public.reverse_star_purchase_fulfillment_v074(new.id);

    update public.star_purchases
       set refund_metadata = coalesce(refund_metadata, '{}'::jsonb)
         || jsonb_build_object(
              'autoReversal', 'v0760',
              'autoReversalStatus', coalesce(v_result->>'status', 'unknown')
            ),
           updated_at = now()
     where id = new.id;
  exception when others then
    v_error := left(sqlerrm, 900);

    -- A Telegram refund may already be irreversible. Never roll back the
    -- refunded purchase state merely because virtual reconciliation failed.
    insert into public.star_purchase_reversals_v074(
      purchase_id,
      profile_id,
      product_sku,
      status,
      details,
      processed_at
    ) values (
      new.id,
      new.profile_id,
      new.product_sku,
      'manual_review',
      jsonb_build_object(
        'source', 'auto_reversal_v0760',
        'error', v_error
      ),
      now()
    )
    on conflict (purchase_id) do update
      set status = case
            when public.star_purchase_reversals_v074.status in ('reversed', 'partial')
              then public.star_purchase_reversals_v074.status
            else 'manual_review'
          end,
          details = coalesce(public.star_purchase_reversals_v074.details, '{}'::jsonb)
            || jsonb_build_object(
                 'source', 'auto_reversal_v0760',
                 'error', v_error
               ),
          processed_at = now();

    update public.star_purchases
       set refund_metadata = coalesce(refund_metadata, '{}'::jsonb)
         || jsonb_build_object(
              'autoReversal', 'v0760',
              'autoReversalStatus', 'manual_review',
              'autoReversalError', v_error
            ),
           updated_at = now()
     where id = new.id;
  end;

  return new;
end;
$$;

revoke all on function public.star_purchase_auto_reversal_v0760() from public, anon, authenticated;
grant execute on function public.star_purchase_auto_reversal_v0760() to service_role;

drop trigger if exists star_purchase_auto_reversal_v0760 on public.star_purchases;
create trigger star_purchase_auto_reversal_v0760
after update of status on public.star_purchases
for each row
when (old.status is distinct from new.status and new.status = 'refunded')
execute function public.star_purchase_auto_reversal_v0760();
