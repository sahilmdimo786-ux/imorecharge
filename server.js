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

// ========== CLEAN URL FUNCTION ==========
function cleanPaymentUrl(url) {
    if (!url) return url;
    
    let cleaned = url;
    
    // Replace escaped slashes
    cleaned = cleaned.replace(/\\\//g, '/');
    
    // Remove leading/trailing single quotes
    cleaned = cleaned.replace(/^'|'$/g, '');
    
    // Remove leading/trailing double quotes
    cleaned = cleaned.replace(/^"|"$/g, '');
    
    // Remove any trailing apostrophe
    cleaned = cleaned.replace(/'$/, '');
    
    // Remove any trailing quote
    cleaned = cleaned.replace(/["']$/, '');
    
    // Remove any whitespace
    cleaned = cleaned.trim();
    
    // Remove any URL-encoded quotes
    cleaned = cleaned.replace(/%27/g, '');
    cleaned = cleaned.replace(/%22/g, '');
    
    return cleaned;
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
        console.log(`[ORDER] Raw Pay0 response:`, JSON.stringify(data));
        
        // AGGRESSIVE CLEAN: Clean the payment_url by removing any quotes or backslashes
        if (data.result && data.result.payment_url) {
            const originalUrl = data.result.payment_url;
            const cleanedUrl = cleanPaymentUrl(originalUrl);
            data.result.payment_url = cleanedUrl;
            
            console.log(`[ORDER] Original payment_url: ${originalUrl}`);
            console.log(`[ORDER] Cleaned payment_url: ${cleanedUrl}`);
            
            // Verify the cleaned URL is valid
            if (cleanedUrl.startsWith('https://pay0.shop/')) {
                console.log(`[ORDER] ✅ URL cleaned successfully`);
            } else {
                console.log(`[ORDER] ⚠️ URL may still have issues: ${cleanedUrl}`);
            }
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
        
        // If status shows success, log it prominently
        if (data.status === true && data.result?.txnStatus === 'SUCCESS') {
            console.log(`[STATUS] ✅ ORDER ${order_id} IS SUCCESSFUL!`);
            // Write to a success log file
            fs.appendFileSync('payment_success.log', `${new Date().toISOString()} | ${order_id} | SUCCESS\n`);
        }
        
        res.json(data);
    } catch (error) {
        console.error('[STATUS] Error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== OFFICIAL PAY0 WEBHOOK ENDPOINT ==========
app.post('/wc-api/pay0-payment', (req, res) => {
    console.log(`========== PAY0 OFFICIAL WEBHOOK RECEIVED ==========`);
    console.log(`[WEBHOOK] Headers:`, req.headers);
    console.log(`[WEBHOOK] Body:`, JSON.stringify(req.body, null, 2));
    
    const body = req.body;
    const order_id = body.order_id || body.orderId || body.orderid || body.merchant_order_id;
    const status = body.status || body.txnStatus || body.payment_status;
    const transaction_id = body.transaction_id || body.txnId || body.transactionId;
    const amount = body.amount || body.paid_amount;
    
    console.log(`[WEBHOOK] Order: ${order_id}, Status: ${status}, TXN: ${transaction_id}, Amount: ${amount}`);
    
    const logEntry = `${new Date().toISOString()} | ${order_id} | ${status} | ${transaction_id} | ${amount}\n`;
    fs.appendFileSync('pay0_webhook.log', logEntry);
    
    if (status === 'success' || status === 'SUCCESS' || status === 'COMPLETED' || status === 'Success') {
        console.log(`[WEBHOOK] ✅ Payment SUCCESS for order ${order_id}`);
        fs.appendFileSync('payment_success.log', `${new Date().toISOString()} | ${order_id} | WEBHOOK_SUCCESS\n`);
    } else if (status === 'failed' || status === 'FAILED' || status === 'Failed') {
        console.log(`[WEBHOOK] ❌ Payment FAILED for order ${order_id}`);
    } else {
        console.log(`[WEBHOOK] ⚠️ Unknown status: ${status} for order ${order_id}`);
    }
    
    res.status(200).json({ 
        status: 'success', 
        message: 'Webhook received successfully',
        order_id: order_id
    });
});

// ========== WEBHOOK ENDPOINT - UPDATED ==========
app.post('/webhook', (req, res) => {
    console.log(`========== WEBHOOK RECEIVED ==========`);
    console.log(`[WEBHOOK] Headers:`, req.headers);
    console.log(`[WEBHOOK] Content-Type:`, req.headers['content-type']);
    console.log(`[WEBHOOK] Raw Body (if available):`, req.rawBody ? req.rawBody.toString() : 'N/A');
    
    const body = req.body;
    console.log(`[WEBHOOK] Parsed Body:`, JSON.stringify(body, null, 2));
    
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
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        ...webhookData
    };
    logWebhook(logEntry);
    
    if (webhookData.status === 'success' || webhookData.status === 'Success' || webhookData.status === 'COMPLETED') {
        console.log(`[WEBHOOK] ✅ Payment SUCCESS for order ${webhookData.order_id}`);
    } else if (webhookData.status === 'failed' || webhookData.status === 'Failed' || webhookData.status === 'FAILED') {
        console.log(`[WEBHOOK] ❌ Payment FAILED for order ${webhookData.order_id}`);
    } else {
        console.log(`[WEBHOOK] ⚠️ Unknown status: ${webhookData.status} for order ${webhookData.order_id}`);
    }
    
    res.status(200).send('Webhook received successfully');
});

// ========== WEBHOOK TEST ENDPOINT ==========
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

// ========== WEBHOOK LOGS ENDPOINT ==========
app.get('/webhook-logs', (req, res) => {
    try {
        if (fs.existsSync(WEBHOOK_LOG_FILE)) {
            const logs = fs.readFileSync(WEBHOOK_LOG_FILE, 'utf8');
            const logLines = logs.trim().split('\n').slice(-50);
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
