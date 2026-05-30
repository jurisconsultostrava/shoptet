require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const cron = require('node-cron');

// Stav posledního automatického běhu + vygenerovaný feed (drží se v paměti).
let GENERATED_FEED = null;
let LAST_RUN = null;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 moje-zlato-price-tool';
const DEFAULT_EUR_CZK = Number(process.env.DEFAULT_EUR_CZK || 24.335);
const DEFAULT_MARGIN_CZK = Number(process.env.DEFAULT_MARGIN_CZK || 1200);
const DEFAULT_MARGIN_PERCENT = Number(process.env.DEFAULT_MARGIN_PERCENT || 0);
const DEFAULT_WAREHOUSE = process.env.DEFAULT_WAREHOUSE || 'DE/CH';
const DEFAULT_IN_STOCK_TEXT = process.env.DEFAULT_IN_STOCK_TEXT || 'Externí sklad / DE';
const DEFAULT_OUT_OF_STOCK_TEXT = process.env.DEFAULT_OUT_OF_STOCK_TEXT || 'Předobjednávka / Fixace ceny';
const STONEX_BASE_URL = 'https://stonexbullion.com';

// ====== SPOT ZLATA (GoldAPI) ======
const OUNCE_G = 31.1035;
let SPOT_CACHE = { czkPerGram: null, at: 0 };

// Vrátí spot zlata v Kč/g (cache 10 min). Token z env GOLDAPI_TOKEN.
async function getGoldSpotCzkPerGram() {
  const now = Date.now();
  if (SPOT_CACHE.czkPerGram && (now - SPOT_CACHE.at) < 10 * 60 * 1000) {
    return SPOT_CACHE.czkPerGram;
  }
  const token = process.env.GOLDAPI_TOKEN;
  if (!token) throw new Error('Chybí GOLDAPI_TOKEN pro spot zlata.');
  const r = await axios.get('https://www.goldapi.io/api/XAU/CZK', {
    headers: { 'x-access-token': token }, timeout: 20000, validateStatus: () => true,
  });
  if (r.status >= 400 || !r.data) throw new Error(`GoldAPI HTTP ${r.status}`);
  // GoldAPI vrací price_gram_24k (Kč/g) nebo price (za unci)
  const perGram = r.data.price_gram_24k || (r.data.price ? r.data.price / OUNCE_G : null);
  if (!perGram) throw new Error('GoldAPI: nečekaná odpověď.');
  SPOT_CACHE = { czkPerGram: perGram, at: now };
  return perGram;
}
// ====== /SPOT ======


app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
const path = require('path');
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (_, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/favicon.ico', (_, res) => res.status(204).end());

const PRODUCT_NUMBER_BY_NAME = [
  [/0\.5\s*g\s*gold\s*bar\s*\|\s*valcambi/i, '3002082'],
  [/1\s*kilo\s*gold\s*bar\s*\|\s*argor[-\s]?heraeus/i, '30070'],
  [/1\s*kilo\s*gold\s*bar\s*\|\s*valcambi/i, '30092'],
  [/1\s*kilo\s*gold\s*bar\s*\|\s*umicore/i, '30078'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*valcambi\s*$/i, '30075'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*argor[-\s]?heraeus\s*$/i, '3002064'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*pamp\s*fortuna/i, '3002014'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*different\s*manufacturers/i, '30012'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*argor[-\s]?heraeus\s*\|\s*kinebar/i, '3002077'],
  [/10\s*x\s*1\/10\s*oz\s*combibar.*valcambi/i, '3002126'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*valcambi\s*\|\s*green\s*gold/i, '3002146'],
  [/1\s*oz\s*britannia\s*gold\s*bar.*royal\s*mint/i, '3002200'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*pamp\s*suisse/i, '3002152'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*argor[-\s]?heraeus.*year\s*of\s*the\s*horse/i, '3002330'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*perth\s*mint/i, '30016'],
  [/1\s*oz\s*gold\s*bar.*pamp.*year\s*of\s*the\s*horse/i, '3002326'],
  [/1\s*oz\s*gold\s*bar\s*\|\s*umicore/i, '3002018'],
  [/1\s*oz\s*lunar.*horse\s*gold\s*bar.*perth\s*mint/i, '101467']
];

const SHOP_CATEGORIES = {
  GOLD: { id: '859', name: 'Investiční zlato' },
  GOLD_BARS: {
    '1 oz': { id: '868', name: 'Investiční zlato &gt; 1 Oz' },
    '1 g': { id: '871', name: 'Investiční zlato &gt; 1 g' },
    '2 g': { id: '874', name: 'Investiční zlato &gt; 2 g' },
    '5 g': { id: '877', name: 'Investiční zlato &gt; 5 g' },
    '10 g': { id: '880', name: 'Investiční zlato &gt; 10 g' },
    '20 g': { id: '883', name: 'Investiční zlato &gt; 20 g' },
    '50 g': { id: '886', name: 'Investiční zlato &gt; 50 g' },
    '100 g': { id: '889', name: 'Investiční zlato &gt; 100 g' },
    '250 g': { id: '892', name: 'Investiční zlato &gt; 250 g' },
    '500 g': { id: '895', name: 'Investiční zlato &gt; 500 g' },
    '1 kg': { id: '898', name: 'Investiční zlato &gt; 1000 g' }
  },
  GOLD_COINS: {
    root: { id: '904', name: 'Investiční zlato &gt; Investiční zlaté mince' },
    '1 oz': { id: '919', name: 'Investiční zlato &gt; Investiční zlaté mince &gt; 1 Oz' },
    '1/2 oz': { id: '916', name: 'Investiční zlato &gt; Investiční zlaté mince &gt; 1/2 Oz' },
    '1/4 oz': { id: '1170', name: 'Investiční zlato &gt; Investiční zlaté mince &gt; 1/4 Oz' }
  },
  SILVER_BARS: { id: '922', name: 'Investiční stříbro &gt; Investiční stříbrné slitky' },
  SILVER_COINS: { id: '925', name: 'Investiční stříbro &gt; Investiční stříbrné mince' },
  PLATINUM: { id: '928', name: 'Investiční platina a palladium &gt; Investiční platina' },
  PALLADIUM: { id: '931', name: 'Investiční platina a palladium &gt; Investiční palladium' }
};

function requireAuth(req, res, next) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return next();
  const supplied = req.headers['x-app-password'] || req.query.password;
  if (supplied === expected) return next();
  return res.status(401).json({ error: 'Unauthorized: wrong APP_PASSWORD.' });
}

function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function decodeXml(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'"); }
function escapeXml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function textBetween(xml, tag) { const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? decodeXml(m[1].trim()) : ''; }
function parseNumber(value) { const m = String(value ?? '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; }
function round(value, decimals) { const p = Math.pow(10, decimals); return Math.round(value * p) / p; }

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/argor\s*heraus/g, 'argor heraeus')
    .replace(/argor-heraeus/g, 'argor heraeus')
    .replace(/\b1\s*kilo\b|\b1\s*kg\b|\b1000\s*g\b/g, '1000g')
    .replace(/\b1\s*oz\b/g, '1oz')
    .replace(/\b0,5\s*g\b/g, '0.5g')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeWeight(s) {
  const text = String(s || '').replace(',', '.').toLowerCase();
  const multi = text.match(/(\d+)\s*x\s*([0-9.\/]+)\s*(g|oz)/i); if (multi) return `${multi[1]} x ${multi[2].replace('.', ',')} ${multi[3]}`;
  if (/1\s*kilo|1\s*kg|1000\s*g/.test(text)) return '1 kg';
  const oz = text.match(/(1\/25|1\/20|1\/10|1\/4|1\/2|1)\s*oz/); if (oz) return `${oz[1]} oz`;
  const g = text.match(/(250|500|100|50|20|10|5|2|1|0\.5)\s*g\b/); if (g) return `${g[1].replace('.', ',')} g`;
  return '';
}

// Hmotnost v gramech z textu (pro marži dle hmotnosti, když StoneX fine_weight chybí).
function weightGrams(t) {
  if (!t) return null;
  const low = String(t).toLowerCase();
  let m;
  if ((m = low.match(/(\d+(?:[.,]\d+)?)\s*kg/))) return parseFloat(m[1].replace(',', '.')) * 1000;
  if (/\bkilo\b/.test(low)) return 1000;
  if ((m = low.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*g/))) return parseInt(m[1]) * parseFloat(m[2].replace(',', '.'));
  if ((m = low.match(/(\d+(?:[.,]\d+)?)\/(\d+)\s*oz/))) return (parseFloat(m[1].replace(',', '.')) / parseInt(m[2])) * 31.1035;
  if ((m = low.match(/(\d+(?:[.,]\d+)?)\s*oz/))) return parseFloat(m[1].replace(',', '.')) * 31.1035;
  if ((m = low.match(/(\d+(?:[.,]\d+)?)\s*g\b/))) return parseFloat(m[1].replace(',', '.'));
  return null;
}

function inferManufacturer(s) {
  const lower = String(s || '').toLowerCase();
  if (lower.includes('argor')) return 'Argor-Heraeus';
  if (lower.includes('pamp')) return 'PAMP';
  if (lower.includes('valcambi')) return 'Valcambi';
  if (lower.includes('perth')) return 'The Perth Mint';
  if (lower.includes('royal mint') || lower.includes('britannia')) return 'The Royal Mint';
  if (lower.includes('umicore')) return 'Umicore';
  if (lower.includes('heraeus')) return 'Heraeus';
  if (lower.includes('different manufacturers')) return 'Different Manufacturers';
  return '';
}

function detectSeries(s) {
  const lower = String(s || '').toLowerCase();
  if (lower.includes('fortuna')) return 'Fortuna';
  if (lower.includes('combibar')) return 'CombiBar';
  if (lower.includes('kinebar')) return 'kinebar';
  if (lower.includes('green gold')) return 'Green Gold';
  if (lower.includes('britannia')) return 'Britannia';
  if (lower.includes('lunar')) return 'Lunar';
  if (lower.includes('year of the horse')) return 'Year of the Horse 2026';
  return '';
}

function productKeyFromText(value) {
  const text = normalizeKey(value);
  const maker = ['argor heraeus','valcambi','pamp','perth mint','royal mint','umicore','heraeus','different manufacturers'].find(x => text.includes(x)) || '';
  const metal = text.includes('silver') || text.includes('stribr') ? 'silver' : text.includes('platinum') || text.includes('platina') ? 'platinum' : text.includes('palladium') ? 'palladium' : text.includes('gold') || text.includes('zlat') ? 'gold' : '';
  const type = text.includes('coin') || text.includes('mince') ? 'coin' : text.includes('bar') || text.includes('slitek') || text.includes('combibar') ? 'bar' : '';
  const weight = normalizeWeight(text).replace(' ', '').toLowerCase();
  const series = ['fortuna','combibar','kinebar','green gold','britannia','lunar','year of the horse'].find(x => text.includes(x)) || '';
  return [maker, metal, type, weight, series].filter(Boolean).join('|');
}

// Přečte SPRÁVNÝ <CODE> produktu — odstraní related/alternative/flags sekce,
// které mají vlastní <CODE> a jinak by se chytl cizí kód.
function productCode(block) {
  let nf = String(block || '');
  nf = nf.replace(/<RELATED_PRODUCTS>[\s\S]*?<\/RELATED_PRODUCTS>/gi, '');
  nf = nf.replace(/<ALTERNATIVE_PRODUCTS>[\s\S]*?<\/ALTERNATIVE_PRODUCTS>/gi, '');
  nf = nf.replace(/<FLAGS>[\s\S]*?<\/FLAGS>/gi, '');
  return textBetween(nf, 'CODE');
}

function parseSupplierXml(xml) {
  const blocks = String(xml || '').match(/<SHOPITEM\b[\s\S]*?<\/SHOPITEM>/gi) || [];
  return blocks.map((block, index) => {
    const name = textBetween(block, 'NAME');
    const manufacturer = textBetween(block, 'MANUFACTURER');
    const price = parseNumber(textBetween(block, 'PRICE'));
    const purchasePrice = parseNumber(textBetween(block, 'PURCHASE_PRICE'));
    // Původní marže v % = (prodejní - nákupní) / nákupní * 100. Použije se × coef.
    let marginPercent = null;
    if (price != null && purchasePrice != null && purchasePrice > 0) {
      marginPercent = ((price - purchasePrice) / purchasePrice) * 100;
    }
    return {
      index,
      code: productCode(block),
      name,
      manufacturer,
      price,
      purchasePrice,
      marginPercent,
      avIn: textBetween(block, 'AVAILABILITY_IN_STOCK'),
      avOut: textBetween(block, 'AVAILABILITY_OUT_OF_STOCK'),
      normalizedName: normalizeKey(name),
      productKey: productKeyFromText(`${name} ${manufacturer}`)
    };
  });
}

function replaceTag(block, tag, value, createIfMissing = true) {
  const re = new RegExp(`<${tag}([^>]*)>[\\s\\S]*?<\\/${tag}>`, 'i');
  const replacement = `<${tag}>${escapeXml(value)}</${tag}>`;
  if (re.test(block)) return block.replace(re, replacement);
  return createIfMissing ? block.replace(/<\/SHOPITEM>/i, `\n    ${replacement}\n</SHOPITEM>`) : block;
}
function replaceWarehouseQty(block, warehouseName, value) {
  let replaced = false;
  const updated = block.replace(/<WAREHOUSE>[\s\S]*?<\/WAREHOUSE>/gi, wh => {
    if (textBetween(wh, 'NAME') !== warehouseName) return wh;
    replaced = true;
    return replaceTag(wh, 'VALUE', String(value), true);
  });
  if (replaced) return updated;
  return updated.replace(/<\/WAREHOUSES>/i, `\n<WAREHOUSE><NAME>${escapeXml(warehouseName)}</NAME><VALUE>${escapeXml(value)}</VALUE><LOCATION></LOCATION></WAREHOUSE>\n</WAREHOUSES>`);
}
function categoriesXml(cat) { return cat ? `<CATEGORIES><CATEGORY id="${cat.id}">${cat.name}</CATEGORY><DEFAULT_CATEGORY id="${cat.id}">${cat.name}</DEFAULT_CATEGORY></CATEGORIES>` : ''; }
function replaceCategories(block, cat) {
  if (!cat) return block;
  const xml = categoriesXml(cat);
  // Kategorii doplníme JEN novému produktu (žádnou nemá). Existující zařazení nepřepisujeme.
  const m = block.match(/<CATEGORIES>([\s\S]*?)<\/CATEGORIES>/i);
  if (m) {
    const hasCategory = /<CATEGORY[\s>]/i.test(m[1]);  // obsahuje aspoň jednu kategorii?
    if (hasCategory) return block;                      // už zařazeno → nech být
    return block.replace(/<CATEGORIES>[\s\S]*?<\/CATEGORIES>/i, xml);  // prázdné → doplň
  }
  // CATEGORIES blok chybí → doplň
  if (/<ITEM_TYPE>[\s\S]*?<\/ITEM_TYPE>/i.test(block)) return block.replace(/(<ITEM_TYPE>[\s\S]*?<\/ITEM_TYPE>)/i, `$1${xml}`);
  return block.replace(/<\/SHOPITEM>/i, `\n${xml}\n</SHOPITEM>`);
}
function inferCategory(update, block = '') {
  const text = clean(`${update.newName || ''} ${update.supplierName || ''} ${update.stonexName || ''} ${textBetween(block, 'NAME')} ${update.mint || ''}`).toLowerCase();
  const weight = normalizeWeight(`${update.weight || ''} ${text}`);
  const isCoin = /mince|coin|krugerrand|britannia|maple|philharmoniker|kangaroo|kookaburra|koala|lunar|eagle|buffalo|panda|ducat|dukát|noah|ark|libertad/.test(text);
  if (/palladium|palladi/.test(text)) return SHOP_CATEGORIES.PALLADIUM;
  if (/platinum|platina|platin/.test(text)) return SHOP_CATEGORIES.PLATINUM;
  if (/silver|stříbr|stribr/.test(text)) return isCoin ? SHOP_CATEGORIES.SILVER_COINS : SHOP_CATEGORIES.SILVER_BARS;
  if (/gold|zlat/.test(text)) return isCoin ? (SHOP_CATEGORIES.GOLD_COINS[weight] || SHOP_CATEGORIES.GOLD_COINS.root) : (SHOP_CATEGORIES.GOLD_BARS[weight] || SHOP_CATEGORIES.GOLD);
  return null;
}
function updateXmlByCode(originalXml, updates) {
  const byCode = new Map(updates.map(u => [String(u.code), u]));
  return originalXml.replace(/<SHOPITEM\b[\s\S]*?<\/SHOPITEM>/gi, block => {
    const u = byCode.get(String(productCode(block)));
    if (!u || !u.apply) return block;
    let out = block;
    // Název přepíšeme JEN tvým českým (ze supplier XML). Anglické StoneX názvy ani
    // generované překlady do feedu nepouštíme — necháme název, co je v Shoptetu.
    if (u.newName && u.newNameIsCzech) out = replaceTag(out, 'NAME', u.newName, true);
    if (u.updatePurchasePrice && u.newPurchasePrice !== null && u.newPurchasePrice !== undefined) out = replaceTag(out, 'PURCHASE_PRICE', String(u.newPurchasePrice), true);
    if (u.updatePrice && u.newPrice !== null && u.newPrice !== undefined) out = replaceTag(out, 'PRICE', String(u.newPrice), true);
    if (u.newAvailabilityIn) out = replaceTag(out, 'AVAILABILITY_IN_STOCK', u.newAvailabilityIn, true);
    if (u.newAvailabilityOut) out = replaceTag(out, 'AVAILABILITY_OUT_OF_STOCK', u.newAvailabilityOut, true);
    if (u.newWarehouseQty !== undefined && u.newWarehouseQty !== null) out = replaceWarehouseQty(out, u.warehouseName || DEFAULT_WAREHOUSE, u.newWarehouseQty);
    if (u.updateCategory !== false) out = replaceCategories(out, u.category || inferCategory(u, out));
    return out;
  });
}

function toPdfUrl(inputUrl) {
  if (inputUrl.includes('/api/client/catalog/pdf/')) return inputUrl;
  const u = new URL(inputUrl);
  const pdf = new URL('/api/client/catalog/pdf/', STONEX_BASE_URL);
  pdf.searchParams.set('t', String(Date.now()));
  pdf.searchParams.set('view', 'pics');
  pdf.searchParams.set('sorting', 'is_popular_desc');
  pdf.searchParams.set('update_filters', 'true');
  pdf.searchParams.set('update_sorting', '1');
  pdf.searchParams.set('url', u.pathname);
  for (const [k,v] of u.searchParams.entries()) pdf.searchParams.append(k.replace(/\[0\]/g, '[]'), v);
  return pdf.toString();
}
async function fetchStoneXPdfRows(inputUrl) {
  const pdfUrl = toPdfUrl(inputUrl);
  const response = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 30000, validateStatus: () => true, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/pdf,*/*' }});
  if (response.status >= 400) throw new Error(`StoneX PDF returned HTTP ${response.status}`);
  const parsed = await pdfParse(Buffer.from(response.data));
  const rows = parseStoneXPdfText(parsed.text || '', pdfUrl);
  if (!rows.length) throw new Error('StoneX PDF loaded, but no product rows were parsed.');
  return rows;
}

// Z PDF katalogu (catalog-search) vytáhne premium % pro každý produkt podle hmotnosti.
// Řádek PDF: "<název> ... <WE SELL Kč> <premium%> <váha>g". Vrací pole {name, weight, premiumPct}.
async function fetchStoneXPremiumRows() {
  // Stáhne PDF přes přihlášenou session (catalog-search PDF endpoint).
  const cookies = (process.env.STONEX_USER && process.env.STONEX_PASS) ? await ensureSession() : null;
  const url = 'https://stonexbullion.com/api/client/catalog/pdf/?t=' + Date.now() + '&url=%2Fen%2Fgold%2F&update_filters=true&metal_ids%5B%5D=1&term=&page=1';
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, validateStatus: () => true,
    headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/pdf,*/*', ...(cookies ? { Cookie: cookieHeader(cookies) } : {}) } });
  if (r.status >= 400) throw new Error(`StoneX premium PDF HTTP ${r.status}`);
  const parsed = await pdfParse(Buffer.from(r.data));
  const text = parsed.text || '';
  const out = [];
  // Hledá: ... <číslo s mezerami>,<dd> Kč <premium>% <váha>g  (poslední premium% před váhou = WE SELL premium)
  const lineRe = /([0-9][0-9 ]*[.,][0-9]{2})\s*Kč\s+(-?\d+[.,]\d+)%\s+([\d.,]+)\s*g/g;
  // Projdeme po řádcích, vezmeme název = text před první "Kč" částkou
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // poslední výskyt "premium% váhag" na řádku = WE SELL
    let m, last = null;
    const re = /(-?\d+[.,]\d+)%\s+([\d.,]+)\s*g\b/g;
    while ((m = re.exec(line)) !== null) last = m;
    if (!last) continue;
    const premiumPct = parseFloat(last[1].replace(',', '.'));
    const weight = parseFloat(last[2].replace(',', '.'));
    // název = část řádku před první číslicí ceny/percenta
    const name = line.replace(/\s*-?[\d  ][\d  .,]*\s*Kč.*$/, '').replace(/\s+\d.*$/, '').trim() || line.slice(0, 40);
    if (weight > 0 && !isNaN(premiumPct)) out.push({ name, weight, premiumPct });
  }
  return out;
}

// --- JSON katalog endpoint (part_number + gross_price) ---
// Endpoint: /api/client/catalog?metal_ids[]=N&misc[]=in_stock&page=P
// Vrací { status:'Success', data:{ catalog:{ products:[...], paginator:{last_page} } } }
const STONEX_METALS = [{ id: 1, name: 'gold' }, { id: 2, name: 'silver' }, { id: 3, name: 'platinum' }, { id: 4, name: 'palladium' }];

// ====== AUTO-LOGIN (session management) ======
// Drží cookies v paměti; když katalog vrátí invalid_method/401, zkusí se znovu přihlásit.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
let SESSION = { cookies: {}, loggedInAt: null };

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function mergeSetCookie(jar, setCookie) {
  if (!setCookie) return;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const line of arr) {
    const first = line.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
}
function decode(v) { try { return decodeURIComponent(v); } catch { return v; } }

// Přihlášení: GET login (CSRF + cookies) -> POST credentials -> session cookies.
async function stonexLogin() {
  const user = process.env.STONEX_USER, pass = process.env.STONEX_PASS;
  if (!user || !pass) throw new Error('Chybí STONEX_USER / STONEX_PASS v Railway Variables.');

  const jar = {};
  const H = () => ({ 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8', 'Cookie': cookieHeader(jar) });

  // 1) GET login stránku — získá XSRF-TOKEN + session cookie + CSRF token z HTML
  const loginUrl = STONEX_BASE_URL + '/en/login/';
  const g = await axios.get(loginUrl, { headers: H(), timeout: 30000, validateStatus: () => true, maxRedirects: 5 });
  mergeSetCookie(jar, g.headers['set-cookie']);

  // CSRF token bývá v <meta name="csrf-token"> nebo v hidden inputu _token
  let csrf = '';
  const html = typeof g.data === 'string' ? g.data : '';
  let m = html.match(/<meta name="csrf-token" content="([^"]+)"/i)
       || html.match(/name="_token"[^>]*value="([^"]+)"/i);
  if (m) csrf = m[1];
  // fallback: XSRF-TOKEN cookie (Laravel) — dekódovaná
  if (!csrf && jar['XSRF-TOKEN']) csrf = decode(jar['XSRF-TOKEN']);

  // 2) POST přihlášení
  const postHeaders = { 'User-Agent': BROWSER_UA, 'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
    'Referer': loginUrl, 'Origin': STONEX_BASE_URL, 'Cookie': cookieHeader(jar) };
  if (csrf) { postHeaders['X-XSRF-TOKEN'] = csrf; postHeaders['X-CSRF-TOKEN'] = csrf; }

  // Zkusíme běžné login endpointy/políčka (Laravel varianty)
  const candidates = [
    { url: STONEX_BASE_URL + '/api/client/login', body: { email: user, password: pass } },
    { url: STONEX_BASE_URL + '/api/client/auth/login', body: { email: user, password: pass } },
    { url: STONEX_BASE_URL + '/en/login/', body: { email: user, password: pass, _token: csrf } },
    { url: STONEX_BASE_URL + '/login', body: { email: user, password: pass, _token: csrf } },
  ];
  let lastErr = '';
  for (const c of candidates) {
    try {
      const r = await axios.post(c.url, c.body, { headers: { ...postHeaders, 'Cookie': cookieHeader(jar) },
        timeout: 30000, validateStatus: () => true, maxRedirects: 0 });
      mergeSetCookie(jar, r.headers['set-cookie']);
      // úspěch poznáme tak, že máme novou session cookie a status < 400 (nebo redirect 302)
      if ((r.status < 400 || r.status === 302) && (jar['frontend_session'] || jar['laravel_session'])) {
        SESSION = { cookies: jar, loggedInAt: new Date().toISOString() };
        return SESSION;
      }
      lastErr = `${c.url.split('/').pop()}: HTTP ${r.status} ${r.data?.message || r.data?.code || ''}`;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(`StoneX login selhal. Poslední: ${lastErr}. Možná jiný login endpoint — viz /api/diag-login.`);
}

async function ensureSession() {
  if (!SESSION.loggedInAt) await stonexLogin();
  return SESSION.cookies;
}
// ====== /AUTO-LOGIN ======


function catalogUrl(metalId, page) {
  const u = new URL('/api/client/catalog', STONEX_BASE_URL);
  u.searchParams.append('metal_ids[]', String(metalId));
  u.searchParams.append('misc[]', 'in_stock');
  u.searchParams.append('page', String(page));
  return u.toString();
}

// Zkusí stáhnout katalog s aktuální session; při selhání se přihlásí znovu a opakuje.
async function fetchCatalogJson(url) {
  const doFetch = async (cookies) => {
    const headers = {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': STONEX_BASE_URL + '/en/',
      'Content-Type': 'application/json',
    };
    const cookieStr = cookies ? cookieHeader(cookies)
      : (process.env.STONEX_COOKIE || '');
    if (cookieStr) headers['Cookie'] = cookieStr;
    if (cookies && cookies['XSRF-TOKEN']) headers['X-XSRF-TOKEN'] = decode(cookies['XSRF-TOKEN']);
    return axios.post(url, {}, { headers, timeout: 30000, validateStatus: () => true });
  };

  const ok = (r) => r.status < 400 && r.data?.status === 'Success' && r.data.data?.catalog;

  // 1) pokud máme STONEX_USER/PASS, použij auto-login session
  if (process.env.STONEX_USER && process.env.STONEX_PASS) {
    let cookies = await ensureSession();
    let r = await doFetch(cookies);
    if (ok(r)) return r.data.data.catalog;
    // session nejspíš vypršela -> přihlas znovu a zkus jednou
    SESSION = { cookies: {}, loggedInAt: null };
    cookies = await ensureSession();
    r = await doFetch(cookies);
    if (ok(r)) return r.data.data.catalog;
    throw new Error(`StoneX katalog: ${r.status} ${r.data?.code || ''} (po re-loginu)`);
  }

  // 2) fallback na ruční STONEX_COOKIE
  const r = await doFetch(null);
  if (ok(r)) return r.data.data.catalog;
  throw new Error(`StoneX katalog: ${r.status} ${r.data?.code || ''} (zkontroluj STONEX_COOKIE nebo nastav STONEX_USER/PASS)`);
}

async function fetchStoneXJsonRows() {
  const rows = [];
  for (const metal of STONEX_METALS) {
    let page = 1, last = 1;
    do {
      const cat = await fetchCatalogJson(catalogUrl(metal.id, page));
      for (const p of cat.products || []) {
        const code = String(p.part_number || '').trim();
        if (!code) continue;
        rows.push({
          productNumber: code, code,
          stonexName: p.name || '', name: p.name || '',
          grossPrice: p.gross_price, vatPercent: p.vat_percent ?? 0,
          premiumValue: p.premium_value ?? null, premiumPercent: p.premium_percent ?? null,
          fineWeight: p.fine_weight, isCoin: !!p.is_coin,
          metalId: metal.id,
          availability: 1, inStock: true,
          metal: metal.name, source: 'stonex-json',
          weight: normalizeWeight(p.name || ''),
          mint: inferManufacturer(p.name || ''),
          normalizedName: normalizeKey(p.name || ''),
          productKey: productKeyFromText(p.name || ''),
        });
      }
      last = cat.paginator?.last_page || 1;
      page++;
    } while (page <= last);
  }
  if (!rows.length) throw new Error('StoneX JSON loaded, but no products.');
  return rows;
}
function productNumberFromName(name) {
  for (const [re, code] of PRODUCT_NUMBER_BY_NAME) if (re.test(name)) return code;
  return '';
}
function cleanStoneXName(raw) {
  let s = clean(raw);
  const cut = s.search(/-?\d[\d.,\s]*\s*€|\d[\d.,]*\s*%/);
  if (cut > 5) s = s.slice(0, cut);
  s = s.replace(/Argor-Heraus/gi, 'Argor-Heraeus');
  s = s.replace(/\s+\|\s+/g, ' | ');
  return clean(s);
}
function parseStoneXPdfText(text, sourceUrl) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const rows = [];
  for (let i=0; i<lines.length; i++) {
    const chunk = clean([lines[i], lines[i+1] || '', lines[i+2] || '', lines[i+3] || ''].join(' '));
    if (!/(gold|silver|platinum|palladium).*(bar|coin)|(bar|coin).*(gold|silver|platinum|palladium)|combibar/i.test(chunk)) continue;
    if (!/€|%/.test(chunk)) continue;
    const name = cleanStoneXName(chunk);
    if (!name || name.length < 8 || !/(gold|silver|platinum|palladium|bar|coin|combibar)/i.test(name)) continue;
    const euros = [...chunk.matchAll(/(-?[0-9][0-9.,\s]*?)\s*€/g)].map(m => parseNumber(m[1])).filter(v => v !== null);
    const percent = [...chunk.matchAll(/(-?[0-9]+(?:[.,][0-9]+)?)\s*%/g)].map(m => parseNumber(m[1])).filter(v => v !== null);
    const weightMatch = chunk.match(/(\d+(?:[.,]\d+)?)\s*g/i) || chunk.match(/(1\/10|1\/4|1\/2|1)\s*oz/i);
    const code = productNumberFromName(name);
    rows.push({ productNumber: code, code, stonexName: name, name, priceEur: null, premiumEur: euros.length ? euros[euros.length - 1] : null, premiumPct: percent.length ? percent[percent.length - 1] : null, weight: weightMatch ? weightMatch[0].replace('.', ',') : normalizeWeight(name), mint: inferManufacturer(name), availability: null, url: sourceUrl, source: 'stonex-pdf', normalizedName: normalizeKey(name), productKey: productKeyFromText(name) });
  }
  const seen = new Set();
  return rows.filter(r => { const key = r.normalizedName; if (seen.has(key)) return false; seen.add(key); return true; });
}
function normalizeStoneXToCzName(p) {
  const name = `${p.stonexName || p.name || ''} ${p.mint || ''}`;
  const lower = name.toLowerCase();
  const manufacturer = p.mint || inferManufacturer(name);
  const isCoinType = /coin|krugerrand|britannia|kangaroo|maple|philharmoniker|eagle|buffalo|lunar|koala|panda|sovereign|ducat|dukát|libertad|corona|franc|peso/i.test(name);
  const type = isCoinType ? 'mince' : 'slitek';
  let metal = type === 'mince' ? 'zlatá' : 'zlatý';
  if (/silver/.test(lower)) metal = type === 'mince' ? 'stříbrná' : 'stříbrný';
  if (/platinum/.test(lower)) metal = type === 'mince' ? 'platinová' : 'platinový';
  if (/palladium/.test(lower)) metal = type === 'mince' ? 'palladiová' : 'palladiový';
  // způsob ražby: Minted → ražený, Casted → litý (jen u slitků)
  let method = '';
  if (type === 'slitek') {
    if (/minted/i.test(name)) method = metal.endsWith('ý') ? 'ražený' : 'ražená';
    else if (/casted|cast\b/i.test(name)) method = metal.endsWith('ý') ? 'litý' : 'litá';
  }
  // série (Fortuna, Buffalo, Britannia, Kinebar...) a u mincí rok ražby
  const series = detectSeries(name);
  let year = '';
  if (type === 'mince') { const ym = name.match(/\b(19|20)\d{2}\b/); if (ym) year = ym[0]; }
  const weight = normalizeWeight(p.weight || name);
  // Slitek: [výrobce] [série] [kov] [typ] [ražený/litý] [hmotnost]
  // Mince:  [výrobce] [série] [kov] [typ] [hmotnost] [rok]
  const parts = (type === 'mince')
    ? [manufacturer, series, metal, type, weight, year]
    : [manufacturer, series, metal, type, method, weight];
  return clean(parts.filter(Boolean).join(' '));
}
function compare(stonexRows, supplierRows, opts = {}) {
  const eurCzk = Number(opts.eurCzk || DEFAULT_EUR_CZK);
  const marginCzk = Number(opts.marginCzk ?? DEFAULT_MARGIN_CZK);
  const marginPercent = Number(opts.marginPercent ?? DEFAULT_MARGIN_PERCENT);
  const supplierByCode = new Map(supplierRows.map(r => [String(r.code), r]));
  return stonexRows.map(s => {
    let code = String(s.productNumber || s.code || '');
    let supplier = code ? supplierByCode.get(code) : null;
    let matchMethod = supplier ? 'code' : '';
    // Párujeme POUZE přes kód (part_number = CODE). Název/productKey fallbacky byly
    // zdrojem špatných párů (Noemova archa ↔ 4 různé StoneX, China Panda ↔ Tudor Beasts),
    // protože různé produkty stejné hmotnosti mají podobný název. Kód je unikátní.
    if (supplier && !code) code = supplier.code;
    const stonexCzk = (s.grossPrice != null) ? round(s.grossPrice, 2)
                      : (s.priceEur ? round(s.priceEur * eurCzk, 2) : null);
    // Marže z formuláře (nastavitelné po kategoriích), s výchozími hodnotami.
    const mCoin = opts.marginCoin != null ? Number(opts.marginCoin) : 1.5;
    const mBarSmall = opts.marginBarSmall != null ? Number(opts.marginBarSmall) : 2;
    const mBarMid = opts.marginBarMid != null ? Number(opts.marginBarMid) : 1;
    const mBarLarge = opts.marginBarLarge != null ? Number(opts.marginBarLarge) : 0.5;
    const fw = (s.fineWeight != null) ? Number(s.fineWeight) : weightGrams(s.weight || s.name);
    const isCoin = (s.isCoin === true) || /coin|mince|krugerrand|britannia|maple|philharmonik|kangaroo|kookaburra|koala|lunar|eagle|buffalo|panda|ducat|dukát|libertad|sovereign|peso|corona|franc|noah/i.test(`${s.stonexName || ''} ${s.name || ''}`);
    let effPct;
    if (isCoin) effPct = mCoin;                  // mince
    else if (fw == null) effPct = mBarMid;       // neznámá hmotnost → střední pásmo
    else if (fw < 31.1035) effPct = mBarSmall;   // slitek do 1 oz
    else if (fw <= 100) effPct = mBarMid;        // slitek 1 oz až 100 g
    else effPct = mBarLarge;                      // slitek nad 100 g
    let proposedPrice = stonexCzk ? round(stonexCzk * (1 + effPct / 100), 0) : null;
    // pojistka: prodejka vždy nad nákupkou
    if (proposedPrice != null && stonexCzk != null && proposedPrice <= stonexCzk) {
      proposedPrice = round(stonexCzk * 1.005, 0);
    }
    // Název: když supplier (Shoptet) název CHYBÍ, vygeneruj český z výrobce+typu+hmotnosti.
    // Když supplier název je, NEPŘEPISUJEME (necháme tvůj v Shoptetu).
    const hasSupplierName = Boolean(supplier?.name && supplier.name.trim());
    const genName = normalizeStoneXToCzName(s);
    const base = { code, newName: hasSupplierName ? null : genName, newNameIsCzech: !hasSupplierName && Boolean(genName), supplierName: supplier?.name || '', stonexName: s.stonexName || s.name, mint: s.mint, weight: s.weight };
    return { apply: Boolean(supplier && stonexCzk), code, matched: Boolean(supplier), matchMethod, stonexName: s.stonexName || s.name, suggestedName: normalizeStoneXToCzName(s), stonexUrl: s.url, productNumber: code, mint: s.mint, weight: s.weight, purity: s.purity, country: s.country, availability: s.availability, priceEur: s.priceEur, premiumEur: s.premiumEur, premiumPct: s.premiumPct, stonexCzk, supplierName: supplier?.name || '', supplierPrice: supplier?.price ?? null, supplierPurchasePrice: supplier?.purchasePrice ?? null, marginPct: effPct, diffPurchase: supplier && stonexCzk ? round((supplier.purchasePrice || 0) - stonexCzk, 2) : null, newPurchasePrice: stonexCzk || supplier?.purchasePrice || null, newPrice: proposedPrice || supplier?.price || null, newName: base.newName, newNameIsCzech: base.newNameIsCzech, newManufacturer: s.mint || inferManufacturer(s.stonexName || s.name), newAvailabilityIn: DEFAULT_IN_STOCK_TEXT, newAvailabilityOut: DEFAULT_OUT_OF_STOCK_TEXT, newWarehouseQty: s.availability && s.availability > 0 ? 1 : null, warehouseName: DEFAULT_WAREHOUSE, updatePurchasePrice: Boolean(stonexCzk), updatePrice: Boolean(stonexCzk && proposedPrice), updateCategory: true, category: inferCategory(base, '') };
  });
}

app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ====== AUTOMATICKÝ CYKLUS (cron) ======
// Marže z env (stejná pásma jako frontend), nastavitelné na Railway Variables.
function marginOptionsFromEnv() {
  return {
    eurCzk: DEFAULT_EUR_CZK,
    marginCoin: Number(process.env.MARGIN_COIN || 1.5),
    marginBarSmall: Number(process.env.MARGIN_BAR_SMALL || 2),
    marginBarMid: Number(process.env.MARGIN_BAR_MID || 1),
    marginBarLarge: Number(process.env.MARGIN_BAR_LARGE || 0.5),
  };
}

// Celý cyklus bez frontendu: supplier z URL → StoneX → compare → feed.
async function runFullCycle() {
  const startedAt = new Date().toISOString();
  // 1) supplier XML z URL (nutné pro automatiku)
  if (!process.env.SHOPTET_SUPPLIER_FEED_URL) {
    throw new Error('Chybí SHOPTET_SUPPLIER_FEED_URL — bez ní nelze automaticky stáhnout supplier XML.');
  }
  const supRes = await axios.get(process.env.SHOPTET_SUPPLIER_FEED_URL, {
    timeout: 60000, headers: { 'User-Agent': USER_AGENT },
  });
  const supplierXml = supRes.data;
  const supplierRows = parseSupplierXml(supplierXml);

  // 2) StoneX katalog (JSON, auto-login)
  const stonexRows = await fetchStoneXJsonRows();

  // 3) párování + ceny
  const rows = compare(stonexRows, supplierRows, marginOptionsFromEnv());

  // 3b) Spot zlata + dopočet nespárovaných zlatých produktů.
  let spot = null;
  try { spot = await getGoldSpotCzkPerGram(); } catch (e) { console.warn('[SPOT]', e.message); }

  // Premium z PDF katalogu (přesné premium % pro každý produkt) — pro neskladové.
  let premiumRows = [];
  try { premiumRows = await fetchStoneXPremiumRows(); } catch (e) { console.warn('[PREMIUM-PDF]', e.message); }

  // Najde reálné premium % z PDF pro daný supplier název + hmotnost.
  function premiumPctFromPdf(supName, fw) {
    if (!premiumRows.length || !fw) return null;
    const low = (supName || '').toLowerCase();
    // klíčová slova výrobce/série z názvu pro spárování s PDF řádkem
    const kw = ['pamp','argor','valcambi','heraeus','perth','britannia','maple','philharmon','krugerrand','buffalo','eagle','kangaroo','umicore','c.hafner','hafner','noah','tudor','queen','panda','lunar','sovereign','vreneli','corona','ducat','dukát'];
    const supKw = kw.filter(k => low.includes(k));
    let best = null;
    for (const p of premiumRows) {
      if (Math.abs(p.weight - fw) / fw > 0.02) continue;  // hmotnost musí sedět (±2 %)
      const pl = p.name.toLowerCase();
      const score = supKw.filter(k => pl.includes(k)).length;
      if (score > 0 && (!best || score > best.score)) best = { ...p, score };
    }
    return best ? best.premiumPct : null;
  }

  const opts = marginOptionsFromEnv();
  function marginForWeight(fw, isCoin) {
    if (isCoin) return opts.marginCoin;
    if (fw == null) return opts.marginBarMid;
    if (fw < 31.1035) return opts.marginBarSmall;
    if (fw <= 100) return opts.marginBarMid;
    return opts.marginBarLarge;
  }
  // Premium na gram odvozený z reálných StoneX cen (gross_price) produktů STEJNÉ hmotnosti.
  // Ne přes premiumValue (nespolehlivé) a ne mícháním hmotností (1oz≠100g premium/g).
  function premiumPerGramSameWeight(fw) {
    if (!spot) return null;
    // produkty se stejnou hmotností (±2 %) ze StoneX JSON, co mají cenu
    const same = stonexRows.filter(s => {
      if (s.metalId !== 1 || !s.fineWeight || s.grossPrice == null) return false;
      return Math.abs(s.fineWeight - fw) / fw <= 0.02;
    });
    if (same.length) {
      // premium/g = (gross - spot×váha×ryzost) / váha, průměr přes stejně velké
      const avg = same.reduce((a, s) => a + ((s.grossPrice - spot * s.fineWeight * 0.9999) / s.fineWeight), 0) / same.length;
      return avg > 0 ? avg : 0;
    }
    return null;  // žádný stejně velký → necháme na fallbacku
  }

  let spotPriced = 0, belowCostFixed = 0;
  if (spot) {
    // Pojistka u spárovaných (rows = StoneX produkty se supplier protějškem)
    for (const r of rows) {
      if (r.matched && r.newPrice != null && r.stonexCzk != null && r.newPrice < r.stonexCzk) {
        r.newPrice = Math.round(r.stonexCzk * 1.005);
        r.updatePrice = true; belowCostFixed++;
      }
    }
    // Které supplier kódy už pokrývá StoneX (jsou v rows jako matched)?
    const coveredCodes = new Set(rows.filter(r => r.matched && r.code).map(r => String(r.code)));
    // Dopočet ze spotu pro supplier produkty, které StoneX NEMÁ (nejsou v rows)
    const spotUpdates = [];
    for (const sup of supplierRows) {
      if (!sup.code || coveredCodes.has(String(sup.code))) continue;
      const name = (sup.name || '').toLowerCase();
      const isGold = /zlat|gold/.test(name) && !/st[rř][ií]b|silver|platin|pallad/.test(name);
      const fw = weightGrams(sup.name || '');
      if (!isGold || !fw) continue;
      // Premium odvozené z reálných StoneX cen STEJNĚ velkých 100g produktů (ne míchání 1oz/100g).
      const premPerG = premiumPerGramSameWeight(fw);
      let nakup;
      if (premPerG != null) {
        nakup = spot * fw * 0.9999 + premPerG * fw;
      } else {
        // žádný stejně velký StoneX produkt → konzervativní odhad: spot + 1,5 % premium
        nakup = spot * fw * 0.9999 * 1.015;
      }
      const m = marginForWeight(fw, /coin|mince/.test(name));
      let price = Math.round(nakup * (1 + m / 100));
      if (sup.purchasePrice && price < sup.purchasePrice) {
        price = Math.round(sup.purchasePrice * 1.005); belowCostFixed++;
      }
      spotUpdates.push({
        code: sup.code, apply: true, updatePrice: true, updatePurchasePrice: true,
        matched: false, matchMethod: 'spot',
        newPrice: price, newPurchasePrice: Math.round(nakup),
        newName: (sup.name && sup.name.trim()) ? null : normalizeStoneXToCzName({ stonexName: sup.name, name: sup.name, mint: '' }),
        newNameIsCzech: !(sup.name && sup.name.trim()), updateCategory: false,
        newAvailabilityOut: DEFAULT_OUT_OF_STOCK_TEXT,   // dopočtené = StoneX nemá skladem → předobjednávka
        newWarehouseQty: 0, warehouseName: DEFAULT_WAREHOUSE,
      });
      spotPriced++;
    }
    // přidej dopočtené do rows, ať jdou do feedu
    rows.push(...spotUpdates);
  }

  // 4) generování feedu (spárované + dopočtené ze spotu)
  const updates = rows.filter(r => r.apply && r.updatePrice && r.code);
  const xml = updateXmlByCode(supplierXml, updates);

  GENERATED_FEED = xml;
  LAST_RUN = {
    at: startedAt, finishedAt: new Date().toISOString(),
    supplier: supplierRows.length, stonex: stonexRows.length,
    matched: rows.filter(r => r.matched).length, updated: updates.length,
    spotPriced, belowCostFixed, spot: spot ? Math.round(spot) : null,
  };
  console.log(`[CRON] ${LAST_RUN.finishedAt} supplier=${LAST_RUN.supplier} stonex=${LAST_RUN.stonex} matched=${LAST_RUN.matched} spotPriced=${spotPriced} belowCostFixed=${belowCostFixed} updated=${updates.length}`);
  return LAST_RUN;
}

// Ruční spuštění celého cyklu (i pro test). Vyžaduje heslo.
app.post('/api/run', requireAuth, async (_req, res) => {
  try { const r = await runFullCycle(); res.json({ ok: true, lastRun: r }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/run', requireAuth, async (_req, res) => {
  try { const r = await runFullCycle(); res.json({ ok: true, lastRun: r }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// STÁLÁ FEED URL — tohle dáš do Shoptetu jako zdroj importu.
app.get('/output_feed.xml', (_req, res) => {
  if (!GENERATED_FEED) return res.status(503).send('Feed zatím nevygenerován. Spusť /api/run nebo počkej na cron.');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(GENERATED_FEED);
});

// Stav posledního běhu
app.get('/api/last-run', (_req, res) => res.json({ lastRun: LAST_RUN, hasFeed: !!GENERATED_FEED }));
// ====== /AUTOMATICKÝ CYKLUS ======


// Verzní endpoint — ověří, jaká cenová logika reálně běží.
app.get('/api/diag-version', (_req, res) => {
  res.json({
    version: 'weight-margins-v2',
    pricing: 'mince=marginCoin, slitek<1oz=marginBarSmall, 1oz-100g=marginBarMid, >100g=marginBarLarge',
    defaults: { coin: 1.5, barSmall: 2, barMid: 1, barLarge: 0.5 },
    note: 'PRICE = stonexCzk * (1 + effPct/100), bez zakladni marze',
    builtAt: '2026-05-30',
  });
});

// Diagnostika loginu: zkusí se přihlásit a vrátí výsledek.
app.get('/api/diag-login', requireAuth, async (_req, res) => {
  try {
    SESSION = { cookies: {}, loggedInAt: null };
    const s = await stonexLogin();
    const haveSession = !!(s.cookies['frontend_session'] || s.cookies['laravel_session']);
    res.json({ ok: haveSession, loggedInAt: s.loggedInAt,
      cookies: Object.keys(s.cookies), hint: haveSession ? 'Login OK' : 'Cookies získány, ale chybí session — možná jiný endpoint.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message,
      hint: 'Zkontroluj STONEX_USER/STONEX_PASS. Pokud StoneX používá jiný login endpoint, pošli mi ho.' });
  }
});

// Diagnostika: vyzkouší metody proti StoneX a vrátí, která zabrala.
app.get('/api/diag-stonex', requireAuth, async (_req, res) => {
  const url = catalogUrl(1, 1);
  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest', 'Referer': STONEX_BASE_URL + '/en/',
  };
  if (process.env.STONEX_COOKIE) baseHeaders['Cookie'] = process.env.STONEX_COOKIE;
  const variants = [
    { label: 'GET', method: 'get', headers: baseHeaders },
    { label: 'POST json {}', method: 'post', headers: { ...baseHeaders, 'Content-Type': 'application/json' }, data: {} },
    { label: 'POST form', method: 'post', headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }, data: '' },
  ];
  const out = [];
  for (const v of variants) {
    try {
      const r = await axios({ url, method: v.method, headers: v.headers, data: v.data, timeout: 20000, validateStatus: () => true });
      out.push({ variant: v.label, http: r.status, status: r.data?.status, code: r.data?.code,
        products: r.data?.data?.catalog?.products?.length ?? null });
    } catch (e) { out.push({ variant: v.label, error: e.message }); }
  }
  res.json({ url, hasCookie: !!process.env.STONEX_COOKIE, results: out });
});
app.post('/api/parse-supplier', requireAuth, upload.single('feed'), async (req, res) => { try { let xml = req.file ? req.file.buffer.toString('utf8') : req.body.xml; if (!xml && process.env.SHOPTET_SUPPLIER_FEED_URL) xml = (await axios.get(process.env.SHOPTET_SUPPLIER_FEED_URL, { timeout: 30000, headers: { 'User-Agent': USER_AGENT } })).data; if (!xml) return res.status(400).json({ error: 'Missing XML file or SHOPTET_SUPPLIER_FEED_URL.' }); const products = parseSupplierXml(xml); res.json({ count: products.length, products, xml }); } catch (error) { res.status(500).json({ error: error.message, stage: 'parse-supplier' }); } });
app.post('/api/fetch-stonex', requireAuth, async (req, res) => { const catalogUrl = req.body.catalogUrl; try { let products, source; try { products = await fetchStoneXJsonRows(); source = 'stonex-json'; } catch (jsonErr) { if (!catalogUrl) throw jsonErr; products = await fetchStoneXPdfRows(catalogUrl); source = 'stonex-pdf'; } res.json({ count: products.length, products, fallbackUsed: source === 'stonex-pdf', source }); } catch (error) { res.status(500).json({ error: error.message, stage: 'fetch-stonex', hint: 'JSON i PDF endpoint selhaly. Zkontroluj STONEX_COOKIE nebo nahraj JSON ručně.' }); } });
app.post('/api/compare', requireAuth, (req, res) => { const { stonexRows, supplierRows, options } = req.body; if (!Array.isArray(stonexRows) || !Array.isArray(supplierRows)) return res.status(400).json({ error: 'Missing rows.' }); res.json({ rows: compare(stonexRows, supplierRows, options) }); });
app.post('/api/generate-feed', requireAuth, (req, res) => { try { const { originalXml, updates } = req.body; if (!originalXml || !Array.isArray(updates)) return res.status(400).json({ error: 'Missing originalXml or updates.' }); const xml = updateXmlByCode(originalXml, updates); res.setHeader('Content-Type', 'application/xml; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="productsSupplier-updated.xml"'); res.send(xml); } catch (error) { res.status(500).json({ error: error.message, stage: 'generate-feed' }); } });

app.listen(PORT, () => {
  console.log(`StoneX Shoptet Feed Tool running on port ${PORT}`);

  // Automatické pravidelné přecenění (cron). Plán z env CRON_SCHEDULE, default každou hodinu.
  const schedule = process.env.CRON_SCHEDULE || '0 * * * *';
  if (process.env.ENABLE_CRON !== 'false' && cron.validate(schedule)) {
    cron.schedule(schedule, () => {
      console.log(`[CRON] Spouštím automatické přecenění (${schedule})...`);
      runFullCycle().catch(e => console.error('[CRON] Chyba:', e.message));
    });
    console.log(`[CRON] Naplánováno: ${schedule}`);
    // První běh krátce po startu (ať je feed hned k dispozici)
    setTimeout(() => runFullCycle().catch(e => console.error('[CRON] Úvodní běh:', e.message)), 5000);
  } else {
    console.log('[CRON] Vypnuto (ENABLE_CRON=false nebo neplatný CRON_SCHEDULE).');
  }
});
