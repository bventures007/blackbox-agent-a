-- 0002: the worker's scheduler scope may READ (never write) connection, capability and debug-window rows across tenants
-- to find due polls and active debug windows. Writes stay tenant-scoped (the import job runs inside withTenant).
-- Before this migration the scheduler saw no rows, so periodic polls never fired after the first job (found by SLICE-01 rerun).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections','capability_state','debug_windows'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_select ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_tenant_select ON %I FOR SELECT USING (tenant_id = app_tenant() OR app_scope() IN (''engine'',''scheduler''))', t, t);
  END LOOP;
END $$;
