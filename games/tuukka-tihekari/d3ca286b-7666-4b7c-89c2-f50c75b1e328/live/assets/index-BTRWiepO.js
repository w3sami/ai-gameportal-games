try {
  const response=await fetch(new URL('./runtime.js',import.meta.url));
  if(!response.ok) throw new Error('Runtime download failed: '+response.status);
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  const source=await new Response(stream).text();
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  try { await import(url); } finally { URL.revokeObjectURL(url); }
} catch(error) {
  console.error(error);
  const message=document.createElement('p');
  message.textContent='Pelin käynnistys epäonnistui. Käytä ajan tasalla olevaa selainta ja lataa sivu uudelleen.';
  message.style='position:fixed;inset:20%;z-index:99999;background:#181d25;color:white;padding:2rem';
  document.body.append(message);
}

