"""Build a separate MVP oracle driver; the corpus artifact remains untouched."""
import struct


def uleb(n):
    out = bytearray()
    while True:
        value = n & 127; n >>= 7
        out.append(value | (128 if n else 0))
        if not n: return bytes(out)


def sleb(n):
    out = bytearray()
    while True:
        value = n & 127; n >>= 7
        done = n == 0 and not value & 64 or n == -1 and value & 64
        out.append(value | (0 if done else 128))
        if done: return bytes(out)


def text(value):
    data = value.encode(); return uleb(len(data)) + data


class Reader:
    def __init__(self, data): self.data, self.pos = data, 0
    def byte(self):
        value = self.data[self.pos]; self.pos += 1; return value
    def number(self):
        value = shift = 0
        while True:
            byte = self.byte(); value |= (byte & 127) << shift
            if byte < 128: return value
            shift += 7
            if shift > 70: raise ValueError('malformed integer')
    def name(self):
        n = self.number(); value = self.data[self.pos:self.pos+n]; self.pos += n; return value.decode()
    def valtype(self):
        start = self.pos; kind = self.byte()
        if kind in [0x63, 0x64]: self.number()
        return self.data[start:self.pos]
    def limits(self):
        start = self.pos; flags = self.number(); self.number()
        if flags & 1: self.number()
        if flags & 8: self.number()
        return self.data[start:self.pos], bool(flags & 4)
    def subtype(self):
        kind = self.byte()
        if kind in [0x4f, 0x50]:
            for _ in range(self.number()): self.number()
            kind = self.byte()
        if kind == 0x65: kind = self.byte()
        if kind == 0x60:
            params = [self.valtype() for _ in range(self.number())]
            results = [self.valtype() for _ in range(self.number())]
            return params, results
        if kind == 0x5f:
            for _ in range(self.number()): self.valtype(); self.byte()
        elif kind == 0x5e: self.valtype(); self.byte()
        else: raise ValueError('unsupported: type section encoding')
        return None


def inspect(data):
    if data[:8] != b'\0asm\1\0\0\0': raise ValueError('unsupported: core Wasm driver required')
    reader = Reader(data); reader.pos = 8
    types, functions, memories, exports = [], [], [], {}
    while reader.pos < len(data):
        kind = reader.byte(); n = reader.number()
        section = Reader(data[reader.pos:reader.pos+n]); reader.pos += n
        if kind == 1:
            for _ in range(section.number()):
                if section.data[section.pos] == 0x4e:
                    section.byte()
                    for _ in range(section.number()): types.append(section.subtype())
                else: types.append(section.subtype())
        elif kind == 2:
            for _ in range(section.number()):
                section.name(); section.name(); entry = section.byte()
                if entry == 0: functions.append(section.number())
                elif entry == 1: section.valtype(); section.limits()
                elif entry == 2: memories.append(section.limits())
                elif entry == 3: section.valtype(); section.byte()
                elif entry == 4: section.byte(); section.number()
                else: raise ValueError('unsupported: import encoding')
        elif kind == 3:
            functions += [section.number() for _ in range(section.number())]
        elif kind == 5:
            memories += [section.limits() for _ in range(section.number())]
        elif kind == 7:
            for _ in range(section.number()):
                name = section.name(); entry = section.byte(); index = section.number(); exports[name] = entry, index
    return types, functions, memories, exports


def constant(kind, value):
    n = int(value)
    integer = 0x7f if kind in [b'\x7f', b'\x7d'] else 0x7e
    bits = 32 if integer == 0x7f else 64
    n &= (1 << bits) - 1
    if n >= 1 << (bits-1): n -= 1 << bits
    code = bytes([0x41 if integer == 0x7f else 0x42]) + sleb(n)
    if kind == b'\x7d': code += b'\xbe'
    if kind == b'\x7c': code += b'\xbf'
    return code


def build_driver(data, workload, module_name):
    types, functions, memories, exports = inspect(data)
    signatures, imports, imported = [], [], {}
    body = bytearray()
    expected_words = []
    signatures.append(([b"\x7f"], []))
    imports.append(text("wasmfyi-qualification")+text("word")+b"\0"+uleb(0))
    imported["@word"] = 0, ([b"\x7f"], [])
    needs_memory = bool(workload.get('input') or workload.get('vectors') or workload['oracle'].get('memory'))
    memory_type = b'\x7f'

    def function(name):
        if name not in imported:
            if name not in exports or exports[name][0] != 0: raise ValueError('missing exported function: ' + name)
            signature = types[functions[exports[name][1]]]
            if signature is None or any(v not in [b'\x7f', b'\x7e', b'\x7d', b'\x7c'] for v in sum(signature, [])):
                raise ValueError('unsupported: nonnumeric qualification export')
            index = len(imported); imported[name] = index, signature
            signatures.append(signature)
            imports.append(text(module_name) + text(name) + b'\0' + uleb(index))
        return imported[name]

    def invoke(name, args):
        index, (params, results) = function(name)
        if len(params) != len(args): raise ValueError('argument count mismatch')
        for kind, value in zip(params, args): body.extend(constant(kind, value))
        body.extend(b'\x10' + uleb(index))
        return results

    def expect(kind, value):
        if kind == b'\x7d': body.extend(b'\xbc'); kind = b'\x7f'
        if kind == b'\x7c': body.extend(b'\xbd'); kind = b'\x7e'
        if kind == b'\x7f':
            body.extend(b'\x22\0\x10\0\x20\0')
            expected_words.append(int(value) & 0xffffffff)
        else:
            body.extend(b'\x21\2\x20\2\xa7\x10\0\x20\2\x42\x20\x88\xa7\x10\0\x20\2')
            expected_words.extend([int(value) & 0xffffffff, (int(value) >> 32) & 0xffffffff])
        body.extend(constant(kind, value))
        body.extend(bytes([0x47 if kind == b'\x7f' else 0x52]) + b'\x04\x40\x00\x0b')

    def pointer(record, key, offset):
        if record.get(key):
            results = invoke(record[key], [])
            if len(results) != 1: raise ValueError('pointer must have one result')
            if results[0] != memory_type: body.extend(b'\xad' if memory_type == b'\x7e' else b'\xa7')
            body.extend(constant(memory_type, offset) + (b'\x7c' if memory_type == b'\x7e' else b'\x6a'))
        else: body.extend(constant(memory_type, offset))
        body.extend(b'\x21\x01')

    def read(expected):
        for offset in range(0, len(expected), 4):
            chunk = expected[offset:offset+4]
            if len(chunk) == 4:
                body.extend(b'\x20\x01\x28\0' + uleb(offset))
                expect(b'\x7f', int.from_bytes(chunk, 'little'))
            else:
                for j, value in enumerate(chunk):
                    body.extend(b'\x20\x01\x2d\0' + uleb(offset+j)); expect(b'\x7f', value)

    if workload.get('initialize'):
        if invoke(workload['initialize'], []): raise ValueError('initializer must return no values')
    if needs_memory:
        candidates = [(name, index) for name, (kind, index) in exports.items() if kind == 2 and index == 0]
        if not candidates: raise ValueError('unsupported: oracle requires exported memory 0')
        name, index = candidates[0]; limits, is64 = memories[index]
        memory_type = b'\x7e' if is64 else b'\x7f'
        imports.append(text(module_name)+text(name)+b'\2'+limits)
    if workload.get('input'):
        source = workload['input']; pointer(source, 'pointer_export', source['offset'])
        payload = bytes.fromhex(source['hex'])
        for offset in range(0, len(payload), 4):
            chunk = payload[offset:offset+4]
            if len(chunk) == 4:
                body.extend(b'\x20\x01' + constant(b'\x7f', int.from_bytes(chunk, 'little')) + b'\x36\0' + uleb(offset))
            else:
                for j, value in enumerate(chunk): body.extend(b'\x20\x01' + constant(b'\x7f', value) + b'\x3a\0' + uleb(offset+j))
    oracle = workload['oracle']
    if oracle['kind'] == 'exact_vectors':
        vectors = workload['vectors']
        for case in vectors['cases']:
            pointer(vectors, 'input_ptr_export', 0 if vectors.get('input_ptr_export') else vectors['input_offset'])
            body.extend(b'\x41\0\x21\0\x02\x40\x03\x40\x20\0' + constant(b'\x7f', case['len']) + b'\x4f\x0d\x01\x20\x01\x20\0')
            if memory_type == b'\x7e': body.extend(b'\xad')
            body.extend(b'\x7c' if memory_type == b'\x7e' else b'\x6a')
            if vectors.get('mod'): body.extend(b'\x20\0' + constant(b'\x7f', vectors['mod']) + b'\x70')
            else: body.extend(b'\x41\0')
            body.extend(b'\x3a\0\0\x20\0\x41\x01\x6a\x21\0\x0c\0\x0b\x0b')
            index, (params, results) = function(workload['export'])
            if len(params) != 3: raise ValueError('vector export requires three arguments')
            body.extend(b'\x20\x01');body.extend(constant(params[1], case['len']))
            if vectors.get('output_ptr_export'): invoke(vectors['output_ptr_export'], [])
            else: body.extend(constant(params[2], vectors['output_offset']))
            body.extend(b'\x10'+uleb(index)+b'\x1a'*len(results))
            pointer(vectors, 'output_ptr_export', 0 if vectors.get('output_ptr_export') else vectors['output_offset'])
            read(bytes.fromhex(case['out']))
    else:
        results = invoke(workload['export'], workload.get('args', []))
        if len(results) != len(oracle['expected']): raise ValueError('oracle arity mismatch')
        for kind, value in reversed(list(zip(results, oracle['expected']))): expect(kind, value)
        for record in oracle.get('memory', []):
            pointer(oracle, 'output_pointer_export', record['offset']); read(bytes.fromhex(record['hex']))
    marker = len(imported); signatures.append(([], []))
    imports.append(text('wasmfyi-qualification')+text('verified')+b'\0'+uleb(marker))
    body.extend(b'\x10'+uleb(marker)+b'\x41\0\x0b')
    main_type = len(signatures); signatures.append(([], [b'\x7f']))
    type_section = uleb(len(signatures)) + b''.join(b'\x60'+uleb(len(p))+b''.join(p)+uleb(len(r))+b''.join(r) for p, r in signatures)
    # One i32 loop counter and one memory-address local.
    code = b'\3\1\x7f\1'+memory_type+b'\1\x7e'+body
    sections = [(1, type_section), (2, uleb(len(imports))+b''.join(imports)), (3, b'\1'+uleb(main_type)), (7, b'\1'+text('qualification')+b'\0'+uleb(marker+1)), (10, b'\1'+uleb(len(code))+code)]
    return b'\0asm\1\0\0\0'+b''.join(bytes([kind])+uleb(len(value))+value for kind, value in sections), expected_words
