-- Synthetic CMS only; one plain-text bulletin table, no arbitrary HTML or uploads.
BEGIN;
CREATE TABLE vpo_stage.content_entries(
 id uuid PRIMARY KEY, category text NOT NULL CHECK(category IN ('NEWS','LIBRARY')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 body text NOT NULL CHECK(octet_length(body) BETWEEN 1 AND 8000),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHED','WITHDRAWN')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 published_at timestamptz
);
CREATE FUNCTION vpo_stage.content_list(p_public boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $list$
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.id),'[]'::jsonb) FROM
 (SELECT id,category,title,body,state,revision,updated_at,published_at FROM vpo_stage.content_entries
 WHERE p_public=false OR (p_public=true AND state='PUBLISHED') ORDER BY updated_at DESC,id LIMIT 100) x
$list$;
CREATE FUNCTION vpo_stage.content_save(p_id uuid,p_category text,p_title text,p_body text,p_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $save$
DECLARE v vpo_stage.content_entries%ROWTYPE;
BEGIN
 IF p_id IS NULL OR p_category IS NULL OR p_category NOT IN ('NEWS','LIBRARY') OR p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 160 OR length(p_title)>160 OR p_body IS NULL OR length(trim(p_body))=0 OR octet_length(p_body)>8000 OR p_revision IS NULL OR p_revision<0 THEN RETURN 'INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,649));
 SELECT * INTO v FROM vpo_stage.content_entries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_revision<>0 THEN RETURN 'CONFLICT'; END IF;
  INSERT INTO vpo_stage.content_entries(id,category,title,body) VALUES(p_id,p_category,p_title,p_body);
  RETURN 'CREATED';
 END IF;
 IF v.state<>'DRAFT' THEN RETURN 'CONFLICT'; END IF;
 IF v.revision=p_revision+1 AND ROW(v.category,v.title,v.body) IS NOT DISTINCT FROM ROW(p_category,p_title,p_body) THEN RETURN 'REPLAY'; END IF;
 IF v.revision<>p_revision THEN RETURN 'CONFLICT'; END IF;
 UPDATE vpo_stage.content_entries SET category=p_category,title=p_title,body=p_body,revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 RETURN 'UPDATED';
END $save$;
CREATE FUNCTION vpo_stage.content_transition(p_id uuid,p_revision integer,p_action text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,vpo_stage AS $transition$
DECLARE v vpo_stage.content_entries%ROWTYPE; target text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('publish','withdraw') OR p_revision IS NULL THEN RETURN 'INVALID'; END IF;
 SELECT * INTO v FROM vpo_stage.content_entries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'CONFLICT'; END IF;
 target:=CASE WHEN p_action='publish' THEN 'PUBLISHED' ELSE 'WITHDRAWN' END;
 IF v.state=target AND v.revision=p_revision+1 THEN RETURN 'REPLAY'; END IF;
 IF v.revision<>p_revision OR (p_action='publish' AND v.state<>'DRAFT') OR (p_action='withdraw' AND v.state<>'PUBLISHED') THEN RETURN 'CONFLICT'; END IF;
 UPDATE vpo_stage.content_entries SET state=target,revision=revision+1,updated_at=clock_timestamp(),published_at=CASE WHEN target='PUBLISHED' THEN clock_timestamp() ELSE published_at END WHERE id=p_id;
 RETURN 'UPDATED';
END $transition$;
REVOKE ALL ON vpo_stage.content_entries FROM PUBLIC;
REVOKE ALL ON FUNCTION vpo_stage.content_list(boolean),vpo_stage.content_save(uuid,text,text,text,integer),vpo_stage.content_transition(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vpo_stage.content_list(boolean),vpo_stage.content_save(uuid,text,text,text,integer),vpo_stage.content_transition(uuid,integer,text) TO vpo_accounts;
COMMIT;
