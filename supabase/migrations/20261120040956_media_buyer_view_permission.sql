-- "Ver la vista Media Buyer": on for the Media Buying (Meta) department and Dirección; any other
-- department can turn it on later. Profiles pick it up through their department roles.
update public.departments
set permissions = permissions || jsonb_build_object('media_buyer_view', id in ('media_buying_meta', 'direction'))
where id in ('direction', 'operations_csm', 'onboarding_csm', 'ghl_tech_automation', 'media_buying_meta', 'google_gbp', 'video_editing');

do $$
declare member record;
begin
  for member in select distinct profile_id from public.profile_department_roles loop
    perform private.sync_profile_department_permissions(member.profile_id);
  end loop;
end;
$$;
