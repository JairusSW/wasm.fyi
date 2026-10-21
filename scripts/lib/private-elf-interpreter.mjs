import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const anchor=`\t\tif interpreter != allowed || allowed == "" {
\t\t\treturn "", true, fmt.Errorf("unsupported ELF interpreter %q", interpreter)
\t\t}`;
const replacement=`\t\tprivateAllowed := ""
\t\tif image.Machine == elf.EM_X86_64 {
\t\t\tif directory := os.Getenv("WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR"); directory != "" {
\t\t\t\tabsolute, err := filepath.Abs(directory)
\t\t\t\tif err != nil || absolute != filepath.Clean(directory) {
\t\t\t\t\treturn "", true, fmt.Errorf("invalid configured private glibc directory")
\t\t\t\t}
\t\t\t\tprivateAllowed = filepath.Join(absolute, "ld-linux-x86-64.so.2")
\t\t\t}
\t\t}
\t\tif (interpreter != allowed && interpreter != privateAllowed) || allowed == "" {
\t\t\treturn "", true, fmt.Errorf("unsupported ELF interpreter %q", interpreter)
\t\t}`;

export function privateELFInterpreterSource(source){
 if(source.includes('privateAllowed := ""'))return source;
 if(!source.includes(anchor))throw Error('ELF interpreter qualification seam changed');
 return source.replace(anchor,replacement);
}

export async function applyPrivateELFInterpreter(root){
 const path=join(root,'experiment/native_elf.go');
 const source=await readFile(path,'utf8'),next=privateELFInterpreterSource(source);
 if(next!==source)await writeFile(path,next);
}
