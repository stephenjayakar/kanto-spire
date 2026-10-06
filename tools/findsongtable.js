const fs=require('fs');const rom=fs.readFileSync(__dirname+'/../rom/firered.gba');
const ms=[0,1,1,1,1,2,1,2,1,1,1,1,1,1,1,1];
for(let a=0;a<rom.length-200;a+=4){let ok=true;for(let i=0;i<ms.length;i++){const o=a+i*8;const p=rom.readUInt32LE(o);if((p>>>24)!==8||rom.readUInt16LE(o+4)!==ms[i]||rom.readUInt16LE(o+6)!==ms[i]){ok=false;break}}if(ok)console.log('songtable at 0x'+a.toString(16));}
