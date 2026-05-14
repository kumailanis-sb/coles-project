/**
 * Get Handovers API Endpoint
 * Fetches handover history for a given store/DM combination,
 * or all handovers for the authenticated space.
 *
 * GET /api/get-handovers?storeId={id}&username={username}
 * GET /api/get-handovers  (returns all handover channels + their latest post)
 *
 * Response:
 * {
 *   handovers: [
 *     {
 *       channelId, channelTitle, externalId,
 *       storeId, dutyManagerUsername,
 *       posts: [{ postId, title, publishedAt, status }],
 *       latestPost: { ... }
 *     }
 *   ]
 * }
 */

import {
  staffbaseAPI,
  API_TOKEN,
  SPACE_ID,
  HANDOVER_PREFIX,
  fetchAllPages,
  delay,
} from './_staffbase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });
  if (!API_TOKEN)               return res.status(500).json({ error: 'Missing STAFFBASE_API_TOKEN' });
  if (!SPACE_ID)                return res.status(500).json({ error: 'Missing STAFFBASE_SPACE_ID' });

  try {
    const { storeId, username } = req.query;

    // Fetch all installations in the space
    const allInstallations = await fetchAllPages(`/spaces/${SPACE_ID}/installations`);

    // Filter to handover channels only
    let handoverInstallations = allInstallations.filter(inst =>
      typeof inst.externalID === 'string' && inst.externalID.startsWith(HANDOVER_PREFIX)
    );

    // Optional: filter by storeId and/or username
    if (storeId) {
      const safeStore = String(storeId).toLowerCase().replace(/[^a-z0-9]/g, '');
      handoverInstallations = handoverInstallations.filter(inst =>
        inst.externalID.startsWith(`handover_${safeStore}`) || inst.externalID.includes(safeStore)
      );
    }

    if (username) {
      const safeUser = String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '');
      handoverInstallations = handoverInstallations.filter(inst =>
        inst.externalID.endsWith(`_${safeUser}`)
      );
    }

    console.log(`[get-handovers] Found ${handoverInstallations.length} handover channel(s)`);

    // For each channel, fetch the recent posts
    const handovers = [];

    for (const inst of handoverInstallations) {
      const channelId = inst.id;

      // Parse storeId and username from externalID
      // Pattern: handover_{storeId}_{username}
      const withoutPrefix = inst.externalID.replace(HANDOVER_PREFIX, '');
      const firstUnderscore = withoutPrefix.indexOf('_');
      const parsedStore = firstUnderscore >= 0 ? withoutPrefix.slice(0, firstUnderscore) : withoutPrefix;
      const parsedUser  = firstUnderscore >= 0 ? withoutPrefix.slice(firstUnderscore + 1) : '';

      const channelTitle = inst.config?.localization?.en_US?.title
        || inst.config?.localization?.de_DE?.title
        || inst.title
        || inst.externalID;

      // Fetch posts (up to 20 most recent)
      let posts = [];
      try {
        const postsData = await staffbaseAPI('GET', `/channels/${channelId}/posts?limit=20&published=all`);
        const raw       = postsData?.data || [];
        posts = raw.map(p => ({
          postId:      p.id,
          title:       p.contents?.en_US?.title || p.contents?.de_DE?.title || 'Untitled',
          publishedAt: p.publishedAt || p.createdAt || p.created,
          status:      p.published ? 'published' : 'draft',
          editUrl:     `https://app.staffbase.com/admin/plugin/news/${channelId}/${p.id}`,
        }));

        // Sort newest first
        posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      } catch (err) {
        console.warn(`[get-handovers] Could not fetch posts for channel ${channelId}:`, err.message);
      }

      handovers.push({
        channelId,
        channelTitle,
        externalId:           inst.externalID,
        storeId:              parsedStore,
        dutyManagerUsername:  parsedUser,
        channelUrl:           `https://app.staffbase.com/admin/plugin/news/${channelId}`,
        createdAt:            inst.createdAt || inst.created,
        postCount:            posts.length,
        posts,
        latestPost:           posts[0] || null,
      });

      await delay(60); // Rate limit protection between channel fetches
    }

    // Sort channels by latest post date
    handovers.sort((a, b) => {
      const aDate = a.latestPost?.publishedAt || a.createdAt || '';
      const bDate = b.latestPost?.publishedAt || b.createdAt || '';
      return new Date(bDate) - new Date(aDate);
    });

    return res.status(200).json({
      success:  true,
      handovers,
      total:    handovers.length,
    });

  } catch (err) {
    console.error('[get-handovers] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch handovers', details: err.message });
  }
}
