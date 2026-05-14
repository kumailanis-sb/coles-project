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
  const targetId      = buildExternalId(username);
  const installations = await fetchAllPages(`/spaces/${SPACE_ID}/installations`);
  return installations.find(inst => inst.externalID === targetId) || null;
}

export function buildExternalId(username) {
  const safeUser = String(username).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return `${HANDOVER_PREFIX}${safeUser}`;
}

export function buildChannelTitle(dutyManagerName) {
  return `Shift Handover — ${dutyManagerName}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildHandoverHTML
// p-only layout with inline styles. No tables, no CSS classes.
// p elements are block-level and always stretch full width in Staffbase News.
// Tested on both desktop and mobile.
// ─────────────────────────────────────────────────────────────────────────────
export function buildHandoverHTML(meta, sections, tasks, links, files) {
  const SECTION_CONFIG = [
    { id: 'safety',   label: 'Safety',           icon: '🦺' },
    { id: 'service',  label: 'Service',           icon: '🛒' },
    { id: 'stock',    label: 'Stock',             icon: '📦' },
    { id: 'online',   label: 'Online & Delivery', icon: '🚚' },
    { id: 'customer', label: 'Customer',          icon: '🤝' },
    { id: 'team',     label: 'Team',              icon: '👥' },
  ];

  const PRI = {
    high:   { color: '#CC0000', bg: '#ffffff',  border: '#EAACAC', label: '● HIGH',   hdrBg: '#FDECEA' },
    medium: { color: '#B45309', bg: '#FEF3C7',  border: '#F0D080', label: '● MEDIUM', hdrBg: '#F7F7F5' },
    low:    { color: '#2E7D32', bg: '#EAF4EA',  border: '#B7DEB8', label: '● LOW',    hdrBg: '#F7F7F5' },
  };

  const e = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const FONT = 'font-family:Arial,sans-serif;';

  // Clean up shift label — remove duplicate store name
  const STORE_LABEL = meta.storeLabel || 'Coles Store';
  const cleanShift  = (meta.shiftLabel || '')
    .replace(STORE_LABEL, '').replace(/^\s*[·\-]\s*/, '').trim();
  const dateStr = meta.submittedAt
    ? new Date(meta.submittedAt).toLocaleString('en-AU', {
        weekday: 'long', day: 'numeric', month: 'long',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  let html = '';

  // ── Header banner ────────────────────────────────────────────────────────
  html += `<p style="background-color:#CC0000;padding:16px 18px;border-radius:8px;margin:0 0 10px;${FONT}">` +
    `<span style="display:block;font-size:12px;font-weight:700;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:5px;">Shift Handover</span>` +
    `<span style="display:block;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:5px;">${e(STORE_LABEL)} — ${e(cleanShift)}</span>` +
    `<span style="display:block;font-size:14px;color:rgba(255,255,255,0.72);">${e(dateStr)}</span>` +
    `</p>`;

  // ── From / To ─────────────────────────────────────────────────────────────
  html += `<p style="background-color:#F7F7F5;border-left:3px solid #CC0000;padding:10px 14px;border-radius:0 6px 6px 0;margin:0 0 10px;font-size:17px;color:#5A5A54;${FONT}">` +
    `From &nbsp;<strong style="color:#1A1A18;">${e(meta.submittedBy)}</strong>&nbsp; → &nbsp;<strong style="color:#1A1A18;">${e(meta.dutyManagerName)}</strong>` +
    `</p>`;

  // ── Sections ──────────────────────────────────────────────────────────────
  for (const cfg of SECTION_CONFIG) {
    const sec      = sections?.[cfg.id];
    const secTasks = (tasks || []).filter(t => t.section === cfg.id);
    if (!sec?.notes?.trim() && !secTasks.length) continue;

    const p       = sec?.priority;
    const hdrBg   = p ? PRI[p].hdrBg : '#F7F7F5';
    const pill    = p
      ? `<span style="font-size:14px;font-weight:700;color:${PRI[p].color};background-color:${PRI[p].bg};padding:2px 9px;border-radius:20px;border:1px solid ${PRI[p].border};">${PRI[p].label}</span>`
      : '';

    // Section header p
    html += `<p style="background-color:${hdrBg};border:1px solid #E2E2DE;border-bottom:none;border-radius:8px 8px 0 0;padding:9px 14px;margin:0;font-size:17px;font-weight:700;color:#1A1A18;${FONT}">` +
      `${cfg.icon}&nbsp;&nbsp;${cfg.label}&nbsp;&nbsp;${pill}` +
      `</p>`;

    // Section body p
    let bodyContent = '';

    if (sec?.notes?.trim()) {
      bodyContent += `<span style="display:block;font-size:17px;color:#1A1A18;line-height:1.65;margin-bottom:${secTasks.length ? '12px' : '0'};">${e(sec.notes)}</span>`;
    }

    if (secTasks.length) {
      bodyContent += `<span style="display:block;font-size:14px;font-weight:700;color:#9A9A92;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:7px;">Tasks</span>`;
      secTasks.forEach((t, i) => {
        const done       = !!t.completed;
        const taskBg     = done ? '#EAF4EA' : '#F7F7F5';
        const taskBorder = done ? '#B7DEB8'  : '#E2E2DE';
        const checkBox   = done ? '☑' : '☐';
        const titleHtml  = done
          ? `<s style="color:#9A9A92;">${e(t.title)}</s>`
          : `<strong>${e(t.title)}</strong>`;
        const priColor = t.priority ? (PRI[t.priority]?.color || '#888') : '#888';
        const priLabel = t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : '';
        const metaParts = [
          t.owner && `👤 ${e(t.owner)}`,
          t.due   && `🕐 ${e(t.due)}`,
          priLabel && `<span style="color:${priColor};font-weight:700;">${priLabel}</span>`,
        ].filter(Boolean).join(' &nbsp;·&nbsp; ');

        bodyContent += `<span style="display:block;${i > 0 ? 'margin-top:5px;' : ''}background-color:${taskBg};border:1px solid ${taskBorder};border-radius:5px;padding:8px 10px;font-size:16px;color:#1A1A18;">` +
          `${checkBox}&nbsp;&nbsp;${titleHtml}<br>` +
          `<span style="font-size:15px;color:#5A5A54;">${metaParts}</span>` +
          `</span>`;
      });
    }

    html += `<p style="background-color:#ffffff;border:1px solid #E2E2DE;border-top:none;border-radius:0 0 8px 8px;padding:12px 14px;margin:0 0 10px;${FONT}">${bodyContent}</p>`;
  }

  // ── Attachments & links ───────────────────────────────────────────────────
  const hasFiles = files?.length > 0;
  const hasLinks = links?.length > 0;

  if (hasFiles || hasLinks) {
    html += `<p style="background-color:#EEF3FA;border:1px solid #C5D5EE;border-bottom:none;border-radius:8px 8px 0 0;padding:9px 14px;margin:0;font-size:17px;font-weight:700;color:#1A3C6E;${FONT}">` +
      `📎&nbsp;&nbsp;Attachments &amp; procedure links</p>`;

    let attachContent = '';

    if (hasFiles) {
      for (const f of files) {
        const ext  = (f.name || '').split('.').pop().toLowerCase();
        const icon = ['jpg','jpeg','png','gif','heic','webp'].includes(ext) ? '📷'
          : ext === 'pdf' ? '📄'
          : ext === 'xlsx' || ext === 'xls' ? '📊'
          : ext === 'docx' || ext === 'doc' ? '📝' : '📎';
        if (f.url) {
          attachContent += `<span style="display:block;margin-bottom:6px;font-size:17px;">${icon}&nbsp;&nbsp;<a href="${e(f.url)}" style="color:#1A3C6E;font-weight:600;text-decoration:none;">${e(f.name)}</a></span>`;
        } else {
          attachContent += `<span style="display:block;margin-bottom:6px;font-size:17px;color:#9A9A92;">${icon}&nbsp;&nbsp;${e(f.name)} <em>(upload failed)</em></span>`;
        }
      }
    }

    if (hasLinks) {
      for (const link of links) {
        const label = link.label || link.url;
        attachContent += `<span style="display:block;margin-bottom:6px;font-size:17px;">🔗&nbsp;&nbsp;<a href="${e(link.url)}" style="color:#1A3C6E;font-weight:600;text-decoration:none;">${e(label)}</a></span>`;
      }
    }

    html += `<p style="background-color:#ffffff;border:1px solid #C5D5EE;border-top:none;border-radius:0 0 8px 8px;padding:12px 14px;margin:0 0 10px;${FONT}">${attachContent}</p>`;
  }

  return html;
}
