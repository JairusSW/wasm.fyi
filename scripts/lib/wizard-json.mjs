// Virgil's SDK JSON reader only accepts signed 32-bit integers. Workload
// provenance also contains unsigned checksums and floating point literals.
// Preserve those exact token bytes as strings; control fields remain integers.
export function wizardJSONParser(source) {
 const original=`\tdef parseNumber() -> JsonValue {
\t\tvar res = Ints.parseDecimal(data, pos);
\t\tvar len = res.0, val = res.1;
\t\tif (len <= 0) {
\t\t\tfail("invalid number");
\t\t\treturn ERR_RET;
\t\t}
\t\tadvance(len);
\t\treturn JsonValue.Int(val);
\t}`;
 if(!source.includes(original))throw Error('Pinned Virgil JSON number parser changed');
 const replacement=`\tdef parseNumber() -> JsonValue {
        var first = pos, end = pos;
        if (end < data.length && data[end] == '-') end++;
        if (end >= data.length || data[end] < '0' || data[end] > '9') {
            fail("invalid number"); return ERR_RET;
        }
        if (data[end] == '0') end++;
        else while (end < data.length && data[end] >= '0' && data[end] <= '9') end++;
        if (end < data.length && data[end] == '.') {
            end++;
            var fraction = end;
            while (end < data.length && data[end] >= '0' && data[end] <= '9') end++;
            if (end == fraction) { fail("invalid number fraction"); return ERR_RET; }
        }
        if (end < data.length && (data[end] == 'e' || data[end] == 'E')) {
            end++;
            if (end < data.length && (data[end] == '+' || data[end] == '-')) end++;
            var exponent = end;
            while (end < data.length && data[end] >= '0' && data[end] <= '9') end++;
            if (end == exponent) { fail("invalid number exponent"); return ERR_RET; }
        }
        var res = Ints.parseDecimal(data, first);
        var token = readToken(end - first).image;
        if (res.0 == end - first) return JsonValue.Int(res.1);
        return JsonValue.String(Ranges.dup(token));
\t}`;
 const originalString=`\tdef parseString() -> JsonValue {
\t\tvar res = Strings.parseLiteral(data, pos);
\t\tvar len = res.0;
\t\tif (len <= 0) {
\t\t\tfail("invalid string");
\t\t\treturn ERR_RET;
\t\t}
\t\tvar lit = readToken(len).image;
\t\treturn JsonValue.String(Ranges.dup(lit[1 ... lit.length - 1]));
\t}`;
 if(!source.includes(originalString))throw Error('Pinned Virgil JSON string parser changed');
 const stringParser=String.raw`    private def wasmfyiHex4(first: int) -> int {
        if (first + 4 > data.length) return -1;
        var value = 0;
        for (i < 4) {
            if (!Chars.isHex(data[first + i])) return -1;
            value = (value << 4) | Chars.hexValue(data[first + i]);
        }
        return value;
    }
    def parseString() -> JsonValue {
        if (pos >= data.length || data[pos] != '\"') { fail("invalid string"); return ERR_RET; }
        var end = pos + 1, buffer = StringBuilder.new();
        while (end < data.length) {
            var ch = data[end]; end++;
            if (ch == '\"') {
                var value = buffer.toString();
                if (!Utf8.validate(value[0 ... value.length])) { fail("invalid UTF-8 string"); return ERR_RET; }
                advance(end - pos);
                return JsonValue.String(value);
            }
            if (ch < ' ') { fail("unescaped string control character"); return ERR_RET; }
            if (ch != '\\') { buffer.putc(ch); continue; }
            if (end >= data.length) { fail("incomplete string escape"); return ERR_RET; }
            var escape = data[end]; end++;
            match (escape) {
                '\"' => buffer.putc('\"');
                '\\' => buffer.putc('\\');
                '/' => buffer.putc('/');
                'b' => buffer.putc(byte.view(8));
                'f' => buffer.putc(byte.view(12));
                'n' => buffer.putc('\n');
                'r' => buffer.putc('\r');
                't' => buffer.putc('\t');
                'u' => {
                    var codepoint = wasmfyiHex4(end); end += 4;
                    if (codepoint < 0) { fail("invalid Unicode escape"); return ERR_RET; }
                    if (codepoint >= 0xD800 && codepoint <= 0xDBFF) {
                        if (end + 6 > data.length || data[end] != '\\' || data[end + 1] != 'u') { fail("missing Unicode low surrogate"); return ERR_RET; }
                        var low = wasmfyiHex4(end + 2); end += 6;
                        if (low < 0xDC00 || low > 0xDFFF) { fail("invalid Unicode low surrogate"); return ERR_RET; }
                        codepoint = 0x10000 + ((codepoint - 0xD800) << 10) + low - 0xDC00;
                    }
                    var bytes = Array<byte>.new(4);
                    var length = Utf8.encode(u32.view(codepoint), bytes[0 ... bytes.length]);
                    if (length == 0) { fail("invalid Unicode codepoint"); return ERR_RET; }
                    for (i < length) buffer.putc(bytes[i]);
                }
                _ => { fail("invalid JSON string escape"); return ERR_RET; }
            }
        }
        fail("unterminated string"); return ERR_RET;
    }`;
 const renderer=String.raw`
// JSON string escaping differs from Virgil source literals.
component WasmfyiJsonCodec {
    def renderString(buffer: StringBuilder, value: string) -> StringBuilder {
        buffer.putc('\"');
        for (ch in value) {
            if (ch == '\"') buffer.puts("\\\"");
            else if (ch == '\\') buffer.puts("\\\\");
            else if (ch < ' ') {
                var index = int.view(ch);
                buffer.puts("\\u00");
                buffer.putc("0123456789abcdef"[index >> 4]);
                buffer.putc("0123456789abcdef"[index & 15]);
            } else buffer.putc(ch);
        }
        return buffer.putc('\"');
    }
}
`;
 return (source.replace(original,replacement).replace(originalString,stringParser)
  .replaceAll('Strings.renderLiteral','WasmfyiJsonCodec.renderString')+renderer)
  .replaceAll('ERR_RET','WASMFYI_JSON_ERROR_RETURN');
}
