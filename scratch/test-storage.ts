import { storageService } from '../src/core/storage/storage.service.js';

async function main() {
  console.log('--- Testing Single-Code Neon S3 Storage Service ---');
  const bucket = 'jerseys';
  const key = 'test/single_code_test.txt';

  const publicUrl = await storageService.uploadFile({
    bucket,
    key,
    body: 'Single code production upload verification',
    contentType: 'text/plain'
  });
  console.log('Upload successful! Public URL:', publicUrl);

  const signedUrl = await storageService.getSignedViewUrl(bucket, key, 3600);
  console.log('[Signed View URL]:', signedUrl);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
