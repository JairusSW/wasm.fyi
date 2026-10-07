// Binaryen's tagged binary releases include the tag in parentheses, while a
// local build at the same revision prints only the numeric version.
export function isBinaryen130Version(version) {
  return /^wasm-opt version 130(?: \(version_130\))?$/.test(version.trim());
}
