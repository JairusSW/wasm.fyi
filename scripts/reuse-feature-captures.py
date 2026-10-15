#!/usr/bin/env python3
"""Alias valid feature captures from the host's SQLite DB, preserving raw data.

The exporter supplies the worker's exact JS contract and ledger keys. Run under
the campaign measurement lease (and Apple's device wrapper) before features.
Only successful, policy-compatible timing captures qualify; failed/unsupported
admission is retried so an old adapter limitation cannot hide a repaired one.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import struct
from datetime import datetime, timezone

PHASES = ['compile', 'instantiate', 'first-call', 'steady']
STATUSES = ['', 'ok', 'failed', 'unsupported', 'disabled', 'not-measured', 'unavailable']


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False) + '\n')
    temporary.replace(path)


def row_result(row):
    bits = row['metric_bits']
    if len(bits) != 25:
        raise ValueError('Invalid metric vector')
    data = row['samples'] or b''
    if len(data) % 8:
        raise ValueError('Invalid sample vector')
    result = dict(workload=row['workload'], wasm=row['wasm'],
                  artifactSha256=row['artifact'].hex(), contractSha256=row['contract'].hex(),
                  engine=row['engine'], version=row['version'], backend=row['backend'],
                  phase=PHASES[row['phase']], timingSamples=row['timing_samples'],
                  samplesNs=list(struct.unpack('<' + 'd' * (len(data) // 8), data)),
                  codeKind=row['code_kind'])
    for key in ['latency', 'memory', 'code']:
        result[key + 'Status'] = STATUSES[row[key + '_status']]
    for index, name in enumerate(['latencyNs', 'peakRssBytes', 'codeBytes']):
        result[name] = struct.unpack_from('<d', bits, 1 + index * 8)[0] if bits[0] & (1 << index) else None
    for key in ['display', 'sampling']:
        if row[key] is not None:
            result[key] = json.loads(row[key])
    return result


def reuse(database, expected, campaign, valid_sample_count):
    campaign = Path(campaign)
    feature_root = campaign / 'latest-features'
    if (feature_root / 'ledger-writer-lock').exists():
        raise RuntimeError('A feature writer owns the ledger; do not seed concurrently')
    ledger_path = feature_root / 'ledger.json'
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'items': {}, 'completedEngines': []}
    connection = sqlite3.connect('file:' + str(Path(database).resolve()) + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    platform = expected['platform']
    platforms = {r['id']: dict(r) for r in connection.execute(
        'SELECT * FROM platforms WHERE os=? AND arch=? AND cpu=?',
        (platform['os'], platform['arch'], platform['cpu']))}
    if not platforms:
        connection.close()
        raise RuntimeError('No matching host in the selected database: ' + platform['cpu'])
    summary = []
    for target in expected['targets']:
        engine, source = target['engine'], target['source']
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+', engine):
            raise ValueError('Unsafe engine identifier')
        if len(target['keys']) != len(expected['workloads']):
            raise ValueError('Incomplete exported ledger keys')
        wanted = {(item['workload']['id'], item['workload']['sha256'], item['contract'])
                  for item in expected['workloads']}
        grouped = {}
        # The reference table also retains superseded observations. A newer
        # one-sample correctness check must not hide an earlier full perf vector.
        for platform_id in platforms:
            rows = connection.execute('''SELECT o.*,w.name workload,c.wasm,c.artifact,c.digest contract,
                cfg.version,cfg.backend,e.name engine,d.data display,sp.data sampling,v.data samples
                FROM platform_observations h JOIN observations o ON o.id=h.observation_id
                JOIN configurations cfg ON cfg.id=o.configuration_id JOIN engines e ON e.id=cfg.engine_id
                JOIN contracts c ON c.id=o.contract_id JOIN workloads w ON w.id=c.workload_id
                JOIN sources s ON s.id=o.source_id LEFT JOIN displays d ON d.id=o.display_id
                LEFT JOIN sampling_policies sp ON sp.id=o.sampling_id LEFT JOIN sample_vectors v ON v.id=o.samples_id
                WHERE h.platform_id=? AND e.name=? AND s.repository=? AND s.revision=?''',
                (platform_id, engine, source['repository'], source['revision']))
            for row in rows:
                identity = (row['workload'], row['artifact'].hex(), row['contract'].hex())
                if (identity not in wanted or row['latency_status'] != 1
                        or not row['version'] or row['version'] == 'unknown'):
                    continue
                key = (*identity, row['captured_at'], platform_id, row['configuration_id'])
                grouped.setdefault(key, {})[row['phase']] = row
        count, already = 0, 0
        for item, key in zip(expected['workloads'], target['keys']):
            if key in ledger['items']:
                already += 1
                continue  # Never replace a live/repaired capture or hide a pending repair.
            if not re.fullmatch(r'[0-9a-f]{64}', key):
                raise ValueError('Invalid exported ledger key')
            required = [PHASES.index(p) for p in item['phases']]
            candidates = [(identity, rows) for identity, rows in grouped.items()
                          if identity[:3] == (item['workload']['id'], item['workload']['sha256'], item['contract'])
                          and all(p in rows for p in required)]
            for identity, rows in sorted(candidates, key=lambda pair: pair[0][3], reverse=True):
                results = [row_result(rows[phase]) for phase in required]
                if not all(valid_sample_count(row, 5, True) for row in results):
                    continue
                if item['kind'] != 'compatibility' and any(row['timingSamples'] < 5
                        or row.get('sampling', {}).get('method') == 'feature-compatibility-v1' for row in results):
                    continue
                old_platform = platforms[identity[4]]
                original_platform = {name: old_platform[name] for name in ['os', 'arch', 'cpu', 'cores', 'kernel']}
                original_platform['memoryBytes'] = old_platform['memory_bytes']
                capture = {'capturedAt': identity[3], 'source': source,
                           'platform': original_platform, 'results': results}
                kind = item['kind']
                name = 'feature-' + ('compat' if kind == 'compatibility' else 'perf') + '-' + engine + '-' + key + '.json'
                for directory in [campaign / 'captures', feature_root / 'captures']:
                    write(directory / name, capture)
                ledger['items'][key] = {'status': 'completed', 'engine': engine, 'stage': kind,
                    'workload': item['workload']['id'], 'source': source, 'capture': name,
                    'artifactSha256': item['workload']['sha256'], 'contractSha256': item['contract'],
                    'outcomes': [[row['phase'], row['latencyStatus']] for row in results],
                    'finished': datetime.now(timezone.utc).isoformat(), 'reusedFromDatabase': True,
                    'originalCapturedAt': identity[3], 'inputIdentity': expected['inputIdentity'],
                    **({'compatibilityScenarioPolicy': 'scope-aware-v2'} if kind == 'compatibility' else {})}
                count += 1
                break
        summary.append({'engine': engine, 'revision': source['revision'], 'reused': count,
                        'alreadyRecorded': already, 'total': len(expected['workloads'])})
        write(ledger_path, ledger)
        print(json.dumps(summary[-1]), flush=True)
    connection.close()
    receipt = {'anchor': expected['anchor'], 'inputIdentity': expected['manifestIdentity'],
               'workerInputIdentity': expected['inputIdentity'], 'summary': summary,
               'reused': sum(item['reused'] for item in summary),
               'updated': datetime.now(timezone.utc).isoformat()}
    write(campaign / 'feature-reuse-ready.json', receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--expected', type=Path, required=True)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--publisher', type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('publisher', args.publisher)
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    reuse(args.database, json.loads(args.expected.read_text()), args.campaign, publisher.valid_sample_count)


if __name__ == '__main__':
    main()
