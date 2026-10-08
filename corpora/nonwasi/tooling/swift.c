#include <stdint.h>
#include <string.h>
#include "tree_sitter/api.h"
extern const TSLanguage *tree_sitter_swift(void);
static const char source[] =
"struct Counter {\n var value: Int = 0\n mutating func advance(by step: Int) -> Int {\n for index in 0..<32 { value += index * step }\n return value\n }\n}\n"
"enum Outcome<T> { case success(T); case failure(String) }\n"
"func transform(_ values: [Int]) -> [Int] { return values.filter { $0 % 2 == 0 }.map { $0 * 3 } }\n"
"protocol Named { var name: String { get } }\n"
"extension Counter { func snapshot() -> String { return String(value) } }\n";
static uint32_t walk(TSNode node,uint32_t *count) { uint32_t h=2166136261u;(*count)++;const char*t=ts_node_type(node);while(*t)h=(h^(unsigned char)*t++)*16777619u;h=(h^ts_node_start_byte(node))*16777619u;h=(h^ts_node_end_byte(node))*16777619u;for(uint32_t j=0;j<ts_node_child_count(node);j++)h=(h^walk(ts_node_child(node,j),count))*16777619u;return h; }
void reset(void) {}
uint32_t run(void) {
 TSParser*p=ts_parser_new();if(!ts_parser_set_language(p,tree_sitter_swift()))__builtin_trap();uint32_t hash=2166136261u;
 for(int j=0;j<24;j++){TSTree*tree=ts_parser_parse_string(p,0,source,sizeof(source)-1);if(!tree)__builtin_trap();TSNode root=ts_tree_root_node(tree);if(ts_node_has_error(root))__builtin_trap();uint32_t count=0;hash=(hash^walk(root,&count))*16777619u;if(count<100)__builtin_trap();ts_tree_delete(tree);ts_parser_reset(p);}
 ts_parser_delete(p);return hash;
}
