const http = require('http');
const fs = require('fs');

async function run() {
  const urlPath = '/DXR.axd?r=1_211,1_304,1_185,1_298,1_221,1_188,1_182,1_290,1_296,1_279,1_198,1_303,1_190,1_223,1_291,1_287,1_184,1_196,1_254,1_256,1_263,1_262,1_261,1_258,1_257,1_235,1_248,1_244,1_242,1_251,1_250,1_249,1_245,1_260,1_241,1_239,1_247,1_209,1_201,1_217,1_208,1_207,1_288,1_199,1_206,1_212,1_197,1_286,1_289,1_224-Sh_st';
  
  console.log('Downloading DXR JavaScript...');
  const content = await new Promise((resolve, reject) => {
    http.get({ hostname: '172.25.3.51', port: 9001, path: urlPath }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });

  console.log('Length:', content.length);

  const idx = content.indexOf('SerializeCallbackArgs:');
  if (idx !== -1) {
    console.log('SerializeCallbackArgs:');
    console.log(content.substring(idx, idx + 400));
  }

  process.exit(0);

  process.exit(0);
}

run();
