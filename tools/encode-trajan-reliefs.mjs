// Development-only GPU compression; install ktx2-encoder in an external prefix
// or provide TRAJAN_ENCODER_MODULE. Same settings as world albedo textures.
import sharp from 'sharp';
import fs from 'node:fs';
const {encodeToKTX2}=await import(process.env.TRAJAN_ENCODER_MODULE || 'ktx2-encoder');
const source=new URL('../public/models/trajan/reliefs.webp',import.meta.url);
const png=await sharp(source.pathname).png().toBuffer();
const data=await encodeToKTX2(new Uint8Array(png),{
 isUASTC:false,isYFlip:true,generateMipmap:true,isKTX2File:true,
 isSetKTX2SRGBTransferFunc:true,isPerceptual:true,qualityLevel:255,compressionLevel:4,
 imageDecoder:async bytes=>{const{data,info}=await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({resolveWithObject:true});return{data:new Uint8Array(data),width:info.width,height:info.height};},
});
fs.writeFileSync(new URL('../public/models/trajan/reliefs.ktx2.wasm',import.meta.url),data);
console.log('relief atlas KTX2 bytes',data.length);
