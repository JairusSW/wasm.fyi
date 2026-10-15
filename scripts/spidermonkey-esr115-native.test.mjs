import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {repairSpiderMonkeyESR115} from './lib/spidermonkey-esr115.mjs';

test('qualified ESR115 repair compiles with an actually non-movable mutex',async t=>{
 const root=await mkdtemp(join(tmpdir(),'spider-esr115-native-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const header=join(root,'js/src/threading/ExclusiveData.h');await mkdir(join(root,'js/src/threading'),{recursive:true});
 await writeFile(header,`#include <mutex>
#include <type_traits>
#include <utility>
template<typename T> class ExclusiveData {
 std::mutex lock_;
 T value_;
 public:
 ExclusiveData():value_(42){}
 ExclusiveData(const ExclusiveData&) = delete;
 ExclusiveData& operator=(const ExclusiveData&) = delete;
 ExclusiveData(ExclusiveData&& rhs)
      : lock_(std::move(rhs.lock)), value_(std::move(rhs.value_)) {
    MOZ_ASSERT(&rhs != this, "self-move disallowed!");
  }

  ExclusiveData& operator=(ExclusiveData&& rhs) {
    this->~ExclusiveData();
    new (mozilla::KnownNotNull, this) ExclusiveData(std::move(rhs));
    return *this;
  }
 T value()const{return value_;}
};
static_assert(!std::is_move_constructible_v<ExclusiveData<int>>);
static_assert(!std::is_move_assignable_v<ExclusiveData<int>>);
static_assert(!std::is_copy_constructible_v<ExclusiveData<int>>);
int main(){ExclusiveData<int> data;return data.value()!=42;}
`);
 await repairSpiderMonkeyESR115(root,'1.66.0',{WASMFYI_SPIDERMONKEY_ESR115_MOVE_FIX:'1'},'linux');
 const cpp=join(root,'test.cpp'),binary=join(root,'test');await writeFile(cpp,await readFile(header));
 const compiled=spawnSync(process.env.WASMFYI_TEST_CXX||'c++',['-std=c++20','-pthread',cpp,'-o',binary],{encoding:'utf8',timeout:15000});
 assert.equal(compiled.status,0,compiled.error?.message||compiled.stderr);
 const ran=spawnSync(binary,[],{encoding:'utf8',timeout:5000});assert.equal(ran.status,0,ran.error?.message||ran.stderr);
});
