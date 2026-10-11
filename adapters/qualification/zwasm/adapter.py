"""Phase-separated C API sampling with module caching and native call clocks."""
import ctypes as C
import hashlib
import json
import os
import sys
import time

if '--interpreter' in sys.argv[2:]:
    os.environ['ZWASM_INTERPRETER'] = '1'
elif '--jit' in sys.argv[2:]:
    os.environ.pop('ZWASM_INTERPRETER', None)
lib = C.CDLL(sys.argv[1])
pointer = C.c_void_p
u64 = C.c_uint64
size = C.c_size_t
byte = C.c_uint8
for name, restype, arguments in [
    ('wb_error', C.c_char_p, []), ('wb_version', C.c_char_p, []),
    ('wb_engine_new', pointer, []), ('wb_engine_delete', None, [pointer]),
    ('wb_module_new', pointer, [pointer, pointer, size]), ('wb_module_delete', None, [pointer]),
    ('wb_instance_new', pointer, [pointer, pointer]), ('wb_instance_delete', None, [pointer]),
    ('wb_signature', C.c_int, [pointer, C.c_char_p, pointer, C.POINTER(size), pointer, C.POINTER(size)]),
    ('wb_call', C.c_int, [pointer, C.c_char_p, pointer, size, pointer, size]),
    ('wb_memory', pointer, [pointer, C.POINTER(size)]),
    ('wb_native_size', C.c_int, [pointer, C.POINTER(size)]),
    ('wb_call_batch', C.c_int, [pointer, C.c_char_p, pointer, size, pointer, size, size, C.POINTER(u64)]),
    ('wb_call_verified_batch', C.c_int, [pointer, C.c_char_p, pointer, size, pointer, size, size, pointer, C.c_char_p, pointer, pointer, pointer, size, C.POINTER(u64)]),
]:
    function = getattr(lib, name)
    function.restype, function.argtypes = restype, arguments


def check(ok):
    if not ok:
        raise RuntimeError(lib.wb_error().decode())


def call(instance, name, arguments):
    params, results = (byte * 32)(), (byte * 32)()
    np, nr = size(32), size(32)
    check(lib.wb_signature(instance, name.encode(), params, C.byref(np), results, C.byref(nr)) == 0)
    if np.value != len(arguments):
        raise ValueError('export argument count mismatch')
    args = (u64 * len(arguments))(*[int(n) for n in arguments])
    out = (u64 * nr.value)()
    check(lib.wb_call(instance, name.encode(), args, len(arguments), out, nr.value) == 0)
    return [str(n) for n in out]


def address(instance, record, key):
    return int(call(instance, record[key], [])[0]) if record.get(key) else 0


def memory(instance, offset, length):
    count = size()
    base = lib.wb_memory(instance, C.byref(count))
    check(base)
    if offset < 0 or length < 0 or offset + length > count.value:
        raise ValueError('memory oracle/input outside bounds')
    return base + offset


def call_batch(instance, name, arguments, operations=1):
    params, results = (byte * 32)(), (byte * 32)()
    np, nr = size(32), size(32)
    check(lib.wb_signature(instance, name.encode(), params, C.byref(np), results, C.byref(nr)) == 0)
    if np.value != len(arguments):
        raise ValueError('export argument count mismatch')
    args = (u64 * len(arguments))(*[int(n) for n in arguments])
    out, elapsed = (u64 * nr.value)(), u64()
    check(lib.wb_call_batch(instance, name.encode(), args, len(arguments), out, nr.value, operations, C.byref(elapsed)) == 0)
    return [str(n) for n in out], elapsed.value


class Session:
    def __init__(self, preparation, data):
        self.preparation, self.data = preparation, data
        self.binary = C.create_string_buffer(data)
        self.engine = self.module = self.retained = None
        oracle = preparation['workload']['oracle']
        self.memory_checks = oracle.get('memory', [])
        if self.memory_checks:
            expected = [int(n) for n in oracle['expected']]
            if any(n < 0 or n > 0xffffffffffffffff for n in expected):
                raise ValueError('scalar oracle outside unsigned 64-bit range')
            self.expected = (u64 * len(expected))(*expected)
            self.check_bytes = [C.create_string_buffer(bytes.fromhex(record['hex'])) for record in self.memory_checks]
            self.check_offsets = (u64 * len(self.memory_checks))(*[record['offset'] for record in self.memory_checks])
            self.check_lengths = (size * len(self.memory_checks))(*[len(bytes.fromhex(record['hex'])) for record in self.memory_checks])
            self.check_pointers = (pointer * len(self.memory_checks))(*[C.cast(payload, pointer).value for payload in self.check_bytes])
            args = preparation['workload'].get('args', [])
            self.scalar_args = (u64 * len(args))(*[int(n) for n in args])
        vectors = preparation['workload'].get('vectors')
        self.vectors = []
        if vectors:
            mod = vectors.get('mod', 0)
            self.vectors = [(bytes(i % mod if mod else 0 for i in range(case['len'])), bytes.fromhex(case['out'])) for case in vectors['cases']]

    def close(self):
        if self.retained: lib.wb_instance_delete(self.retained)
        if self.module: lib.wb_module_delete(self.module)
        if self.engine: lib.wb_engine_delete(self.engine)
        self.retained = self.module = self.engine = None

    def compiled(self):
        if not self.module:
            if not self.engine:
                self.engine = lib.wb_engine_new(); check(self.engine)
            self.module = lib.wb_module_new(self.engine, self.binary, len(self.data))
            if not self.module:
                reason = lib.wb_error().decode()
                lib.wb_engine_delete(self.engine); self.engine = None
                raise RuntimeError(reason)
        return self.engine, self.module

    def initialize(self, instance):
        w = self.preparation['workload']
        if w.get('initialize'): call(instance, w['initialize'], [])
        if w.get('input'):
            source = w['input']; payload = bytes.fromhex(source['hex'])
            C.memmove(memory(instance, address(instance, source, 'pointer_export') + source['offset'], len(payload)), payload, len(payload))

    def execute(self, instance, operations):
        w = self.preparation['workload']; oracle = w['oracle']
        elapsed = 0
        if oracle['kind'] == 'exact_vectors':
            v = w['vectors']
            inp = address(instance, v, 'input_ptr_export') if v.get('input_ptr_export') else v['input_offset']
            out = address(instance, v, 'output_ptr_export') if v.get('output_ptr_export') else v['output_offset']
            for payload, expected in self.vectors:
                C.memmove(memory(instance, inp, len(payload)), payload, len(payload))
                _, measured = call_batch(instance, w['export'], [inp, len(payload), out]); elapsed += measured
                if C.string_at(memory(instance, out, len(expected)), len(expected)) != expected:
                    raise ValueError('vector memory oracle mismatch')
            return [], elapsed
        if self.memory_checks:
            out, measured = (u64 * len(self.expected))(), u64()
            check(lib.wb_call_verified_batch(instance, w['export'].encode(), self.scalar_args, len(self.scalar_args), out, len(out), operations, self.expected, oracle.get('output_pointer_export', '').encode(), self.check_offsets, self.check_lengths, self.check_pointers, len(self.memory_checks), C.byref(measured)) == 0)
            return [str(n) for n in out], measured.value
        result, elapsed = call_batch(instance, w['export'], w.get('args', []), operations)
        if result != [str(n) for n in oracle['expected']]:
            raise ValueError(f'scalar oracle mismatch: got {result}, expected {oracle["expected"]}')
        return result, elapsed

    def sample(self, phase, operations):
        w = self.preparation['workload']; cold = phase == 'compile'
        engine = module = instance = None
        try:
            if cold:
                engine = lib.wb_engine_new(); check(engine)
                start = time.monotonic_ns(); module = lib.wb_module_new(engine, self.binary, len(self.data)); elapsed = time.monotonic_ns() - start; check(module)
            else: engine, module = self.compiled()
            if phase == 'steady' and w['reset'] == 'stateless':
                if not self.retained:
                    self.retained = lib.wb_instance_new(engine, module); check(self.retained); self.initialize(self.retained)
                instance = self.retained
            else:
                start = time.monotonic_ns(); instance = lib.wb_instance_new(engine, module); instantiated = time.monotonic_ns() - start; check(instance)
                if phase == 'instantiate': elapsed = instantiated
                self.initialize(instance)
            result, called = self.execute(instance, operations if phase == 'steady' else 1)
            if phase in ('first-call', 'steady'): elapsed = called
            return {'warmup': False, 'verified': True, 'operations': operations if phase == 'steady' else 1, 'elapsed_ns': elapsed, 'result': result, 'sample_type': 'sequence_call_sum' if self.vectors else 'individual_operation' if operations == 1 else 'batch_average'}
        finally:
            if instance and instance != self.retained: lib.wb_instance_delete(instance)
            if cold:
                if module: lib.wb_module_delete(module)
                if engine: lib.wb_engine_delete(engine)

    def inspect(self):
        engine, module = self.compiled(); instance = lib.wb_instance_new(engine, module); check(instance)
        try:
            value = size()
            if lib.wb_native_size(instance, C.byref(value)) != 0: raise ValueError('unsupported: native code unavailable for interpreter')
            self.initialize(instance)
            self.inspection_result, _ = self.execute(instance, 1)
            return [{'metric': 'native.code_size', 'definition_version': 1, 'value': value.value, 'unit': 'bytes', 'scope': 'compiled_module', 'phase': 'compile', 'collector': 'Zwasm module executable allocation plus instance import thunks', 'collector_version': lib.wb_version().decode(), 'quality': 'engine_reported', 'profile': 'code', 'status': 'available', 'normalization_denominator': 'module'}]
        finally: lib.wb_instance_delete(instance)


prepared = data = session = None
for line in sys.stdin:
    request = json.loads(line)
    response = {'version': 1, 'id': request['id']}
    try:
        method = request['method']
        if method == 'describe':
            interpreter = bool(os.environ.get('ZWASM_INTERPRETER'))
            response['description'] = {'runtime': 'zwasm-interpreter' if interpreter else 'zwasm-jit', 'runtime_version': lib.wb_version().decode(), 'backend': 'interpreter' if interpreter else 'jit', 'build': 'Zwasm C API source ' + lib.wb_version().decode() + '; native embedding', 'embedding': 'Zwasm C API', 'abis': ['core'], 'scenarios': ['compile', 'instantiate', 'first-call', 'steady'], 'effective_configuration': {'purpose': 'phase-separated decode/native compile, fresh instance, native call timers; cached module and stateless steady instance', 'wasi': 'p3', 'backend': 'forced and checked with zwasm_instance_engine; no fallback'}}
        elif method == 'prepare':
            if session: session.close()
            session = None
            prepared = request['prepare']
            if prepared['profile'] not in ('timing', 'memory', 'code') or prepared['workload']['abi'] != 'core':
                raise ValueError('unsupported: core timing qualification required')
            if prepared['workload']['oracle']['kind'] not in ['exact_u64', 'exact_vectors']:
                raise ValueError('unsupported: oracle contract')
            with open(prepared['artifact'], 'rb') as artifact:
                data = artifact.read()
            if hashlib.sha256(data).hexdigest() != prepared['artifact_sha256']:
                raise ValueError('artifact hash mismatch')
            session = Session(prepared, data)
        elif method == 'inspect':
            if not session: raise ValueError('prepare required')
            response['diagnostics'] = session.inspect()
        elif method == 'run':
            run = request['run']
            if not session: raise ValueError('prepare required')
            phase, count, operations = run['scenario'], run['samples'], run['operations']
            if phase not in ('compile', 'instantiate', 'first-call', 'steady'): raise ValueError('unsupported: scenario')
            if not 1 <= count <= 35 or not 1 <= operations <= 1000000 or run['warmup'] != 0: raise ValueError('invalid zero-warmup bounded batch')
            w = prepared['workload']
            if operations != 1 and (phase != 'steady' or w.get('vectors') or w['reset'] != 'stateless'): raise ValueError('unsupported: lifecycle/vector/reset samples require one operation')
            if prepared['profile'] == 'code':
                if phase != 'compile' or count != 1 or operations != 1:
                    raise ValueError('unsupported: code size requires one compile pass')
                observations = session.inspect()
                response['samples'] = [{'index': 0, 'warmup': False, 'verified': True, 'operations': 1, 'elapsed_ns': 0, 'result': session.inspection_result, 'sample_type': 'individual_operation', 'observations': observations}]
            else:
                response['samples'] = [dict(session.sample(phase, operations), index=index) for index in range(count)]
        elif method == 'close':
            if session: session.close()
            prepared = data = session = None
        else:
            raise ValueError('unsupported: method')
        response['status'] = 'ok'
    except Exception as error:
        response.update(status='unsupported' if str(error).startswith('unsupported:') else 'error', reason=str(error))
    print(json.dumps(response), flush=True)
