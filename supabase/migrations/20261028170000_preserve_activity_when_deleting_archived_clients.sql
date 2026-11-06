-- Keep activity history intact when a client is permanently deleted.
-- Cascaded child deletes can fire audit triggers after the client row is gone;
-- those activity rows must not retain a foreign key to a missing client.

CREATE OR REPLACE FUNCTION private.capture_operational_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor_name text := 'Sistema';
  v_actor_role text := 'system';
  v_client_id text;
  v_entity_id text;
BEGIN
  SELECT coalesce(full_name, 'Usuario'), role
    INTO v_actor_name, v_actor_role
    FROM public.profiles
   WHERE id = (SELECT auth.uid());

  IF TG_TABLE_NAME = 'clients' THEN
    IF TG_OP = 'DELETE' THEN
      v_entity_id := OLD.id;
      v_client_id := NULL;
    ELSE
      v_entity_id := NEW.id;
      v_client_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_client_id := OLD.client_id;
      v_entity_id := OLD.id::text;
    ELSE
      v_client_id := coalesce(NEW.client_id, OLD.client_id);
      v_entity_id := coalesce(NEW.id::text, OLD.id::text);
    END IF;

    -- Cascaded child deletes run after the client row has been removed.
    -- Preserve the activity record but do not reference a missing client.
    IF v_client_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client_id) THEN
      v_client_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.activity_log
    (client_id, actor_id, actor_name, actor_role, entity_type, entity_id, action, old_values, new_values)
  VALUES
    (v_client_id, (SELECT auth.uid()), coalesce(v_actor_name, 'Sistema'), coalesce(v_actor_role, 'system'),
     TG_TABLE_NAME, v_entity_id, lower(TG_OP),
     CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
     CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.activity_log
  DROP CONSTRAINT activity_log_client_id_fkey;

ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
