#!/usr/bin/env python3
"""Source-bound native batch controls; no database capture."""
import ctypes as C
import json
import os
import pathlib
import sys

lib = C.CDLL(sys.argv[1])
P, U, S, B = C.c_void_p, C.c_uint64, C.c_size_t, C.c_uint8
for name, result, arguments in [
    ('wb_error', C.c_char_p, []), ('wb_engine_new', P, []),
    ('wb_engine_delete', None, [P]), ('wb_module_new', P, [P, P, S]),
    ('wb_module_delete', None, [P]), ('wb_instance_new', P, [P, P]),
    ('wb_instance_delete', None, [P]),
    ('wb_call', C.c_int, [P, C.c_char_p, C.POINTER(U), S, C.POINTER(U), S]),
    ('wb_memory', C.POINTER(B), [P, C.POINTER(S)]),
    ('wb_call_verified_batch', C.c_int, [P, C.c_char_p, C.POINTER(U), S,
     C.POINTER(U), S, S, C.POINTER(U), C.c_char_p, C.POINTER(U),
     C.POINTER(S), C.POINTER(C.POINTER(B)), S, C.POINTER(U)]),
]:
    function = getattr(lib, name)
    function.restype, function.argtypes = result, arguments

data = pathlib.Path(sys.argv[2]).read_bytes()
binary = C.create_string_buffer(data)
records = []
for mode in ['interpreter', 'jit']:
    if mode == 'interpreter':
        os.environ['ZWASM_INTERPRETER'] = '1'
    else:
        os.environ.pop('ZWASM_INTERPRETER', None)
    for operations, scalar, payload, offset, expected_error in [
        (1, 7, b'\x01\x02\x03\x04', 0, None),
        (1000000, 7, b'\x01\x02\x03\x04', 0, None),
        (3, 8, b'\x01\x02\x03\x04', 0, 'scalar oracle mismatch'),
        (3, 7, b'\x00\x02\x03\x04', 0, 'memory oracle mismatch'),
        (3, 7, b'\x01\x02\x03\x04', 2**64-1, 'outside bounds'),
    ]:
        engine = module = instance = None
        try:
            engine = lib.wb_engine_new()
            module = lib.wb_module_new(engine, binary, len(data))
            instance = lib.wb_instance_new(engine, module)
            assert instance, lib.wb_error().decode()
            result, elapsed = (U * 1)(), U()
            expected, offsets, lengths = (U * 1)(scalar), (U * 1)(offset), (S * 1)(len(payload))
            bytes_buffer = (B * len(payload)).from_buffer_copy(payload)
            pointers = (C.POINTER(B) * 1)(C.cast(bytes_buffer, C.POINTER(B)))
            status = lib.wb_call_verified_batch(instance, b'step', None, 0,
                result, 1, operations, expected, b'output_pointer', offsets,
                lengths, pointers, 1, C.byref(elapsed))
            reason = lib.wb_error().decode()
            if expected_error:
                assert status == -1 and expected_error in reason, (status, reason)
            else:
                assert status == 0 and result[0] == 7 and elapsed.value > 0, (status, reason)
            count = (U * 1)()
            assert lib.wb_call(instance, b'count', None, 0, count, 1) == 0
            assert count[0] == (1 if expected_error else operations), count[0]
            if operations > 1 and not expected_error:
                pointer, size = (U * 1)(), S()
                assert lib.wb_call(instance, b'output_pointer', None, 0, pointer, 1) == 0
                memory = lib.wb_memory(instance, C.byref(size))
                assert pointer[0] == 65536 and size.value == 131072
                assert C.string_at(C.addressof(memory.contents)+pointer[0], 4) == payload
            records.append(dict(mode=mode, operations=operations, guestCalls=count[0],
                expectedError=expected_error, status=status, elapsedNs=elapsed.value))
        finally:
            if instance: lib.wb_instance_delete(instance)
            if module: lib.wb_module_delete(module)
            if engine: lib.wb_engine_delete(engine)
print(json.dumps({'status': 'qualified', 'records': records,
    'scope': 'Native per-operation scalar and memory oracle checks, pointer movement and memory growth; no DB'}))
