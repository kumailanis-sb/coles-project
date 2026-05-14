/**
 * Search Users API Endpoint
 * Returns Staffbase users matching a name, username or email query.
 * Used to populate the Duty Manager dropdown in the handover widget.
 *
 * GET /api/search-users?q={searchTerm}
 *
 * Coles context: user identifiers may be email addresses
 * e.g. nondesk+coles@staffbase.com — so we search by email in addition
 * to username and display name.
 *
 * Response:
 * {
 *   users: [
 *     { id, username, displayName, email, avatarInitials }
 *   ]
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

  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  try {
    const encoded = encodeURIComponent(q);
    let users = [];

    // 1. Broad text search (matches name, username, email in most Staffbase configs)
    try {
      const data = await staffbaseAPI('GET', `/users?search=${encoded}&limit=20`);
      users = data?.data || [];
    } catch (_) {}

    // 2. If no results, try explicit email search
    // (handles cases where the username IS an email like nondesk+coles@staffbase.com)
    if (users.length === 0 && q.includes('@')) {
      try {
        const data = await staffbaseAPI('GET', `/users?email=${encoded}&limit=10`);
        users = [...users, ...(data?.data || [])];
      } catch (_) {}
    }

    // 3. Deduplicate by id
    const seen = new Set();
    users = users.filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

    const mapped = users.map(u => {
      const profile  = u.profile || {};
      const first    = profile.firstName || u.firstName || '';
      const last     = profile.lastName  || u.lastName  || '';
      const email    = profile.email     || u.email     || u.username || '';
      const display  = [first, last].filter(Boolean).join(' ')
        || u.username
        || email
        || u.externalID
        || 'Unknown';
      const initials = [first[0], last[0]].filter(Boolean).join('').toUpperCase() || '?';

      return {
        id:             u.id,
        username:       u.username || u.externalID || email,
        displayName:    display,
        email,
        avatarInitials: initials,
      };
    });

    return res.status(200).json({ users: mapped, total: mapped.length });

  } catch (err) {
    console.error('[search-users] Error:', err.message);
    return res.status(500).json({ error: 'Failed to search users', details: err.message });
  }
}
