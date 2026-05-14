/**
 * Submit Handover API Endpoint
 *
 * 1. Uploads attachments to Staffbase Media API → gets CDN URLs
 * 2. Looks for an existing handover channel for this Duty Manager
 * 3. Creates the channel once if it doesn't exist
 * 4. Publishes the handover as a News post (triggers native push notification)
 * 5. Returns the post URL
 *
 * POST /api/submit-handover
 *
 * Body:
 * {
 *   shiftLabel:   string   — e.g. "Afternoon shift, Wed 21 May"
 *   submittedBy:  { username, displayName }
 *   dutyManager:  { id, username, displayName }  ← from search-users
 *   sections:     { safety, service, stock, online, customer, team }
 *                 each: { notes: string, priority: "high"|"medium"|"low" }
 *   tasks:        [{ section, title, owner, due, priority, completed }]
 *   links:        [{ url, label? }]
 *   files:        [{ name, mimeType, data }]  ← base64 encoded
 * }
 */

import {
  staffbaseAPI,
  API_TOKEN,
  BASE_URL,
  SPACE_ID,
  buildExternalId,
  buildChannelTitle,
  buildHandoverHTML,
  findHandoverChannel,
  delay,
} from './_staffbase.js';

// Generic store label — no per-store logic needed
const STORE_LABEL = process.env.STORE_LABEL || 'Coles Store';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  if (!API_TOKEN)               return res.status(500).json({ error: 'Missing STAFFBASE_API_TOKEN' });
  if (!SPACE_ID)                return res.status(500).json({ error: 'Missing STAFFBASE_SPACE_ID' });

  try {
    const {
      shiftLabel,
      submittedBy,
      dutyManager,
      sections,
      tasks,
      links,
      files: rawFiles,
    } = req.body;

    // ── Validation ─────────────────────────────────────────────────────────
    if (!dutyManager?.id)       return res.status(400).json({ error: 'dutyManager.id is required' });
    if (!dutyManager?.username) return res.status(400).json({ error: 'dutyManager.username is required' });

    const dmId       = dutyManager.id;
    const dmUsername = dutyManager.username;
    const dmName     = dutyManager.displayName || dmUsername;
    const smName     = submittedBy?.displayName || submittedBy?.username || 'Store Manager';

    console.log(`[submit-handover] DM: ${dmName} (${dmUsername}) | SM: ${smName}`);

    // ── Step 0: Upload attachments via Media API ────────────────────────────
    let uploadedFiles = [];

    if (rawFiles?.length) {
      console.log(`[submit-handover] Uploading ${rawFiles.length} file(s)...`);

      for (const file of rawFiles) {
        try {
          const buffer = Buffer.from(file.data, 'base64');
          const blob   = new Blob([buffer], { type: file.mimeType });
          const form   = new FormData();
          form.append('file', blob, file.name);

          const uploadRes = await fetch(`${BASE_URL}/media`, {
            method:  'POST',
            headers: { 'Authorization': `Basic ${API_TOKEN}` },
            body:    form,
          });

          const uploadText = await uploadRes.text();

          if (uploadRes.ok) {
            const medium   = JSON.parse(uploadText);
            const mediumId = medium?.data?.id || medium?.id;
            const fileUrl  = medium?.data?.url || medium?.url || medium?.downloadUrl;

            if (mediumId) {
              // Register in File Manager (best-effort — won't block on failure)
              try {
                await fetch(`${BASE_URL}/medialibrary/entries/${mediumId}`, {
                  method:  'PUT',
                  headers: {
                    'Authorization': `Basic ${API_TOKEN}`,
                    'Content-Type':  'application/json',
                  },
                  body: JSON.stringify({ name: file.name }),
                });
              } catch (e) {
                console.warn(`[submit-handover] File Manager registration failed: ${e.message}`);
              }

              uploadedFiles.push({ name: file.name, mediumId, url: fileUrl });
              console.log(`[submit-handover] Uploaded: ${file.name} → ${fileUrl}`);
            }
          } else {
            console.warn(`[submit-handover] Upload failed for ${file.name}: ${uploadText}`);
            uploadedFiles.push({ name: file.name, url: null });
          }

          await delay(80);
        } catch (e) {
          console.error(`[submit-handover] Upload error (${file?.name}):`, e.message);
          uploadedFiles.push({ name: file?.name, url: null });
        }
      }
    }

    // ── Step 1: Look for existing channel for this Duty Manager ────────────
    let channelId      = null;
    let channelCreated = false;

    const existing = await findHandoverChannel(dmUsername);

    if (existing) {
      channelId = existing.id;
      console.log(`[submit-handover] Reusing existing channel: ${channelId}`);
    } else {
      // ── Step 2: Create channel once ──────────────────────────────────────
      console.log('[submit-handover] No existing channel — creating...');

      const externalId   = buildExternalId(dmUsername);
      const channelTitle = buildChannelTitle(dmName);

      const channelPayload = {
        pluginID:   'news',
        externalID: externalId,
        published:  new Date().toISOString(),
        config: {
          localization: {
            en_US: { title: channelTitle },
          },
        },
        accessorIDs: [dmId],
      };

      const channelRes = await staffbaseAPI(
        'POST',
        `/spaces/${SPACE_ID}/installations`,
        channelPayload
      );

      channelId = channelRes?.data?.id || channelRes?.id;

      if (!channelId) {
        console.error('[submit-handover] Channel creation response:', channelRes);
        return res.status(500).json({ error: 'Channel created but no ID returned' });
      }

      channelCreated = true;
      console.log(`[submit-handover] Channel created: ${channelId}`);
      await delay(200);
    }

    // ── Step 3: Build post content ──────────────────────────────────────────
    const now       = new Date();
    const dateLabel = now.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const timeLabel = now.toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit',
    });

    const postTitle  = `Shift Handover — ${shiftLabel || dateLabel} — ${smName}`;
    const postTeaser = `Handover from ${smName} · ${STORE_LABEL} · ${dateLabel} ${timeLabel}`;
    const postContent = buildHandoverHTML(
      {
        storeLabel:      STORE_LABEL,
        shiftLabel:      shiftLabel || dateLabel,
        submittedBy:     smName,
        dutyManagerName: dmName,
        submittedAt:     now.toISOString(),
      },
      sections,
      tasks,
      links,
      uploadedFiles
    );

    // ── Step 4: Publish post → triggers native push notification ───────────
    const postPayload = {
      contents: {
        en_US: {
          title:   postTitle,
          teaser:  postTeaser,
          content: postContent,
          kicker:  'Shift Handover',
        },
      },
      published:  true,
      externalID: `${buildExternalId(dmUsername)}_${Date.now()}`,
    };

    const postRes = await staffbaseAPI('POST', `/channels/${channelId}/posts`, postPayload);
    const postId  = postRes?.data?.id || postRes?.id;

    if (!postId) {
      console.error('[submit-handover] Post creation response:', postRes);
      return res.status(500).json({ error: 'Post created but no ID returned' });
    }

    console.log(`[submit-handover] Post published: ${postId}`);

    // ── Step 5: Return success ──────────────────────────────────────────────
    const studioBase = 'https://coles.staffbase.rocks/admin/plugin/news';

    return res.status(200).json({
      success:        true,
      channelId,
      postId,
      channelCreated,
      editUrl:        `${studioBase}/${channelId}/${postId}`,
      channelUrl:     `${studioBase}/${channelId}`,
      submittedAt:    now.toISOString(),
      uploadedFiles,
      message: channelCreated
        ? `Channel created and handover published to ${dmName}.`
        : `Handover published to ${dmName}'s existing channel.`,
    });

  } catch (err) {
    console.error('[submit-handover] Error:', err);
    return res.status(500).json({ error: 'Failed to submit handover', details: err.message });
  }
}
