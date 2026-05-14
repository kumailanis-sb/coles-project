/**
 * Staffbase API Helper
 * Shared utility used by all handover backend endpoints.
 */

export const BASE_URL  = process.env.STAFFBASE_BASE_URL || 'https://app.staffbase.com/api';
export const API_TOKEN = process.env.STAFFBASE_API_TOKEN;
export const SPACE_ID  = process.env.STAFFBASE_SPACE_ID;
export const HANDOVER_PREFIX = 'handover_';

const DELAY_MS = 60;
export const delay = (ms) => new Promise(r => setTimeout(r, ms));

export async function staffbaseAPI(method, endpoint, body = null, retries = 2) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`[Staffbase] ${method} ${endpoint}`);
  const options = {
    method,
    headers: {
      'Authorization': `Basic ${API_TOKEN}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res  = await fetch(url, options);
      const text = await res.text();
      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') || '5', 10) * 1000;
        await delay(wait); continue;
      }
      if (!res.ok) throw new Error(`Staffbase ${res.status}: ${text}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (attempt === retries) throw err;
      await delay(1000);
    }
  }
}

export async function fetchAllPages(endpoint, pageSize = 100, maxItems = 10000) {
  const results = [];
  let offset = 0;
  while (true) {
    const sep  = endpoint.includes('?') ? '&' : '?';
    const data = await staffbaseAPI('GET', `${endpoint}${sep}limit=${pageSize}&offset=${offset}`);
    const page = data?.data || [];
    results.push(...page);
    if (page.length < pageSize || results.length >= maxItems) break;
    offset += pageSize;
    await delay(DELAY_MS);
  }
  return results;
}

export async function findUserByUsername(username) {
  const encoded = encodeURIComponent(username.trim());
  try {
    const data = await staffbaseAPI('GET', `/users?username=${encoded}&limit=5`);
    const users = data?.data || [];
    if (users.length > 0) return users[0];
  } catch (_) {}
  try {
    const data = await staffbaseAPI('GET', `/users?search=${encoded}&limit=10`);
    const users = data?.data || [];
    if (users.length > 0) return users[0];
  } catch (_) {}
  return null;
}

export async function findHandoverChannel(username) {
  const targetId = buildExternalId(username);
  const installations = await fetchAllPages(`/spaces/${SPACE_ID}/installations`);
  return installations.find(inst => inst.externalID === targetId) || null;
}

export function buildExternalId(username) {
  const safeUser  = String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const safeUser = String(username).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${HANDOVER_PREFIX}${safeUser}`;
}

export function buildChannelTitle(dutyManagerName) {
  return `Shift Handover — ${dutyManagerName}`;
}

/**
 * buildHandoverHTML
 *
 * Produces plain HTML that Staffbase News renders natively.
 * Uses only: <h2>, <h3>, <p>, <ul>, <li>, <hr>, <strong>, <s>, <a>
 * and minimal inline style= for color only (no layout CSS).
 *
 * @param {object} meta     - { storeLabel, shiftLabel, submittedBy, dutyManagerName, submittedAt }
 * @param {object} sections - { safety, service, stock, online, customer, team }
 *                            each: { notes: string, priority: 'high'|'medium'|'low' }
 * @param {array}  tasks    - [{ section, title, owner, due, priority }]
 * @param {array}  links    - [{ url, label? }]
 * @param {array}  files    - [{ name }]
 */
export function buildHandoverHTML(meta, sections, tasks, links, files) {
  const SECTIONS = [
    { id: 'safety',   label: 'Safety',           icon: '🦺' },
    { id: 'service',  label: 'Service',           icon: '🛒' },
    { id: 'stock',    label: 'Stock',             icon: '📦' },
    { id: 'online',   label: 'Online & Delivery', icon: '🚚' },
    { id: 'customer', label: 'Customer',          icon: '🤝' },
    { id: 'team',     label: 'Team',              icon: '👥' },
  ];

  const PRI_COLOR = { high: '#CC0000', medium: '#B45309', low: '#2E7D32' };
  const PRI_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
  const TASK_ICON = { high: '#CC0000', medium: '#B45309', low: '#2E7D32' };

  const e = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let html = '';

  // ── Header ───────────────────────────────────────────────────────────────
  const date = meta.submittedAt
    ? new Date(meta.submittedAt).toLocaleString('en-AU', { weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '';

  html += `<p style="font-size:12px;color:#888888;">${e(meta.storeLabel)} &nbsp;·&nbsp; ${e(meta.shiftLabel)} &nbsp;·&nbsp; ${e(date)}</p>`;
  html += `<p style="font-size:12px;color:#888888;">Submitted by <strong>${e(meta.submittedBy)}</strong> → <strong>${e(meta.dutyManagerName)}</strong></p>`;
  html += `<hr>`;

  // ── Sections ─────────────────────────────────────────────────────────────
  for (const cfg of SECTIONS) {
    const sec       = sections?.[cfg.id];
    const secTasks  = (tasks || []).filter(t => t.section === cfg.id);
    const hasNotes  = sec?.notes?.trim();
    const hasTasks  = secTasks.length > 0;

    if (!hasNotes && !hasTasks) continue;

    const priColor = sec?.priority ? PRI_COLOR[sec.priority] : null;
    const priLabel = sec?.priority ? PRI_LABEL[sec.priority] : null;

    // Section heading
    if (priColor) {
      html += `<h2>${cfg.icon} ${cfg.label} &nbsp;<span style="font-size:12px;color:${priColor};font-weight:normal;">● ${priLabel}</span></h2>`;
    } else {
      html += `<h2>${cfg.icon} ${cfg.label}</h2>`;
    }

    // Notes
    if (hasNotes) {
      html += `<p>${e(sec.notes)}</p>`;
    }

    // Tasks
    if (hasTasks) {
      html += `<p style="font-size:12px;color:#888888;margin-top:10px;"><strong>TASKS</strong></p>`;
      html += `<ul>`;
      for (const task of secTasks) {
        const done     = task.completed;
        const tc       = TASK_ICON[task.priority] || '#888888';
        const titleHtml = done ? `<s>${e(task.title)}</s>` : e(task.title);
        const checkBox  = done ? '☑' : '☐';
        const metaParts = [];
        if (task.owner)    metaParts.push(`👤 ${e(task.owner)}`);
        if (task.due)      metaParts.push(`🕐 ${e(task.due)}`);
        if (task.priority) metaParts.push(`<span style="color:${tc};">${task.priority.charAt(0).toUpperCase()+task.priority.slice(1)}</span>`);
        html += `<li>${checkBox} &nbsp;<strong>${titleHtml}</strong>`;
        if (metaParts.length) {
          html += `<br><span style="font-size:13px;color:#555555;">${metaParts.join(' &nbsp;·&nbsp; ')}</span>`;
        }
        html += `</li>`;
      }
      html += `</ul>`;
    }

    html += `<hr>`;
  }

  // ── Attachments & links ───────────────────────────────────────────────────
  // files array now comes from upload-attachments.js response:
  // [{ name, mediumId, url, fileManagerUrl }]
  // Each file has a permanent Staffbase CDN url — render as a tappable link.
  const hasFiles = files?.length > 0;
  const hasLinks = links?.length > 0;

  if (hasFiles || hasLinks) {
    html += `<h2>📎 Attachments &amp; procedure links</h2>`;

    if (hasFiles) {
      for (const f of files) {
        const ext  = (f.name || '').split('.').pop().toLowerCase();
        const icon = ext === 'pdf' ? '📄'
          : ['jpg','jpeg','png','gif','heic','webp'].includes(ext) ? '📷'
          : ext === 'xlsx' || ext === 'xls' ? '📊'
          : ext === 'docx' || ext === 'doc' ? '📝'
          : '📎';

        if (f.url) {
          // Uploaded via Media API — render as a clickable link
          html += `<p>${icon} &nbsp;<a href="${e(f.url)}">${e(f.name)}</a></p>`;
        } else {
          // Fallback: no URL (upload may have failed) — show plain text
          html += `<p>${icon} &nbsp;${e(f.name)} <span style="color:#888888;font-size:12px;">(attachment unavailable)</span></p>`;
        }
      }
    }

    if (hasLinks) {
      for (const link of links) {
        const label = link.label || link.url;
        html += `<p>🔗 &nbsp;<a href="${e(link.url)}">${e(label)}</a></p>`;
      }
    }
  }

  return html;
}
