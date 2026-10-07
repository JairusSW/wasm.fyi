/* SQLite's supported OS_OTHER embedding interface. Only :memory: databases
 * are admitted; no filesystem or simulated host syscalls are provided. */
#include "sqlite3.h"
#include <stdint.h>
#include <string.h>
static int deny_open(sqlite3_vfs *v,const char *n,sqlite3_file *f,int flags,int *out) { return SQLITE_CANTOPEN; }
static int deny_delete(sqlite3_vfs *v,const char *n,int sync) { return SQLITE_IOERR_DELETE; }
static int access_path(sqlite3_vfs *v,const char *n,int flags,int *out) { *out=0; return SQLITE_OK; }
static int full_path(sqlite3_vfs *v,const char *n,int len,char *out) { return SQLITE_CANTOPEN; }
static int entropy(sqlite3_vfs *v,int n,char *out) { /* Deterministic benchmark seed, not a security RNG. */
  uint32_t x=0x12345678; for(int i=0;i<n;i++){x^=x<<13;x^=x>>17;x^=x<<5;out[i]=(char)x;}return n;
}
static sqlite3_vfs memory_vfs={.iVersion=1,.szOsFile=sizeof(sqlite3_file),.mxPathname=128,.zName="benchmark-memory-only",.xOpen=deny_open,.xDelete=deny_delete,.xAccess=access_path,.xFullPathname=full_path,.xRandomness=entropy};
int sqlite3_os_init(void) { return sqlite3_vfs_register(&memory_vfs,1); }
int sqlite3_os_end(void) { return SQLITE_OK; }
static void require(int ok) { if(!ok)__builtin_trap(); }
__attribute__((export_name("benchmark"))) uint32_t benchmark(void) {
 sqlite3 *db=0; sqlite3_stmt *s=0; uint32_t hash=2166136261u;
 require(sqlite3_open_v2(":memory:",&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,0)==SQLITE_OK);
 require(sqlite3_exec(db,"CREATE TABLE ledger(n INTEGER PRIMARY KEY,value INTEGER); BEGIN; WITH RECURSIVE events(n,value) AS (VALUES(1,12345) UNION ALL SELECT n+1,(value+48271)%1000003 FROM events WHERE n<10000) INSERT INTO ledger SELECT * FROM events; COMMIT; BEGIN; UPDATE ledger SET value=0; ROLLBACK;",0,0,0)==SQLITE_OK);
 const char *sql="SELECT count(*),sum(value),sum(CASE WHEN value%257=0 THEN value ELSE 0 END),sum(value&4095) FROM ledger;";
 require(sqlite3_prepare_v2(db,sql,-1,&s,0)==SQLITE_OK); require(sqlite3_step(s)==SQLITE_ROW);
 for(int i=0;i<4;i++){uint64_t value=(uint64_t)sqlite3_column_int64(s,i);for(int j=0;j<8;j++){hash=(hash^(uint8_t)value)*16777619u;value>>=8;}}
 require(sqlite3_step(s)==SQLITE_DONE); require(sqlite3_finalize(s)==SQLITE_OK);require(sqlite3_close(db)==SQLITE_OK);require(sqlite3_shutdown()==SQLITE_OK); return hash;
}
