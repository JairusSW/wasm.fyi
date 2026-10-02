// Classify the measured operation, independently of its source repository.
export function workloadCategory(w) {
  if (w.id.startsWith('features/')) return `Features · ${w.provenance?.feature || w.features?.[0] || 'baseline'}`;
  if (w.id.startsWith('applications/') && w.provenance?.category) return w.provenance.category;
  const name = w.id.split('/')[1];
  const tags = new Set(w.original_contract?.tags || []);
  if (tags.has('bioinformatics') || ['lcs-substrings','needleman-wunsch-dna','smith-waterman-dna','fasttree-phylogeny','seqtk-fastq-to-fasta','polybench-nussinov'].includes(name)) return 'Bioinformatics';
  if (tags.has('fpga')) return 'Hardware design';
  if (tags.has('compiler') || tags.has('formatter')) return 'Compilers & development tools';
  if (tags.has('interpreter') || ['wren','wren-modulo','lua'].includes(name)) return 'Language runtimes';
  if (tags.has('database') || tags.has('sql')) return 'Databases & analytics';
  if (tags.has('filesystem')) return 'Files & directories';
  if (tags.has('search')) return 'Search & indexing';
  if (tags.has('json') || name==='cjson') return 'JSON & serialization';
  if (tags.has('xml') || tags.has('text') || tags.has('base64') || ['sightglass-shootout-base64','tinyxml2'].includes(name)) return 'Text & parsing';
  if (name==='coreutils-sha256sum' || name==='embench-crc32' || name==='embench-nettle-aes' || name==='embench-nettle-sha256' || name==='sightglass-libsodium-hash' || tags.has('encryption')) return 'Hashing & cryptography';
  if (name==='embench-huffbench') return 'Compression';
  if (name==='embench-matmult-int') return 'Linear algebra';
  if (name==='embench-qrduino') return 'Graphics & images';
  if (name==='tacle-bsort' || tags.has('sort')) return 'Integer & graph algorithms';
  if (name==='kissfft') return 'Audio';
  if (name==='raytrace') return '3D & rendering';
  if (['tiny', 'fib_rec', 'memory', 'memory_tree', 'dispatch', 'many_funcs', 'linked_list'].includes(name)) return 'Calls & memory';
  if (['json-as', 'json-as-simd', 'yyjson'].includes(name)) return 'JSON & serialization';
  if (['utf-as', 'utf-as-simd', 'utf8proc', 'fastfloat', 'pcre2'].includes(name)) return 'Text & parsing';
  if (['sha256', 'blake-as', 'blake-as-simd'].includes(name) || tags.has('hashing') || tags.has('crypto')) return 'Hashing & cryptography';
  if (tags.has('compression')) return 'Compression';
  if (tags.has('audio')) return 'Audio';
  if (name === 'raytrace' || tags.has('image') || tags.has('graphics') || tags.has('image-processing')) return 'Graphics & images';
  if (name === 'matmul' || tags.has('linear-algebra') || tags.has('blas') || tags.has('solver')) return 'Linear algebra';
  if (tags.has('stencil')) return 'Stencils';
  if (tags.has('statistics')) return 'Statistics';
  if (name === 'nbody' || name === 'libtommath' || tags.has('numerical')) return 'Numerical arithmetic';
  if (name === 'fannkuch' || name === 'coremark' || tags.has('graph') || tags.has('dynamic-programming')) return 'Integer & graph algorithms';
  throw new Error('Uncategorized application workload: ' + w.id);
}

export function compareWorkloads(a, b) {
  return Number(a.id.startsWith('features/')) - Number(b.id.startsWith('features/'))
    || a.group.localeCompare(b.group) || a.id.localeCompare(b.id, undefined, { numeric: true });
}
