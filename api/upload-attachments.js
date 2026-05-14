/**
 * Upload Attachments API Endpoint
 *
 * Receives files from the handover widget (as base64 in JSON, or multipart),
 * uploads each one to Staffbase via:
 *   1. POST /media               — uploads the binary, returns mediumId + url
 *   2. PUT  /medialibrary/entries/{mediumId} — registers it in File Manager
 *
 * Returns an array of { name, mediumId, url } objects.
 * The url is the permanent Staffbase CDN link used as <a href> in the article.
 *
 * POST /api/upload-attachments
 *
 * Body (JSON):
 * {
 *   files: [
 *     {
 *       name:     "spill-photo-aisle-7.jpg",
 *       mimeType: "image/jpeg",
 *       data:     "<base64 string>"        // raw base64, no data-URI prefix
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   uploaded: [
 *     { name, mediumId, url, fileManagerUrl }
 *   ],
 *   failed: [
 *     { name, error }
 *   ]
 * }
 */

import { BASE_URL, API_TOKEN, delay } from './_staffbase.js';

// Max file size we'll accept (10 MB in bytes)
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!API_TOKEN)              return res.status(500).json({ error: 'Missing STAFFBASE_API_TOKEN' });

  const { files } = req.body || {};

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array is required' });
  }

  const uploaded = [];
  const failed   = [];

  for (const file of files) {
    try {
      if (!file.name || !file.data || !file.mimeType) {
        throw new Error('Each file must have name, mimeType and data (base64)');
      }

      // Decode base64 → Buffer
      const buffer = Buffer.from(file.data, 'base64');

      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new Error(`File exceeds 10 MB limit (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      }

      // ── Step 1: Upload to Staffbase Media API ──────────────────────────
      // Must be multipart/form-data with the file in a field named "file"
      const formData = new FormData();
      const blob     = new Blob([buffer], { type: file.mimeType });
      formData.append('file', blob, file.name);

      const uploadRes = await fetch(`${BASE_URL}/media`, {
        method:  'POST',
        headers: {
          'Authorization': `Basic ${API_TOKEN}`,
          // Do NOT set Content-Type here — fetch sets it automatically
          // with the correct boundary when body is FormData
        },
        body: formData,
      });

      const uploadText = await uploadRes.text();
      if (!uploadRes.ok) {
        throw new Error(`Media upload failed ${uploadRes.status}: ${uploadText}`);
      }

      const uploadData = JSON.parse(uploadText);

      // Staffbase returns the medium object — extract id and URL
      // Typical response shape: { id, url, type, ... }
      // or nested under data: { data: { id, url } }
      const medium   = uploadData.data || uploadData;
      const mediumId = medium.id;
      const fileUrl  = medium.url || medium.downloadUrl || medium.publicUrl;

      if (!mediumId) {
        throw new Error(`No mediumId in Media API response: ${uploadText}`);
      }

      console.log(`[upload-attachments] Uploaded ${file.name} → mediumId: ${mediumId}`);

      // ── Step 2: Register in File Manager (medialibrary) ────────────────
      // This makes the file available in Staffbase Studio's File Manager.
      // The PUT request registers the already-uploaded medium as a File Manager entry.
      await delay(100);

      const libraryRes = await fetch(`${BASE_URL}/medialibrary/entries/${mediumId}`, {
        method:  'PUT',
        headers: {
          'Authorization': `Basic ${API_TOKEN}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
        },
        body: JSON.stringify({
          // Optional metadata — filename for display in File Manager
          name: file.name,
        }),
      });

      // File Manager registration is best-effort — if it fails we still
      // have the media URL so we don't throw, just log
      if (!libraryRes.ok) {
        const errText = await libraryRes.text();
        console.warn(`[upload-attachments] File Manager registration failed for ${mediumId}: ${errText}`);
      } else {
        console.log(`[upload-attachments] Registered in File Manager: ${mediumId}`);
      }

      uploaded.push({
        name:           file.name,
        mediumId,
        url:            fileUrl,
        fileManagerUrl: `https://app.staffbase.com/admin/media-library/${mediumId}`,
      });

      await delay(60); // rate limit between files

    } catch (err) {
      console.error(`[upload-attachments] Failed for ${file?.name}:`, err.message);
      failed.push({ name: file?.name || 'unknown', error: err.message });
    }
  }

  return res.status(200).json({
    success:  failed.length === 0,
    uploaded,
    failed,
    total:    files.length,
    uploadedCount: uploaded.length,
    failedCount:   failed.length,
  });
}
