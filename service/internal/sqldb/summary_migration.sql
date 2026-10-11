-- One transactional upgrade of copies created before scalar totals existed.
INSERT OR IGNORE INTO platform_totals(platform_id,latest_rows,history_rows)
 SELECT p.id,(SELECT count(*) FROM latest l WHERE l.platform_id=p.id),(SELECT count(*) FROM history h WHERE h.platform_id=p.id)
 FROM platforms p WHERE NOT EXISTS(SELECT 1 FROM metadata WHERE key='summary-schema-v2');
INSERT OR IGNORE INTO platform_observations(platform_id,observation_id,latest_refs,history_refs)
 SELECT platform_id,observation_id,sum(l),sum(h) FROM
 (SELECT platform_id,observation_id,1 l,0 h FROM latest UNION ALL SELECT platform_id,observation_id,0 l,1 h FROM history)
 WHERE NOT EXISTS(SELECT 1 FROM metadata WHERE key='summary-schema-v2') GROUP BY platform_id,observation_id;
INSERT OR IGNORE INTO metadata(key,value) VALUES('summary-schema-v2','complete');

