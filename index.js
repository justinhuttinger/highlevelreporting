const { google } = require('googleapis');
const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  ghl: {
    apiKey: process.env.GHL_API_KEY,
    apiVersion: '2021-07-28',
    baseUrl: 'https://services.leadconnectorhq.com'
  },
  google: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    credentialsJson: process.env.GOOGLE_CREDENTIALS // JSON string of service account
  },
  locations: {
    'xXV3CXt5DkgfGnTt8CG1': 'Springfield',
    'uflpfHNpByAnaBLkQzu3': 'Salem',
    'g75BBgiSvlCRbvxYRMAb': 'Keizer',
    'NNTZT21fPm3SxpLg8s04': 'Eugene',
    'aqSDfuZLimMXuPz6Zx3p': 'Clackamas',
    'BQfUepBFzqVan4ruCQ6R': 'Milwaukie'
  },
  // Custom field keys (from GHL contact object)
  customFields: {
    saleTeamMember: 'sale_team_member',
    tourTeamMember: 'tour_team_member',
    sameDaySale: 'same_day_sale',
    dayOneBooked: 'day_one_booked'
  },
  saleTag: 'sale', // Tag name to filter by
  daysBack: 60 // How many days of data to pull
};

// ============================================
// GHL API CLIENT
// ============================================
class GHLClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: CONFIG.ghl.baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': CONFIG.ghl.apiVersion,
        'Content-Type': 'application/json'
      }
    });
  }

  async getContacts(locationId, startDate) {
    const contacts = [];
    let nextPageUrl = null;
    let page = 1;

    console.log(`  Fetching contacts for location ${CONFIG.locations[locationId]}...`);

    do {
      try {
        const params = {
          locationId,
          limit: 100,
          query: CONFIG.saleTag // Search for contacts with sale tag
        };

        if (nextPageUrl) {
          params.startAfterId = nextPageUrl;
        }

        const response = await this.client.get('/contacts/', { params });
        const data = response.data;

        if (data.contacts && data.contacts.length > 0) {
          // Filter by date and tag
          const filtered = data.contacts.filter(contact => {
            const createdAt = new Date(contact.dateAdded || contact.createdAt);
            const hasTag = contact.tags && contact.tags.some(t => 
              t.toLowerCase() === CONFIG.saleTag.toLowerCase()
            );
            return createdAt >= startDate && hasTag;
          });

          contacts.push(...filtered);
          console.log(`    Page ${page}: ${filtered.length} contacts with sale tag`);
        }

        nextPageUrl = data.meta?.nextPageUrl || data.meta?.startAfterId || null;
        page++;

        // Rate limiting - GHL allows 100 requests per minute
        await this.sleep(100);

      } catch (error) {
        console.error(`  Error fetching contacts: ${error.message}`);
        if (error.response?.status === 429) {
          console.log('  Rate limited, waiting 60 seconds...');
          await this.sleep(60000);
        } else {
          throw error;
        }
      }
    } while (nextPageUrl);

    console.log(`  Total contacts found: ${contacts.length}`);
    return contacts;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// GOOGLE SHEETS CLIENT
// ============================================
class SheetsClient {
  constructor(credentialsJson, spreadsheetId) {
    const credentials = JSON.parse(credentialsJson);
    
    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    this.spreadsheetId = spreadsheetId;
  }

  async getSheets() {
    const client = await this.auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  }

  async clearAndWriteData(sheetName, data) {
    const sheets = await this.getSheets();
    
    // Clear existing data (keep header row)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A2:Z10000`
    });

    if (data.length === 0) {
      console.log(`  No data to write to ${sheetName}`);
      return;
    }

    // Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: data }
    });

    console.log(`  Wrote ${data.length} rows to ${sheetName}`);
  }

  async updateTeamMembersList(sheetName, range, members) {
    const sheets = await this.getSheets();
    
    // Write team members list for dashboard dynamic lookup
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${range}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: members.map(m => [m]) }
    });

    console.log(`  Updated team members list: ${members.length} members`);
  }
}

// ============================================
// DATA TRANSFORMER
// ============================================
function transformContactToRow(contact, locationName) {
  const getCustomField = (fieldName) => {
    // Try direct property access first (varies by GHL setup)
    if (contact[fieldName]) return contact[fieldName];
    
    // Try customFields array
    if (contact.customFields) {
      const field = contact.customFields.find(f => 
        f.key === fieldName || 
        f.id?.includes(fieldName) ||
        f.name?.toLowerCase().replace(/\s+/g, '_') === fieldName
      );
      return field?.value || '';
    }
    
    return '';
  };

  const signupDate = new Date(contact.dateAdded || contact.createdAt);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  return [
    contact.id,
    locationName,
    `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    contact.email || '',
    signupDate.toISOString().split('T')[0], // YYYY-MM-DD
    getCustomField(CONFIG.customFields.tourTeamMember),
    getCustomField(CONFIG.customFields.saleTeamMember),
    getCustomField(CONFIG.customFields.sameDaySale) || 'No',
    getCustomField(CONFIG.customFields.dayOneBooked) || 'No',
    'Yes', // Has sale tag (we filtered for this)
    monthNames[signupDate.getMonth()],
    signupDate.getFullYear()
  ];
}

function extractUniqueTeamMembers(rows) {
  const saleMembers = new Set();
  const tourMembers = new Set();

  rows.forEach(row => {
    if (row[6]) saleMembers.add(row[6]); // Sale Team Member column
    if (row[5]) tourMembers.add(row[5]); // Tour Team Member column
  });

  return {
    saleMembers: Array.from(saleMembers).filter(m => m).sort(),
    tourMembers: Array.from(tourMembers).filter(m => m).sort()
  };
}

// ============================================
// MAIN SYNC FUNCTION
// ============================================
async function syncGHLToSheets() {
  console.log('========================================');
  console.log('GHL → Google Sheets Sync');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Validate environment variables
  if (!CONFIG.ghl.apiKey) throw new Error('GHL_API_KEY not set');
  if (!CONFIG.google.spreadsheetId) throw new Error('GOOGLE_SHEET_ID not set');
  if (!CONFIG.google.credentialsJson) throw new Error('GOOGLE_CREDENTIALS not set');

  const ghl = new GHLClient(CONFIG.ghl.apiKey);
  const sheets = new SheetsClient(CONFIG.google.credentialsJson, CONFIG.google.spreadsheetId);

  // Calculate date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.daysBack);
  console.log(`Fetching contacts from ${startDate.toISOString().split('T')[0]} to today\n`);

  // Fetch contacts from all locations
  const allRows = [];

  for (const [locationId, locationName] of Object.entries(CONFIG.locations)) {
    console.log(`\nProcessing ${locationName}...`);
    
    try {
      const contacts = await ghl.getContacts(locationId, startDate);
      const rows = contacts.map(c => transformContactToRow(c, locationName));
      allRows.push(...rows);
      console.log(`  Transformed ${rows.length} contacts`);
    } catch (error) {
      console.error(`  Failed to process ${locationName}: ${error.message}`);
    }
  }

  console.log(`\n----------------------------------------`);
  console.log(`Total contacts across all locations: ${allRows.length}`);
  console.log(`----------------------------------------\n`);

  // Write to Google Sheets
  console.log('Writing to Google Sheets...');
  await sheets.clearAndWriteData('Raw Data', allRows);

  // Extract and update team members lists
  const { saleMembers, tourMembers } = extractUniqueTeamMembers(allRows);
  console.log(`\nUnique Sale Team Members: ${saleMembers.join(', ')}`);
  console.log(`Unique Tour Team Members: ${tourMembers.join(', ')}`);

  // Optionally update a "Team Members" sheet for dashboard dropdowns
  // await sheets.updateTeamMembersList('Team Members', 'A2', saleMembers);
  // await sheets.updateTeamMembersList('Team Members', 'B2', tourMembers);

  console.log('\n========================================');
  console.log(`Sync completed at: ${new Date().toISOString()}`);
  console.log('========================================');
}

// ============================================
// RUN
// ============================================
syncGHLToSheets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
