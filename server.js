const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(cors());

// IMPORTANT: Setup raw body parsing for webhook signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// ========== CONFIGURATION ==========
const PAY0_API_URL = 'https://pay0.shop/api/create-order';
const PAY0_CHECK_ORDER_URL = 'https://pay0.shop/api/check-order-status';
const PAY0_API_KEY = 'f112200bfde077dca7e44302f88c5423';
const PAY0_WEBHOOK_SECRET = 'IvNFv8EdX531380279';

// Webhook log file
const WEBHOOK_LOG_FILE = 'webhook_payments.log';

// ========== HELPER FUNCTIONS ==========

// Helper function to make HTTP requests (works on all Node versions)
function makeRequest(url, postData) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const postDataStr = new URLSearchParams(postData).toString();
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postDataStr)
            }
        };
        
        const req = lib.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    resolve({ status: false, message: data });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.write(postDataStr);
        req.end();
    });
}

// Log webhook to file
function logWebhook(data) {
    const logEntry = `${new Date().toISOString()} | ${JSON.stringify(data)}\n`;
    fs.appendFileSync(WEBHOOK_LOG_FILE, logEntry);
}

// ========== CREATE ORDER API ==========
app.post('/api/create-order', async (req, res) => {
    try {
        const { customer_mobile, amount, order_id, redirect_url, customer_name } = req.body;
        
        if (!customer_mobile || !amount || !order_id) {
            return res.status(400).json({ status: false, message: 'Missing required fields' });
        }
        
        const postData = {
            customer_mobile: customer_mobile,
            customer_name: customer_name || 'Customer',
            user_token: PAY0_API_KEY,
            amount: amount.toString(),
            order_id: order_id,
            redirect_url: redirect_url || 'https://imorecharge-production-456d.up.railway.app/payment-callback',
            remark1: 'IMO Recharge',
            remark2: order_id
        };
        
        console.log(`[ORDER] Creating order: ${order_id} for ₹${amount}`);
        
        const data = await makeRequest(PAY0_API_URL, postData);
        console.log(`[ORDER] Pay0 response:`, data);
        
        // FIX: Clean the payment_url by removing escaped slashes
      // FIX: Clean the payment_url aggressively
if (data.result && data.result.payment_url) {
    let cleanUrl = data.result.payment_url;
    cleanUrl = cleanUrl.replace(/\\\//g, '/');
    cleanUrl = cleanUrl.replace(/^['"]|['"]$/g, '');
    cleanUrl = cleanUrl.replace(/'/g, '');
    cleanUrl = cleanUrl.trim();
    data.result.payment_url = cleanUrl;
    console.log(`[ORDER] Cleaned payment_url: ${cleanUrl}`);
}
        
        res.json(data);
    } catch (error) {
        console.error('[ORDER] Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== CHECK ORDER STATUS API ==========
app.post('/api/check-order-status', async (req, res) => {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ status: false, message: 'Missing order_id' });
        }
        
        const postData = {
            user_token: PAY0_API_KEY,
            order_id: order_id
        };
        
        console.log(`[STATUS] Checking status for order: ${order_id}`);
        
        const data = await makeRequest(PAY0_CHECK_ORDER_URL, postData);
        console.log(`[STATUS] Response:`, data);
        res.json(data);
    } catch (error) {
        console.error('[STATUS] Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== OFFICIAL PAY0 WEBHOOK ENDPOINT (UPDATED) ==========
app.post('/wc-api/pay0-payment', (req, res) => {
    console.log(`========== PAY0 OFFICIAL WEBHOOK RECEIVED ==========`);
    console.log(`[WEBHOOK] Headers:`, req.headers);
    console.log(`[WEBHOOK] Content-Type:`, req.headers['content-type']);
    
    // Get the raw body as string for proper parsing
    let rawBody = '';
    req.on('data', chunk => {
        rawBody += chunk;
    });
    
    req.on('end', () => {
        console.log(`[WEBHOOK] Raw Body: ${rawBody}`);
        
        let body = {};
        
        // Parse based on content type
        const contentType = req.headers['content-type'] || '';
        
        if (contentType.includes('application/json')) {
            // JSON format
            try {
                body = JSON.parse(rawBody);
            } catch(e) {
                console.log(`[WEBHOOK] Failed to parse JSON: ${e.message}`);
            }
        } else {
            // Form-urlencoded format (most likely for Pay0)
            const parsedBody = new URLSearchParams(rawBody);
            for (const [key, value] of parsedBody) {
                body[key] = value;
            }
        }
        
        console.log(`[WEBHOOK] Parsed Body:`, JSON.stringify(body, null, 2));
        
        // Extract webhook data - try multiple possible field names
        const order_id = body.order_id || body.orderId || body.orderid || body.merchant_order_id || body.merchantOrderId;
        const status = body.status || body.txnStatus || body.payment_status || body.paymentStatus;
        const transaction_id = body.transaction_id || body.txnId || body.transactionId || body.utr;
        const amount = body.amount || body.paid_amount || body.total_amount;
        
        console.log(`[WEBHOOK] Extracted - Order: ${order_id}, Status: ${status}, TXN: ${transaction_id}, Amount: ${amount}`);
        
        // Log to file
        const logEntry = `${new Date().toISOString()} | ${order_id} | ${status} | ${transaction_id} | ${amount}\n`;
        fs.appendFileSync('pay0_webhook.log', logEntry);
        
        // Check if payment is successful
        const isSuccess = (status === 'success' || status === 'SUCCESS' || status === 'COMPLETED' || status === 'Success' || status === 'CAPTURED');
        const isFailed = (status === 'failed' || status === 'FAILED' || status === 'Failed' || status === 'DECLINED');
        
        if (isSuccess) {
            console.log(`[WEBHOOK] ✅ Payment SUCCESS for order ${order_id}`);
            // Update order in your system
            // You could also write to a success file or update Firebase
            const successLog = `${new Date().toISOString()} | SUCCESS | ${order_id} | ${transaction_id} | ${amount}\n`;
            fs.appendFileSync('payment_success.log', successLog);
        } else if (isFailed) {
            console.log(`[WEBHOOK] ❌ Payment FAILED for order ${order_id}`);
        } else {
            console.log(`[WEBHOOK] ⚠️ Unknown status: ${status} for order ${order_id}`);
        }
        
        // Respond with JSON as pay0.shop expects
        res.status(200).json({ 
            status: 'success', 
            message: 'Webhook received successfully',
            order_id: order_id
        });
    });
    
    req.on('error', (err) => {
        console.error(`[WEBHOOK] Request error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    });
});

// ========== WEBHOOK ENDPOINT - UPDATED ==========
app.post('/webhook', (req, res) => {
    // Log the raw request for debugging
    console.log(`========== WEBHOOK RECEIVED ==========`);
    console.log(`[WEBHOOK] Headers:`, req.headers);
    console.log(`[WEBHOOK] Content-Type:`, req.headers['content-type']);
    console.log(`[WEBHOOK] Raw Body (if available):`, req.rawBody ? req.rawBody.toString() : 'N/A');
    
    // Handle both JSON and form-urlencoded formats
    const body = req.body;
    console.log(`[WEBHOOK] Parsed Body:`, JSON.stringify(body, null, 2));
    
    // Extract common field names (many gateways use different naming conventions)
    const webhookData = {
        status: body.status || body.Status || body.payment_status || body.tx_status,
        order_id: body.order_id || body.orderId || body.orderid || body.orderID || body.merchant_order_id,
        transaction_id: body.transaction_id || body.transactionId || body.txnid || body.txn_id || body.transaction,
        amount: body.amount || body.total_amount || body.paid_amount,
        remark1: body.remark1 || body.remarks,
        remark2: body.remark2,
        signature: body.signature || body.hash || body.checksum,
        raw: body
    };
    
    console.log(`[WEBHOOK] Extracted Data:`);
    console.log(`  - Order ID: ${webhookData.order_id}`);
    console.log(`  - Status: ${webhookData.status}`);
    console.log(`  - Transaction ID: ${webhookData.transaction_id}`);
    console.log(`  - Amount: ${webhookData.amount}`);
    console.log(`======================================`);
    
    // Log to file for persistence
    const logEntry = {
        timestamp: new Date().toISOString(),
        ...webhookData
    };
    logWebhook(logEntry);
    
    // Process based on status
    if (webhookData.status === 'success' || webhookData.status === 'Success' || webhookData.status === 'COMPLETED') {
        console.log(`[WEBHOOK] ✅ Payment SUCCESS for order ${webhookData.order_id}`);
        // TODO: Update your database, grant access, send confirmation email, etc.
    } else if (webhookData.status === 'failed' || webhookData.status === 'Failed' || webhookData.status === 'FAILED') {
        console.log(`[WEBHOOK] ❌ Payment FAILED for order ${webhookData.order_id}`);
        // TODO: Handle failed payment
    } else {
        console.log(`[WEBHOOK] ⚠️ Unknown status: ${webhookData.status} for order ${webhookData.order_id}`);
    }
    
    // Always respond with 200 OK - important to acknowledge receipt
    res.status(200).send('Webhook received successfully');
});

// ========== WEBHOOK TEST ENDPOINT (for debugging) ==========
app.post('/webhook-test', (req, res) => {
    console.log(`========== TEST WEBHOOK ==========`);
    console.log(`Test webhook received:`);
    console.log(JSON.stringify(req.body, null, 2));
    console.log(`==================================`);
    res.status(200).json({ 
        status: 'success', 
        message: 'Test webhook received. Your webhook endpoint is working correctly!' 
    });
});

// ========== WEBHOOK LOGS ENDPOINT (view recent webhooks) ==========
app.get('/webhook-logs', (req, res) => {
    try {
        if (fs.existsSync(WEBHOOK_LOG_FILE)) {
            const logs = fs.readFileSync(WEBHOOK_LOG_FILE, 'utf8');
            const logLines = logs.trim().split('\n').slice(-50); // Last 50 entries
            res.json({ 
                status: 'success', 
                count: logLines.length,
                logs: logLines 
            });
        } else {
            res.json({ status: 'success', count: 0, logs: [] });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ========== PAYMENT CALLBACK PAGE ==========
app.get('/payment-callback', (req, res) => {
    const { status, order_id, transaction_id } = req.query;
    console.log(`[CALLBACK] Payment callback: ${status} for order ${order_id}`);
    res.redirect(`/?payment_status=${status || 'pending'}&order_id=${order_id}&transaction_id=${transaction_id}`);
});

// ========== HEALTH CHECK ENDPOINT ==========
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ========== SERVE MAIN PAGE ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== START SERVER ==========
app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Pay0 Webhook: POST /wc-api/pay0-payment`);
    console.log(`📡 Webhook URL: POST /webhook`);
    console.log(`🧪 Test webhook: POST /webhook-test`);
    console.log(`📋 View logs: GET /webhook-logs`);
    console.log(`❤️ Health check: GET /health`);
    console.log(`========================================`);
});
