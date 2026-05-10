// ============================================
// TOXIC TECH PLUGER - Node.js Server
// Render + Cloudflare Tunnel Deployment
// Powered by YOBBYKING
// ============================================

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    SW_API_KEY: 'sw_debee621eb3c04413149a47c97d649114cfcb2eb6f3bb13d0be8a65d',
    SW_API_URL: 'https://swiftwallet.co.ke/v3/stk-initiate/',
    ADMIN_USER: 'gracey',
    ADMIN_PASS: 'jayson',
    SITE_NAME: 'TOXIC TECH PLUGER',
    SITE_SHORT: 'TTP',
    WHATSAPP_URL: 'https://wa.me/254104751847',
    DATA_DIR: path.join(__dirname, 'data'),
    UPLOADS_DIR: path.join(__dirname, 'data', 'uploads'),
    LINKS_FILE: path.join(__dirname, 'data', 'links.json'),
    LOG_FILE: path.join(__dirname, 'data', 'callback_log.txt')
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));
app.use(session({
    secret: 'ttp-session-secret-' + crypto.randomBytes(16).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        sameSite: 'lax'
    }
}));

// Auto-detect base URL
function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    return `${protocol}://${req.get('host')}`;
}

// ============================================
// HELPERS
// ============================================
function ensureDataDirs() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG.UPLOADS_DIR)) fs.mkdirSync(CONFIG.UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG.LINKS_FILE)) fs.writeFileSync(CONFIG.LINKS_FILE, '[]');
}

function getLinksData() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG.LINKS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveLinksData(data) {
    fs.writeFileSync(CONFIG.LINKS_FILE, JSON.stringify(data, null, 2));
}

function generateId(prefix = 'TTP') {
    return prefix + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function isAdmin(req) {
    return req.session.admin_logged_in === true;
}

function logCallback(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(CONFIG.LOG_FILE, logEntry);
}

function jsonResp(res, data, code = 200) {
    res.status(code).json(data);
}

// Init data dirs on startup
ensureDataDirs();

// ============================================
// FILE UPLOAD SETUP
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CONFIG.UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, generateId('FILE') + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowed = ['pdf','jpg','jpeg','png','gif','webp','svg','txt','csv','zip','rar','doc','docx','xls','xlsx','mp3','mp4','apk','exe','psd','ai'];
        const ext = path.extname(file.originalname).toLowerCase().replace('.','');
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('File type not allowed'), false);
    }
});

// ============================================
// ROUTES - STATIC PAGES
// ============================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/pay.html', (req, res) => res.sendFile(path.join(__dirname, 'pay.html')));

// ============================================
// API - AUTH
// ============================================
app.get('/api/auth', (req, res) => {
    const action = req.query.action;
    if (action === 'check') {
        jsonResp(res, { logged_in: isAdmin(req), user: req.session.admin_user || null });
    } else if (action === 'logout') {
        req.session.destroy();
        jsonResp(res, { success: true, message: 'Logged out' });
    } else {
        jsonResp(res, { success: false, message: 'Invalid action' }, 400);
    }
});

app.post('/api/auth', (req, res) => {
    const action = req.query.action;
    if (action === 'login') {
        const { username, password } = req.body;
        if (username === CONFIG.ADMIN_USER && password === CONFIG.ADMIN_PASS) {
            req.session.admin_logged_in = true;
            req.session.admin_user = username;
            req.session.login_time = Date.now();
            jsonResp(res, { success: true, message: 'Login successful' });
        } else {
            jsonResp(res, { success: false, message: 'Invalid credentials' }, 401);
        }
    } else {
        jsonResp(res, { success: false, message: 'Invalid action' }, 400);
    }
});

// ============================================
// API - STK PUSH
// ============================================
app.post('/api/stk-push', async (req, res) => {
    const { link_id, phone_number } = req.body;
    if (!link_id || !phone_number) {
        return jsonResp(res, { success: false, message: 'Missing link ID or phone number' }, 400);
    }

    const links = getLinksData();
    let link = links.find(l => l.id === link_id);
    if (!link) return jsonResp(res, { success: false, message: 'Payment link not found' }, 404);
    if (link.status === 'paid') return jsonResp(res, { success: false, message: 'This link has already been paid' }, 400);

    // Format phone number
    let phone = phone_number.replace(/[^0-9]/g, '');
    if (phone.length === 10 && phone[0] === '0') {
        phone = '254' + phone.substring(1);
    } else if (phone.length === 9 && (phone[0] === '7' || phone[0] === '1')) {
        phone = '254' + phone;
    } else if (phone.length === 12 && phone.startsWith('254')) {
        // already correct
    } else {
        return jsonResp(res, { success: false, message: 'Invalid phone number. Use format 07XX, 01XX, 7XX, 1XX, or 254XXXXXXXXX' }, 400);
    }

    const reference = `TTP-${link_id}-${Date.now()}`;
    const callbackUrl = `${getBaseUrl(req)}/api/webhook?link_id=${encodeURIComponent(link_id)}`;

    const stkData = {
        api_key: CONFIG.SW_API_KEY,
        phone_number: phone,
        amount: parseInt(link.amount),
        reference: reference,
        callback_url: callbackUrl,
        description: 'Payment for: ' + link.title
    };

    try {
        logCallback(`STK Request for ${link_id}: Phone=${phone}, Ref=${reference}`);
        const response = await fetch(CONFIG.SW_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + CONFIG.SW_API_KEY
            },
            body: JSON.stringify(stkData),
            timeout: 30000
        });

        const result = await response.json();
        logCallback(`STK Response for ${link_id}: ${JSON.stringify(result)}`);

        if (response.ok && result.success) {
            link.status = 'pending';
            link.last_transaction = {
                phone: phone,
                reference: reference,
                transaction_id: result.transaction_id || null,
                checkout_request_id: result.checkout_request_id || null,
                initiated_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
            };
            saveLinksData(links);
            jsonResp(res, { success: true, message: 'STK Push sent! Check your phone and enter PIN.', reference });
        } else {
            const errorMsg = result.error || 'Payment initiation failed. Please try again.';
            jsonResp(res, { success: false, message: errorMsg }, response.status >= 400 ? response.status : 500);
        }
    } catch (err) {
        logCallback(`STK cURL Error for ${link_id}: ${err.message}`);
        jsonResp(res, { success: false, message: 'Connection error. Please try again.' }, 500);
    }
});

// ============================================
// API - WEBHOOK (SwiftWallet callback)
// ============================================
app.post('/api/webhook', (req, res) => {
    const data = req.body;
    logCallback('Webhook received: ' + JSON.stringify(data));

    if (!data) {
        logCallback('Webhook Error: Empty or invalid JSON payload');
        return res.status(200).json({ status: 'received' });
    }

    const status = data.status || 'unknown';
    const externalReference = data.external_reference || '';
    const transactionId = data.transaction_id || null;
    const mpesaReceipt = data.result?.MpesaReceiptNumber || null;
    const resultCode = data.result?.ResultCode ?? -1;
    const resultDesc = data.result?.ResultDesc || '';
    const linkId = req.query.link_id || '';

    logCallback(`Webhook parsed - Status: ${status}, LinkID: ${linkId}, Receipt: ${mpesaReceipt}, Ref: ${externalReference}`);

    let targetId = '';
    if (linkId) {
        targetId = linkId;
    } else if (externalReference) {
        const match = externalReference.match(/TTP-([A-Z0-9]{8})-\d+/);
        if (match) {
            targetId = match[1];
        } else {
            logCallback(`Webhook Warning: Could not determine link ID from reference: ${externalReference}`);
            return res.status(200).json({ status: 'received', note: 'Could not determine link' });
        }
    }

    const links = getLinksData();
    let found = false;
    for (let i = 0; i < links.length; i++) {
        if (links[i].id === targetId) {
            found = true;
            if (status === 'completed' || resultCode === 0) {
                links[i].status = 'paid';
                links[i].paid_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
                links[i].mpesa_receipt = mpesaReceipt;
                links[i].paid_phone = data.result?.Phone || (links[i].last_transaction?.phone || '');
                links[i].payment_details = {
                    mpesa_receipt: mpesaReceipt,
                    amount: data.result?.Amount || links[i].amount,
                    phone: data.result?.Phone || '',
                    transaction_date: data.result?.TransactionDate || ''
                };
                logCallback(`Webhook SUCCESS: Link ${targetId} marked as PAID. Receipt: ${mpesaReceipt}`);
            } else {
                links[i].status = 'failed';
                links[i].fail_reason = resultDesc;
                logCallback(`Webhook FAILED: Link ${targetId} - ${resultDesc}`);
            }
            break;
        }
    }

    if (found) {
        saveLinksData(links);
    } else {
        logCallback(`Webhook Warning: Link ${targetId} not found in data`);
    }

    // CRITICAL: Always return 200 to SwiftWallet
    res.status(200).json({ status: 'received', link_id: targetId });
});

// ============================================
// API - LINKS CRUD
// ============================================

// Public: check payment status
app.get('/api/links', (req, res) => {
    const action = req.query.action;

    if (action === 'check') {
        const linkId = req.query.id;
        if (!linkId) return jsonResp(res, { success: false, message: 'Missing link ID' }, 400);
        const links = getLinksData();
        const link = links.find(l => l.id === linkId);
        if (!link) return jsonResp(res, { success: false, message: 'Link not found' }, 404);
        return jsonResp(res, {
            success: true,
            id: link.id,
            title: link.title,
            amount: link.amount,
            description: link.description,
            status: link.status,
            paid_at: link.paid_at || null,
            delivery_text: link.delivery_text || '',
            delivery_file: link.delivery_file || null,
            delivery_file_name: link.delivery_file_name || ''
        });
    }

    if (action === 'delivery') {
        const linkId = req.query.id;
        if (!linkId) return jsonResp(res, { success: false, message: 'Missing link ID' }, 400);
        const links = getLinksData();
        const link = links.find(l => l.id === linkId);
        if (!link) return jsonResp(res, { success: false, message: 'Link not found' }, 404);
        if (link.status !== 'paid') return jsonResp(res, { success: false, message: 'Payment not confirmed' }, 403);
        return jsonResp(res, {
            success: true,
            title: link.title,
            content_text: link.delivery_text || '',
            content_file: link.delivery_file || null,
            content_file_name: link.delivery_file_name || ''
        });
    }

    // Admin only: list all links
    if (!isAdmin(req)) return jsonResp(res, { success: false, message: 'Unauthorized' }, 401);
    const links = getLinksData().reverse();
    jsonResp(res, { success: true, links });
});

// Admin: create link
app.post('/api/links', (req, res) => {
    if (!isAdmin(req)) return jsonResp(res, { success: false, message: 'Unauthorized' }, 401);

    const { title, amount, description, delivery_text, delivery_file, delivery_file_name } = req.body;
    if (!title || !amount || amount <= 0) {
        return jsonResp(res, { success: false, message: 'Title and amount are required' }, 400);
    }

    const link = {
        id: generateId('TTP'),
        title: title.trim(),
        amount: parseInt(amount),
        description: (description || '').trim(),
        delivery_text: (delivery_text || '').trim(),
        delivery_file: delivery_file || null,
        delivery_file_name: delivery_file_name || null,
        status: 'active',
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
        visits: 0,
        paid_at: null
    };

    const links = getLinksData();
    links.push(link);
    saveLinksData(links);
    jsonResp(res, { success: true, link, message: 'Link created' });
});

// Admin: update link
app.put('/api/links', (req, res) => {
    if (!isAdmin(req)) return jsonResp(res, { success: false, message: 'Unauthorized' }, 401);

    const { id, title, amount, description, delivery_text, delivery_file, delivery_file_name } = req.body;
    if (!id) return jsonResp(res, { success: false, message: 'Missing link ID' }, 400);

    const links = getLinksData();
    const link = links.find(l => l.id === id);
    if (!link) return jsonResp(res, { success: false, message: 'Link not found' }, 404);

    if (title !== undefined) link.title = title.trim();
    if (amount !== undefined) link.amount = parseInt(amount);
    if (description !== undefined) link.description = description.trim();
    if (delivery_text !== undefined) link.delivery_text = delivery_text.trim();
    if (delivery_file !== undefined) link.delivery_file = delivery_file;
    if (delivery_file_name !== undefined) link.delivery_file_name = delivery_file_name;

    saveLinksData(links);
    jsonResp(res, { success: true, message: 'Link updated' });
});

// Admin: delete link
app.delete('/api/links', (req, res) => {
    if (!isAdmin(req)) return jsonResp(res, { success: false, message: 'Unauthorized' }, 401);

    const { id } = req.body;
    if (!id) return jsonResp(res, { success: false, message: 'Missing link ID' }, 400);

    const links = getLinksData().filter(l => l.id !== id);
    saveLinksData(links);
    jsonResp(res, { success: true, message: 'Link deleted' });
});

// ============================================
// API - FILE UPLOAD
// ============================================
app.post('/api/upload', (req, res) => {
    if (!isAdmin(req)) return jsonResp(res, { success: false, message: 'Unauthorized' }, 401);

    upload.single('file')(req, res, (err) => {
        if (err) {
            let msg = 'Upload failed';
            if (err.message) msg = err.message;
            return jsonResp(res, { success: false, message: msg }, 400);
        }
        if (!req.file) {
            return jsonResp(res, { success: false, message: 'No file uploaded' }, 400);
        }

        jsonResp(res, {
            success: true,
            message: 'File uploaded',
            file_path: req.file.filename,
            file_name: req.file.originalname,
            file_size: req.file.size,
            file_type: path.extname(req.file.originalname).toLowerCase().replace('.', '')
        });
    });
});

// ============================================
// API - SERVE FILE (with payment check)
// ============================================
app.get('/api/serve-file', (req, res) => {
    const fileId = (req.query.f || '').replace(/[^A-Za-z0-9._-]/g, '');
    if (!fileId) return res.status(404).send('File not found');

    const filePath = path.join(CONFIG.UPLOADS_DIR, fileId);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    // Check payment for delivery files
    const checkPayment = req.query.check !== 'false';
    if (checkPayment) {
        const links = getLinksData();
        const link = links.find(l => l.delivery_file === fileId);
        if (link && link.status !== 'paid') {
            return res.status(403).send('Payment required to access this file');
        }

        // Try to get original file name
        if (link && link.delivery_file_name) {
            const mimeTypes = {
                '.pdf': 'application/pdf',
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.png': 'image/png', '.gif': 'image/gif',
                '.webp': 'image/webp', '.svg': 'image/svg+xml',
                '.txt': 'text/plain', '.csv': 'text/csv',
                '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
                '.doc': 'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.xls': 'application/vnd.ms-excel',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
                '.apk': 'application/vnd.android.package-archive',
                '.exe': 'application/octet-stream',
                '.psd': 'image/vnd.adobe.photoshop',
                '.ai': 'application/postscript'
            };
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = mimeTypes[ext] || 'application/octet-stream';
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', fs.statSync(filePath).size);
            res.setHeader('Content-Disposition', `attachment; filename="${link.delivery_file_name}"`);
            return res.sendFile(filePath);
        }
    }

    res.sendFile(filePath);
});

// ============================================
// CLOUDFLARE TUNNEL (auto-starts with server)
// ============================================
const CF_TOKEN = 'eyJhIjoiYmU5ZmIwMGMzNDhlMTBkNjBlNDMxMjk4ZTYyYTM2MjEiLCJ0IjoiMDk2NGExODUtNzBjNC00NDQ5LWFjOWMtNWU2NTkxNjYxZWU5IiwicyI6Ik1UbGhNemcyWTJVdE5EUmhPUzAwTkdRekxUaGpOVEV0TlRnNU4ySmlOekl6TTJVNCJ9';

function startCloudflared() {
    const cfBinary = path.join(__dirname, 'cloudflared');
    if (!fs.existsSync(cfBinary)) {
        console.log('[CLOUDFLARE] cloudflared binary not found. Skipping tunnel.');
        console.log('[CLOUDFLARE] If you need tunnel, download cloudflared and place it in project root.');
        return;
    }
    const tunnel = spawn(cfBinary, ['tunnel', 'run', '--token', CF_TOKEN], {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    tunnel.stdout.on('data', (data) => console.log('[CLOUDFLARE]', data.toString().trim()));
    tunnel.stderr.on('data', (data) => console.log('[CLOUDFLARE]', data.toString().trim()));
    tunnel.on('close', (code) => {
        console.log(`[CLOUDFLARE] Tunnel exited with code ${code}. Restarting in 5s...`);
        setTimeout(startCloudflared, 5000);
    });
    console.log('[CLOUDFLARE] Tunnel started successfully!');
}

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('============================================');
    console.log('  TOXIC TECH PLUGER - Server Running');
    console.log(`  Port: ${PORT}`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log('  Powered by YOBBYKING');
    console.log('============================================');
    // Auto-start cloudflared tunnel
    startCloudflared();
});
