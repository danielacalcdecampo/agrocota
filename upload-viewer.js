const fs = require('fs');
const path = require('path');

const SUPABASE_URL  = 'https://fafjknchnibdflpqyssf.supabase.co';
const SUPABASE_ANON = 'sb_publishable_3HDU_nViFfOubXqNplV5ow_8FV0Ix0r';
const BUCKET        = 'Agrocota';   // deve coincidir com bucket_id nas policies
const FILE_NAME     = 'cotacao-viewer.html';
const FILE_PATH     = path.join(__dirname, 'assets', FILE_NAME);

async function upload() {
  const fileBuffer = fs.readFileSync(FILE_PATH);

  // Deleta o arquivo existente primeiro
  const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FILE_NAME}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  });
  console.log('Delete status:', del.status);

  // Faz upload com content-type correto
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FILE_NAME}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'text/html; charset=utf-8',
      'x-upsert': 'true',
    },
    body: fileBuffer,
  });

  const result = await upload.json();
  console.log('Upload status:', upload.status);
  console.log('Result:', JSON.stringify(result));

  if (upload.ok) {
    console.log('\nSucesso! URL publica:');
    console.log(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${FILE_NAME}`);
  } else {
    console.error('\nERRO no upload:', result);
  }
}

upload().catch(console.error);
