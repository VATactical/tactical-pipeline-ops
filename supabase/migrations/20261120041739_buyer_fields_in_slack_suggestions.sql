-- Slack suggestions can also fill the Media Buyer fields of the dossier.
alter table public.client_dossier_suggestions drop constraint if exists client_dossier_suggestions_field_check;
alter table public.client_dossier_suggestions add constraint client_dossier_suggestions_field_check check (field in (
  'meta_pixel_id', 'meta_ad_account_id', 'meta_business_portfolio_id', 'landing_page_url', 'website_url', 'facebook_page_url',
  'instagram_url', 'gbp_link', 'drive_folder_link', 'google_docs_url', 'make_scenario_link', 'retell_agent_id', 'daily_budget',
  'targeting_radius_miles', 'ads_targeting_address',
  'ad_account_name', 'conversion_location', 'instant_form_name', 'ad_creatives_link', 'booking_calendar_link'));

create or replace function public.resolve_dossier_suggestion(p_id uuid, p_apply boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.client_dossier_suggestions;
  labels constant jsonb := '{
    "meta_pixel_id": "Meta Pixel ID", "meta_ad_account_id": "Ad account ID", "meta_business_portfolio_id": "Business Portfolio ID",
    "landing_page_url": "Landing page", "website_url": "Website", "facebook_page_url": "Facebook page", "instagram_url": "Instagram",
    "gbp_link": "Google Business Profile", "drive_folder_link": "Drive folder", "google_docs_url": "Google Doc",
    "make_scenario_link": "Make scenario", "retell_agent_id": "Retell agent ID", "daily_budget": "Daily budget",
    "targeting_radius_miles": "Targeting radius (miles)", "ads_targeting_address": "Ads targeting address",
    "ad_account_name": "Ad account name", "conversion_location": "Conversion location", "instant_form_name": "Instant Form",
    "ad_creatives_link": "Ad creatives", "booking_calendar_link": "Booking calendar"}';
begin
  if not (select private.has_permission('clients_edit')) then
    raise exception 'No tienes permiso para editar el dossier.';
  end if;
  select * into s from public.client_dossier_suggestions where id = p_id for update;
  if not found then raise exception 'La sugerencia no existe.'; end if;
  if s.status <> 'pending' then raise exception 'Esta sugerencia ya fue revisada.'; end if;
  if p_apply then
    if s.field = 'daily_budget' then
      update public.clients set daily_budget = s.suggested_value::numeric, updated_at = now() where id = s.client_id;
    elsif s.field = 'targeting_radius_miles' then
      update public.clients set targeting_radius_miles = s.suggested_value::integer, updated_at = now() where id = s.client_id;
    else
      execute format('update public.clients set %I = $1, updated_at = now() where id = $2', s.field) using s.suggested_value, s.client_id;
    end if;
    insert into public.client_comments (client_id, author_id, kind, body)
    values (s.client_id, auth.uid(), 'update',
      format('Dossier actualizado desde Slack: %s = %s', labels ->> s.field, s.suggested_value)
      || case when s.source_url <> '' then E'\n' || s.source_url else '' end);
  end if;
  update public.client_dossier_suggestions
  set status = case when p_apply then 'applied' else 'dismissed' end, decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  return case when p_apply then 'applied' else 'dismissed' end;
end;
$$;
