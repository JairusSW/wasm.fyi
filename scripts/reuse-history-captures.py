#!/usr/bin/env python3
"""Restore exact historical captures to a staging directory from read-only SQLite.

This tool never changes a live collection ledger or the benchmark database.
Install staged files and completion markers only at a verified worker boundary.
Original platform, capture date, metrics, ordered samples and sampling policies
are retained; only the weekly source alias changes, for the same pinned commit.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sqlite3
import time


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


features = module('feature_rows', 'reuse-feature-captures.py')
publisher = module('history_publisher', 'publish-host-captures.py')


def clean(value):
    return re.sub(r'[^a-zA-Z0-9.-]', '_', value)


def targets(plan, samples=5, boundary='2026-06-28'):
    output = []
    seen = set()
    for pin in plan['pins']:
        if pin['status'] != 'planned' or pin['targetWeek'][:10] < boundary:
            continue
        if pin['engine'] in plan.get('excludedEngines', []):
            continue
        if not re.fullmatch(r'[a-f0-9]{40}', pin.get('revision', '')):
            raise ValueError('History reuse requires an exact source commit')
        family, revision, week = pin['engine'], pin['revision'], pin['targetWeek']
        go = family in ['wago', 'wazero', 'wasm2go']
        for engine in pin['configurations']:
            identity = (engine, pin['repository'], revision)
            if identity in seen:
                raise ValueError('Duplicate source must be a reused alias, not a second planned capture')
            seen.add(identity)
            if not re.fullmatch(r'[a-zA-Z0-9_.-]+', engine):
                raise ValueError('Unsafe engine name')
            source = dict(repository=pin['repository'], revision=revision,
                          ref=pin.get('tag') or 'main@' + revision[:12 if go or family == 'libwasm' else 8],
                          asOf=week, kind='snapshot' if pin['targetType'] == 'main' else 'release')
            if pin.get('dateBasis'):
                source['dateBasis'] = pin['dateBasis']
            if family == 'libwasm':
                job = 'libwasm-' + revision[:12] + '-' + re.sub(r'[^0-9]', '', week)
                source = dict(repository=pin['repository'], revision=revision, ref='main@' + revision[:12], asOf=week, kind='snapshot')
            elif go:
                job = f'history-{samples}-{engine}-{revision[:12]}-{pin["targetType"]}-' + re.sub(r'[^0-9]', '', week)
                if pin.get('dateBasis') and pin.get('tag'):
                    job += '-' + clean(pin['tag'])
            else:
                job = f'history-{samples}-' + clean('-'.join([engine, pin.get('tag') or revision, pin['targetType'], week]))
            output.append(dict(engine=engine, family=family, source=source, jobId=job,
                statusFile='build-status.json' if go else 'libwasm-status.json' if family == 'libwasm' else family + '-history-status.json',
                pinKey='|'.join([family if go else engine, pin['targetType'], pin.get('tag') or revision, week]),
                configurations=pin['configurations']))
    return output


def export_history(database, plan, contracts, hosts, output, boundary='2026-06-28'):
    started = time.monotonic()
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'receipt.json').exists():
        raise ValueError('Staging export already completed; verify its receipt rather than overwrite it')
    wanted = {(x['workload'], x['artifactSha256'], x['contractSha256']) for x in contracts}
    if len(wanted) != len(contracts) or any(x[0].startswith('features/') for x in wanted):
        raise ValueError('Expected unique main corpus contracts')
    connection = sqlite3.connect('file:' + str(Path(database).resolve()) + '?mode=ro', uri=True, timeout=5, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA cache_size=-32768')
    connection.execute('BEGIN')
    report = dict(startedAt=time.time(), boundary=boundary, mode='read-only-staging', targets=[], files=0, completeTargets=0, rejected={})
    try:
        blocked = {(r['engine'], r['revision']) for r in connection.execute('SELECT engine,revision FROM blocked_revisions')}
        connection.execute('CREATE TEMP TABLE reuse_contracts(id INTEGER PRIMARY KEY)')
        for workload, artifact, contract in wanted:
            row = connection.execute('SELECT c.id FROM contracts c JOIN workloads w ON w.id=c.workload_id WHERE c.digest=? AND c.artifact=? AND w.name=?', (bytes.fromhex(contract), bytes.fromhex(artifact), workload)).fetchone()
            if row:
                connection.execute('INSERT INTO reuse_contracts VALUES(?)', (row['id'],))
        planned_targets=targets(plan,boundary=boundary)
        connection.execute('CREATE TEMP TABLE reuse_sources(engine_id INTEGER,repository TEXT,revision TEXT,PRIMARY KEY(engine_id,repository,revision)) WITHOUT ROWID')
        for target in planned_targets:
            connection.execute('INSERT OR IGNORE INTO reuse_sources SELECT id,?,? FROM engines WHERE name=?', (target['source']['repository'],target['source']['revision'],target['engine']))
        connection.execute('CREATE TEMP TABLE reuse_hosts(platform_id INTEGER,host TEXT,PRIMARY KEY(platform_id,host)) WITHOUT ROWID')
        host_platforms={}
        for host,expected in hosts.items():
            host_platforms[host]={r['id']:dict(r) for r in connection.execute('SELECT * FROM platforms WHERE os=? AND arch=? AND cpu=?',(expected['os'],expected['arch'],expected['cpu']))}
            if not host_platforms[host]:raise ValueError('Host is absent from database: '+expected['cpu'])
            for platform_id in host_platforms[host]:connection.execute('INSERT INTO reuse_hosts VALUES(?,?)',(platform_id,host))
        # The production schema has no observations-by-source index. Scan it
        # once, then use a small indexed TEMP table for every source/host query.
        # Never add indexes or duplicate sample payloads in the benchmark DB.
        connection.execute('CREATE TEMP TABLE reuse_observations(host TEXT,engine_id INTEGER,repository TEXT,revision TEXT,platform_id INTEGER,observation_id INTEGER,PRIMARY KEY(host,engine_id,repository,revision,platform_id,observation_id)) WITHOUT ROWID')
        connection.execute('''INSERT INTO reuse_observations
            SELECT rh.host,cfg.engine_id,s.repository,s.revision,h.platform_id,o.id
            FROM observations o CROSS JOIN sources s ON s.id=o.source_id
            CROSS JOIN configurations cfg ON cfg.id=o.configuration_id
            JOIN reuse_contracts rc ON rc.id=o.contract_id
            JOIN reuse_sources rs ON rs.engine_id=cfg.engine_id AND rs.repository=s.repository AND rs.revision=s.revision
            JOIN platform_observations h ON h.observation_id=o.id JOIN reuse_hosts rh ON rh.platform_id=h.platform_id''')
        report['eligibleObservations']=connection.execute('SELECT COUNT(*) FROM reuse_observations').fetchone()[0]
        for host, expected in hosts.items():
            if not re.fullmatch(r'[a-zA-Z0-9_-]+', host):
                raise ValueError('Unsafe host name')
            platforms = host_platforms[host]
            if not platforms:
                raise ValueError('Host is absent from database: ' + expected['cpu'])
            for target in planned_targets:
                engine, source = target['engine'], target['source']
                if (engine, source['revision']) in blocked:
                    raise ValueError('Blocked revision in source plan')
                grouped = {}
                for platform_id in platforms:
                    rows = connection.execute('''SELECT o.*, w.name workload,c.wasm,c.artifact,c.digest contract,
                        cfg.version,cfg.backend,e.name engine,d.data display,sp.data sampling,v.data samples
                        FROM reuse_observations h JOIN engines e ON e.id=h.engine_id
                        CROSS JOIN observations o ON o.id=h.observation_id
                        JOIN configurations cfg ON cfg.id=o.configuration_id
                        JOIN contracts c ON c.id=o.contract_id JOIN workloads w ON w.id=c.workload_id
                        LEFT JOIN displays d ON d.id=o.display_id LEFT JOIN sampling_policies sp ON sp.id=o.sampling_id
                        LEFT JOIN sample_vectors v ON v.id=o.samples_id
                        WHERE h.host=? AND h.platform_id=? AND e.name=? AND h.repository=? AND h.revision=?
                        ORDER BY o.captured_at DESC,o.id DESC''', (host,platform_id,engine,source['repository'],source['revision']))
                    for row in rows:
                        identity = (row['workload'], row['artifact'].hex(), row['contract'].hex())
                        if identity not in wanted:
                            continue
                        key = (*identity, row['captured_at'], platform_id, row['configuration_id'], row['source_id'])
                        grouped.setdefault(key, {}).setdefault(row['phase'], row)
                result = {**target, 'host': host, 'expected': len(contracts), 'files': [], 'rejected': {}}
                for workload, artifact, contract in sorted(wanted):
                    candidates = [(key, rows) for key, rows in grouped.items() if key[:3] == (workload,artifact,contract) and set(rows) == {0,1,2,3}]
                    for key, rows in sorted(candidates, key=lambda x:x[0][3], reverse=True):
                        try:
                            values = [features.row_result(rows[p]) for p in range(4)]
                            if any(not r['version'] or r['version']=='unknown' or r['latencyStatus'] not in features.STATUSES[1:]
                                   or r['timingSamples'] < 0 or len(r['samplesNs']) != r['timingSamples']
                                   or any(not math.isfinite(v) or v < 0 for v in r['samplesNs'])
                                   or r['latencyStatus']=='ok' and not publisher.valid_sample_count(r,5,True,True) for r in values):
                                raise ValueError('Original sampling metadata or vectors are invalid')
                            old = platforms[key[4]]
                            platform = {name:old[name] for name in ['os','arch','cpu','cores','kernel']}
                            platform['memoryBytes'] = old['memory_bytes']
                            capture = dict(capturedAt=key[3],source=source,platform=platform,results=values)
                            body = (json.dumps(capture,separators=(',',':'),allow_nan=False)+'\n').encode()
                        except (ValueError,IndexError,KeyError) as error:
                            reason=str(error);result['rejected'][reason]=result['rejected'].get(reason,0)+1
                            continue
                        name=target['jobId']+'-'+hashlib.sha256(workload.encode()).hexdigest()[:16]+'.json'
                        path=output/host/'captures'/name;path.parent.mkdir(parents=True,exist_ok=True)
                        temporary=path.with_suffix('.next');temporary.write_bytes(body);temporary.replace(path)
                        failed=[r for r in values if r['latencyStatus']=='failed']
                        if failed:
                            reason='Recorded runtime failure retained from the database; original diagnostic text is unavailable'
                            features.write(output/host/'failure-notes'/name,dict(capturedAt=key[3],engine=engine,workload=workload,source=source,kind='recorded-database-failure',reason=reason,
                                failures=[dict(engine=engine,workload=workload,phase=r['phase'],status='error',reason=reason) for r in failed]))
                        result['files'].append(dict(name=name,sha256=hashlib.sha256(body).hexdigest(),workload=workload,capturedAt=key[3],platformId=key[4],configurationId=key[5],sourceId=key[6],observationIds=[rows[p]['id'] for p in range(4)],failedPhases=[r['phase'] for r in failed]))
                        break
                result['reused']=len(result['files']);result['complete']=result['reused']==len(contracts)
                report['files']+=result['reused'];report['completeTargets']+=int(result['complete'])
                for reason,count in result['rejected'].items():report['rejected'][reason]=report['rejected'].get(reason,0)+count
                report['targets'].append(result)
                print(json.dumps(dict(host=host,engine=engine,revision=source['revision'],asOf=source['asOf'],reused=result['reused'],complete=result['complete'])),flush=True)
        connection.execute('COMMIT')
    finally:
        connection.close()
    report['elapsedSeconds']=time.monotonic()-started
    report['planSHA256']=hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    report['contractsSHA256']=hashlib.sha256(json.dumps(contracts,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    features.write(output/'receipt.json',report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True,type=Path)
    parser.add_argument('--plan',required=True,type=Path)
    parser.add_argument('--contracts',required=True,type=Path)
    parser.add_argument('--hosts',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--boundary',default='2026-06-28')
    args=parser.parse_args()
    export_history(args.database,json.loads(args.plan.read_text()),json.loads(args.contracts.read_text()),json.loads(args.hosts.read_text()),args.output,args.boundary)


if __name__=='__main__':main()
