# WCS GHL → Google Sheets Sync

Automatically syncs sales data from GoHighLevel to Google Sheets daily at 3am Pacific.

## What It Does

1. Pulls contacts with the "sale" tag from all 6 WCS locations
2. Filters to last 60 days
3. Extracts custom fields: Tour Team Member, Sale Team Member, Same Day Sale, Day One Booked
4. Writes to Google Sheets "Raw Data" tab
5. Dashboard formulas auto-calculate metrics

---

## Setup Instructions

### Step 1: Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable the **Google Sheets API**:
   - Go to APIs & Services → Library
   - Search "Google Sheets API" → Enable
4. Create a Service Account:
   - Go to APIs & Services → Credentials
   - Click "Create Credentials" → "Service Account"
   - Name it something like `wcs-sheets-sync`
   - Skip the optional steps, click Done
5. Create a key for the service account:
   - Click on the service account you just created
   - Go to "Keys" tab → Add Key → Create new key → JSON
   - Download the JSON file (you'll need this later)
6. Copy the service account email (looks like `wcs-sheets-sync@project-id.iam.gserviceaccount.com`)

### Step 2: Set Up Google Sheet

1. Upload the `wcs_sales_tracker.xlsx` to Google Drive
2. Open it as a Google Sheet (File → Save as Google Sheets)
3. Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_SHEET_ID/edit
   ```
4. Share the sheet with your service account email (from Step 1):
   - Click "Share" → paste the service account email → Editor access

### Step 3: Get GHL Agency API Key

1. In GHL, go to Settings → API Keys (Agency level)
2. Create a new API key or copy existing one
3. Make sure it has access to all 6 locations

### Step 4: Deploy to Render

1. Push this code to a GitHub repo
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New" → "Blueprint"
4. Connect your GitHub repo
5. Render will detect the `render.yaml` and create the cron job
6. Set the environment variables in Render:

| Variable | Value |
|----------|-------|
| `GHL_API_KEY` | Your GHL Agency API key |
| `GOOGLE_SHEET_ID` | The Sheet ID from Step 2 |
| `GOOGLE_CREDENTIALS` | The entire JSON contents of the service account key file (paste as one line) |

### Step 5: Test It

1. In Render, go to your cron job
2. Click "Trigger Run" to test manually
3. Check the logs for any errors
4. Verify data appears in Google Sheets

---

## Locations Configured

| Location | Location ID |
|----------|-------------|
| Springfield | xXV3CXt5DkgfGnTt8CG1 |
| Salem | uflpfHNpByAnaBLkQzu3 |
| Keizer | g75BBgiSvlCRbvxYRMAb |
| Eugene | NNTZT21fPm3SxpLg8s04 |
| Clackamas | aqSDfuZLimMXuPz6Zx3p |
| Milwaukie | BQfUepBFzqVan4ruCQ6R |

---

## Custom Fields Tracked

| Field | GHL Key |
|-------|---------|
| Sale Team Member | `sale_team_member` |
| Tour Team Member | `tour_team_member` |
| Same Day Sale | `same_day_sale` |
| Day One Booked | `day_one_booked` |

---

## Troubleshooting

### "No contacts found"
- Check that contacts have the "sale" tag (case-insensitive)
- Verify contacts were created in the last 60 days
- Check GHL API key has access to all locations

### "Google Sheets permission denied"
- Make sure the service account email has Editor access to the sheet
- Verify the Sheet ID is correct

### "Rate limited"
- The script includes automatic rate limiting
- If issues persist, increase the sleep time in `index.js`

### Custom fields not populating
- Check the exact field key in GHL (Settings → Custom Fields)
- Update `CONFIG.customFields` in `index.js` if keys differ

---

## Modifying the Sync

### Change date range
Edit `CONFIG.daysBack` in `index.js`:
```javascript
daysBack: 60 // Change to 30, 90, etc.
```

### Add new custom fields
1. Add to `CONFIG.customFields`:
```javascript
customFields: {
  // existing fields...
  newField: 'new_field_key'
}
```
2. Add to `transformContactToRow()` function
3. Update Google Sheet headers to match

### Change schedule
Edit `render.yaml`:
```yaml
schedule: "0 10 * * *"  # Cron format, UTC time
```
- `0 10 * * *` = 10:00 UTC = 3:00 AM Pacific
- `0 14 * * *` = 14:00 UTC = 7:00 AM Pacific

---

## Support

Questions? Reach out to your dev team or check:
- [GHL API Docs](https://highlevel.stoplight.io/docs/integrations)
- [Google Sheets API Docs](https://developers.google.com/sheets/api)
- [Render Cron Jobs](https://render.com/docs/cronjobs)
