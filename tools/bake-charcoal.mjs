// Offline game packaging of the generated charcoal-bed albedo (see credits).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const input=process.argv[2];if(!input)throw new Error('Usage: node tools/bake-charcoal.mjs SOURCE_PNG');
const out=new URL('../public/textures/',import.meta.url).pathname;
await sharp(input).resize(512,512).removeAlpha().webp({quality:95}).toFile(path.join(out,'charcoal_a.webp'));
// This is an albedo image, not a measured PBR scan. Do not invent depth from it.
for(const [suffix,color] of [['n',[128,128,255]],['m',[255,255,128]]])
 await sharp(Buffer.from(color),{raw:{width:1,height:1,channels:3}}).webp({lossless:true}).toFile(path.join(out,`charcoal_${suffix}.webp`));
if(process.env.CHARCOAL_ENCODER_MODULE){
 const {encodeToKTX2}=await import(process.env.CHARCOAL_ENCODER_MODULE);
 for(const suffix of ['a','n','m']){
  const png=await sharp(path.join(out,`charcoal_${suffix}.webp`)).png().toBuffer();
  const bytes=await encodeToKTX2(new Uint8Array(png),{isUASTC:suffix!=='a',isYFlip:true,generateMipmap:true,isKTX2File:true,isSetKTX2SRGBTransferFunc:suffix==='a',isPerceptual:suffix==='a',qualityLevel:255,compressionLevel:4,imageDecoder:async b=>{const{data,info}=await sharp(Buffer.from(b)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return{data:new Uint8Array(data),width:info.width,height:info.height};}});
  fs.writeFileSync(path.join(out,`charcoal_${suffix}.ktx2.wasm`),bytes);console.log(suffix,bytes.length);
 }
}
