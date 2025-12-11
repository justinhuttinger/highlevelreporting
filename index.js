const { google } = require('googleapis');
const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  ghl: {
    apiVersion: '2021-07-28',
    baseUrl: 'https://services.leadconnectorhq.com'
  },
  google: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    credentialsJson: process.env.GOOGLE_CREDENTIALS
  },
  locations: [
    { id: 'xXV3CXt5DkgfGnTt8CG1', name: 'Springfield', apiKeyEnv: 'GHL_API_KEY_SPRINGFIELD' },
    { id: 'uflpfHNpByAnaBLkQzu3', name: 'Salem', apiKeyEnv: 'GHL_API_KEY_SALEM' },
    { id: 'g75BBgiSvlCRbvxYRMAb', name: 'Keizer', apiKeyEnv: 'GHL_API_KEY_KEIZER' },
    { id: 'NNTZT21fPm3SxpLg8s04', name: 'Eugene', apiKeyEnv: 'GHL_API_KEY_EUGENE' },
    { id: 'aqSDfuZLimMXuPz6Zx3p', name: 'Clackamas', apiKeyEnv: 'GHL_API_KEY_CLACKAMAS' },
    { id: 'BQfUepBFzqVan4ruCQ6R', name: 'Milwaukie', apiKeyEnv: 'GHL_API_KEY_MILWAUKIE' }
  ],
  customFields: {
    saleTeamMember: 'sale_team_member',
    tourTeamMember: 'tour_team_member',
    sameDaySale: 'same_day_sale',
    dayOneBooked: 'day_one_booked'
  },
  saleTag: 'sale',
  daysBack: 60
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

  async getContacts(locationId, locationName, startDate) {
    const contacts = [];
    const seenIds = new Set(); // Track IDs to detect loops
    let startAfterId = null;
    let page = 1;

    console.log(`  Fetching contacts for ${locationName}...`);

    while (true) {
      try {
        const params = {
          locationId,
          limit: 100
        };

        // Use startAfterId for pagination (cursor-based)
        if (startAfterId) {
          params.startAfterId = startAfterId;
        }

        const response = await this.client.get('/contacts/', { params });
        const data = response.data;

        // Check if we got contacts
        if (!data.contacts || data.contacts.length === 0) {
          console.log(`    Page ${page}: No more contacts`);
          break;
        }

        // Check for infinite loop - if first contact was already seen, we're looping
        const firstContactId = data.contacts[0].id;
        if (seenIds.has(firstContactId)) {
          console.log(`    Page ${page}: Detected loop (duplicate contacts), stopping`);
          break;
        }

        // Track all IDs from this page
        let duplicatesInPage = 0;
        data.contacts.forEach(c => {
          if (seenIds.has(c.id)) {
            duplicatesInPage++;
          }
          seenIds.add(c.id);
        });

        if (duplicatesInPage > 50) {
          console.log(`    Page ${page}: Too many duplicates (${duplicatesInPage}), stopping`);
          break;
        }

        // Filter by date and tag
        const filtered = data.contacts.filter(contact => {
          const createdAt = new Date(contact.dateAdded || contact.createdAt);
          const hasTag = contact.tags && contact.tags.some(t => 
            t.toLowerCase() === CONFIG.saleTag.toLowerCase()
          );
          return createdAt >= startDate && hasTag;
        });

        contacts.push(...filtered);
        
        console.log(`    Page ${page}: ${data.contacts.length} contacts, ${filtered.length} with sale tag in date range (total collected: ${contacts.length})`);

        // Get the cursor for next page - use the LAST contact's ID
        const lastContact = data.contacts[data.contacts.length - 1];
        const newStartAfterId = lastContact?.id;

        // If no new cursor or same as before, we're done
        if (!newStartAfterId || newStartAfterId === startAfterId) {
          console.log(`    No more pages (cursor unchanged)`);
          break;
        }

        startAfterId = newStartAfterId;
        page++;

        // Rate limiting
        await this.sleep(100);

        // Safety limit
        if (page > 500) {
          console.log(`    Safety limit reached (500 pages)`);
          break;
        }

      } catch (error) {
        console.error(`  Error fetching contacts: ${error.message}`);
        if (error.response?.data) {
          console.error(`  Response: ${JSON.stringify(error.response.data)}`);
        }
        if (error.response?.status === 429) {
          console.log('  Rate limited, waiting 60 seconds...');
          await this.sleep(60000);
        } else {
          break;
        }
      }
    }

    console.log(`  Total contacts found for ${locationName}: ${contacts.length}`);
    console.log(`  Total unique contacts scanned: ${seenIds.size}`);
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
    
    await sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A2:Z10000`
    });

    if (data.length === 0) {
      console.log(`  No data to write to ${sheetName}`);
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: data }
    });

    console.log(`  Wrote ${data.length} rows to ${sheetName}`);
  }
}

// ============================================
// DATA TRANSFORMER
// ============================================
function transformContactToRow(contact, locationName) {
  const getCustomField = (fieldName) => {
    if (contact[fieldName]) return contact[fieldName];
    
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
    signupDate.toISOString().split('T')[0],
    getCustomField(CONFIG.customFields.tourTeamMember),
    getCustomField(CONFIG.customFields.saleTeamMember),
    getCustomField(CONFIG.customFields.sameDaySale) || 'No',
    getCustomField(CONFIG.customFields.dayOneBooked) || 'No',
    'Yes',
    monthNames[signupDate.getMonth()],
    signupDate.getFullYear()
  ];
}

function extractUniqueTeamMembers(rows) {
  const saleMembers = new Set();
  const tourMembers = new Set();

  rows.forEach(row => {
    if (row[6]) saleMembers.add(row[6]);
    if (row[5]) tourMembers.add(row[5]);
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

  if (!CONFIG.google.spreadsheetId) throw new Error('GOOGLE_SHEET_ID not set');
  if (!CONFIG.google.credentialsJson) throw new Error('GOOGLE_CREDENTIALS not set');

  const sheets = new SheetsClient(CONFIG.google.credentialsJson, CONFIG.google.spreadsheetId);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.daysBack);
  console.log(`Fetching contacts from ${startDate.toISOString().split('T')[0]} to today\n`);

  const allRows = [];

  for (const location of CONFIG.locations) {
    console.log(`\nProcessing ${location.name}...`);
    
    const apiKey = process.env[location.apiKeyEnv];
    
    if (!apiKey) {
      console.error(`  Skipping ${location.name}: ${location.apiKeyEnv} not set`);
      continue;
    }
    
    try {
      const ghl = new GHLClient(apiKey);
      const contacts = await ghl.getContacts(location.id, location.name, startDate);
      const rows = contacts.map(c => transformContactToRow(c, location.name));
      allRows.push(...rows);
      console.log(`  Transformed ${rows.length} contacts`);
    } catch (error) {
      console.error(`  Failed to process ${location.name}: ${error.message}`);
    }
  }

  console.log(`\n----------------------------------------`);
  console.log(`Total contacts across all locations: ${allRows.length}`);
  console.log(`----------------------------------------\n`);

  console.log('Writing to Google Sheets...');
  await sheets.clearAndWriteData('Raw Data', allRows);

  const { saleMembers, tourMembers } = extractUniqueTeamMembers(allRows);
  console.log(`\nUnique Sale Team Members: ${saleMembers.join(', ') || '(none)'}`);
  console.log(`Unique Tour Team Members: ${tourMembers.join(', ') || '(none)'}`);

  console.log('\n========================================');
  console.log(`Sync completed at: ${new Date().toISOString()}`);
  console.log('========================================');
}

syncGHLToSheets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
