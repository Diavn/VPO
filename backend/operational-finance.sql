-- Synthetic orders only. No bank ingestion, payment status override or real currency.
BEGIN;
ALTER TABLE vpo_stage.account_admin_audit ADD COLUMN order_id uuid REFERENCES vpo_stage.demo_orders(id);
CREATE FUNCTION vpo_stage.admin_order_create(p_uid uuid,p_round uuid,p_amount integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $create$
DECLARE u vpo_stage.users%ROWTYPE; prior vpo_stage.demo_orders%ROWTYPE; oid uuid;
BEGIN
 IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 1000000 THEN RETURN jsonb_build_object('result','INVALID'); END IF;
 SELECT * INTO u FROM vpo_stage.users WHERE id=p_uid FOR UPDATE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR u.deleted_at IS NOT NULL OR u.email_verified_at IS NULL THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 PERFORM 1 FROM vpo_stage.role_grants WHERE user_id=p_uid AND role='student' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 PERFORM 1 FROM vpo_stage.demo_enrolments WHERE user_id=p_uid AND round_id=p_round FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','REFUSED'); END IF;
 INSERT INTO vpo_stage.demo_orders(round_id,user_id,amount_units) VALUES(p_round,p_uid,p_amount)
 ON CONFLICT(round_id,user_id) DO NOTHING RETURNING id INTO oid;
 IF oid IS NULL THEN
  SELECT * INTO prior FROM vpo_stage.demo_orders WHERE round_id=p_round AND user_id=p_uid;
  IF prior.amount_units<>p_amount THEN RETURN jsonb_build_object('result','CONFLICT'); END IF;
  RETURN jsonb_build_object('result','EXISTS','id',prior.id);
 END IF;
 INSERT INTO vpo_stage.account_admin_audit(action,user_id,round_id,order_id) VALUES('ORDER_CREATED',p_uid,p_round,oid);
 RETURN jsonb_build_object('result','CREATED','id',oid);
END $create$;
CREATE FUNCTION vpo_stage.admin_finance_summary() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $summary$
 SELECT jsonb_build_object('mode','synthetic','totals',
 (SELECT jsonb_build_object('orders',count(*),'unpaid',count(*) FILTER(WHERE state='UNPAID'),'reported',count(*) FILTER(WHERE state='REPORTED'),'paid',count(*) FILTER(WHERE state='PAID'),'total_units',coalesce(sum(amount_units),0),'paid_units',coalesce(sum(amount_units) FILTER(WHERE state='PAID'),0)) FROM vpo_stage.demo_orders),
 'rounds',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.label,x.id) FROM (SELECT r.id,r.label,count(*) AS orders,count(*) FILTER(WHERE o.state='PAID') AS paid, sum(o.amount_units) AS total_units,coalesce(sum(o.amount_units) FILTER(WHERE o.state='PAID'),0) AS paid_units FROM vpo_stage.demo_orders o JOIN vpo_stage.demo_rounds r ON r.id=o.round_id GROUP BY r.id,r.label ORDER BY r.id LIMIT 100) x),'[]'::jsonb))
$summary$;
REVOKE ALL ON FUNCTION vpo_stage.admin_order_create(uuid,uuid,integer),vpo_stage.admin_finance_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.admin_order_create(uuid,uuid,integer),vpo_stage.admin_finance_summary() TO vpo_accounts;
COMMIT;
