const fs=require('fs');
const cp=require('child_process');
const files=fs.readFileSync('changed_js.txt','utf8').split(/\r?\n/).filter(Boolean);
let fail=0;
for(const f of files){
  try{
    cp.execSync('node --check "' + f + '"',{stdio:'pipe'});
    console.log('PASS',f);
  }catch(e){
    fail++;
    console.log('FAIL',f);
    console.log(e.message);
    if(e.stderr) console.log(e.stderr.toString());
    if(e.stdout) console.log(e.stdout.toString());
  }
}
console.log('');
console.log('SUMMARY: TOTAL',files.length,'FAIL',fail);
process.exit(fail?1:0);