# Coles Shift Handover — Backend

Node.js/Vercel serverless backend that connects the shift handover widget
to the Staffbase API. Built on top of the message builder pattern.

## Architecture

```
Widget (submit-handover.html)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│               API Endpoints (Vercel)                │
│                                                     │
│  GET  /api/search-users     Search DM by name       │
│  POST /api/submit-handover  Core: post to Staffbase │
│  GET  /api/get-handovers    Handover history        │
│  GET  /api/get-post-stats   Read/ack status         │
└─────────────────────────────────────────────────────┘
        │
        ▼
Staffbase API (app.staffbase.com/api)
  ├── GET  /users?search=           Find Duty Manager
  ├── GET  /spaces/{id}/installations  Scan for existing channel
  ├── POST /spaces/{id}/installations  Create channel (once per DM)
  ├── POST /channels/{id}/posts        Publish handover post
  └── GET  /posts/{id}/statistics      Read/ack status
```

## Channel Strategy

Each Duty Manager gets **one persistent channel per store**. The channel is
created on the first handover and reused for every subsequent one.

**ExternalID pattern:** `handover_{storeId}_{username}`
**Example:** `handover_toowoomba_jamie.chen`

When `submit-handover` is called:
1. Scans `GET /spaces/{spaceId}/installations` for a matching externalID
2. If found → uses existing `channelId`
3. If not found → creates the channel once with that pattern
4. Always publishes a new post (`published: true`)
5. Staffbase fires the push notification natively on publish — no extra call needed

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in:
#   STAFFBASE_API_TOKEN — generate in Studio → Settings → Integrations → API Tokens
#   STAFFBASE_SPACE_ID  — Studio → Settings → Space Information
# STAFFBASE_BASE_URL is already set to https://coles.staffbase.rocks/api
```

### 3. Run locally
```bash
npm run dev
# Vercel dev server starts at http://localhost:3000
```

### 4. Deploy to Vercel
```bash
npx vercel deploy
# Add environment variables in the Vercel dashboard
```

## API Reference

### GET /api/search-users?q={query}
Search for Staffbase users by name, username, or email.
Used to populate the Duty Manager dropdown in the widget.

**Response:**
```json
{
  "users": [
    {
      "id": "abc123",
      "username": "jamie.chen",
      "displayName": "Jamie Chen",
      "email": "jamie.chen@coles.com.au",
      "avatarInitials": "JC"
    }
  ]
}
```

### POST /api/submit-handover
Submit a completed handover. Creates or reuses a channel, publishes the post.

**Request body:**
```json
{
  "storeId":     "toowoomba",
  "storeLabel":  "Toowoomba Store",
  "shiftLabel":  "Afternoon shift, Wed 21 May",
  "submittedBy": { "username": "sarah.mitchell", "displayName": "Sarah Mitchell" },
  "dutyManager": { "id": "abc123", "username": "jamie.chen", "displayName": "Jamie Chen" },
  "sections": {
    "safety":   { "notes": "Roof leak aisle 7...", "priority": "high" },
    "service":  { "notes": "", "priority": null },
    "stock":    { "notes": "Dairy cooler issue...", "priority": "medium" },
    "online":   { "notes": "", "priority": null },
    "customer": { "notes": "", "priority": null },
    "team":     { "notes": "Priya covering late shift", "priority": "low" }
  },
  "tasks": [
    {
      "section":  "safety",
      "title":    "Confirm maintenance booking",
      "owner":    "Jamie Chen (Duty Manager)",
      "due":      "tomorrow 08:00",
      "priority": "high"
    }
  ],
  "links": [
    { "url": "https://colesgroup.sharepoint.com/sites/ops/procedures/spill-cleaning-v3.pdf" }
  ]
}
```

**Response:**
```json
{
  "success":        true,
  "channelId":      "xyz789",
  "postId":         "post456",
  "channelCreated": false,
  "editUrl":        "https://app.staffbase.com/admin/plugin/news/xyz789/post456",
  "submittedAt":    "2026-05-21T10:00:00.000Z",
  "message":        "Handover published to existing channel for Jamie Chen."
}
```

### GET /api/get-handovers?storeId={id}&username={username}
Fetch handover history. Both params are optional — omit to get all.

### GET /api/get-post-stats?postId={id}
Get read/acknowledgement status for a specific post.

## Widget Integration

Point the handover widget's submit function to this backend:

```javascript
// In the widget's submitHandover() function, replace the local state save with:
const response = await fetch('https://your-vercel-url.vercel.app/api/submit-handover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    storeId:     'toowoomba',
    storeLabel:  'Toowoomba Store',
    shiftLabel:  document.getElementById('handover-meta').textContent,
    submittedBy: { username: 'sarah.mitchell', displayName: 'Sarah Mitchell' },
    dutyManager: selectedDutyManager,   // from the DM search dropdown
    sections:    buildSectionsPayload(),
    tasks:       buildTasksPayload(),
    links:       state.links,
  })
});
```

## Files

```
handover-backend/
├── api/
│   ├── _staffbase.js          Shared API helper (auth, retry, helpers)
│   ├── search-users.js        GET  Search Staffbase users by name
│   ├── submit-handover.js     POST Core: channel lookup-or-create + publish
│   ├── get-handovers.js       GET  Handover history by store/DM
│   └── get-post-stats.js      GET  Read/ack status for a post
├── .env.example               Environment variable template
├── package.json
├── vercel.json
└── README.md
```
