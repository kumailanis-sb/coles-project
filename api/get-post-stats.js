/**
 * Get Post Stats API Endpoint
 * Returns read/acknowledgement statistics for a specific handover post.
 * Used by the Store Manager to confirm the Duty Manager has read the handover.
 *
 * GET /api/get-post-stats?postId={id}
 *
 * Response:
 * {
 *   postId:      string,
 *   totalReach:  number,
 *   reads:       number,
 *   readRate:    number,   -- percentage
 *   unread:      number,
 *   acknowledged: bool     -- true if Duty Manager user has a read event
 * }
 */

import { staffbaseAPI, API_TOKEN } from './_staffbase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });
  if (!API_TOKEN)               return res.status(500).json({ error: 'Missing STAFFBASE_API_TOKEN' });

  const { postId } = req.query;
  if (!postId) return res.status(400).json({ error: 'postId is required' });

  try {
    // Fetch post statistics from Staffbase
    const stats = await staffbaseAPI('GET', `/posts/${postId}/statistics`);

    const totalReach = stats?.reach     || stats?.total     || 0;
    const reads      = stats?.reads     || stats?.readCount || 0;
    const unread     = totalReach - reads;
    const readRate   = totalReach > 0 ? Math.round((reads / totalReach) * 100) : 0;

    // acknowledged = at least one read logged (channel only has the DM)
    const acknowledged = reads > 0;

    return res.status(200).json({
      success:      true,
      postId,
      totalReach,
      reads,
      unread,
      readRate,
      acknowledged,
      raw: stats,
    });

  } catch (err) {
    console.error('[get-post-stats] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch post stats', details: err.message });
  }
}
