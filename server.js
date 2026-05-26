const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const PAY0_API_URL = 'https://pay0.shop/api/create-order';
const PAY0_CHECK_ORDER_URL = 'https://pay0.shop/api/check-order-status';
const PAY0_API_KEY = 'f112200bfde077dca7e44302f88c5423';

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
            redirect_url: redirect_url || `${req.protocol}://${req.get('host')}/payment-callback`,
            remark1: 'IMO Recharge',
            remark2: order_id
        };
        
        console.log(`Creating order: ${order_id} for ₹${amount}`);
        
        const data = await makeRequest(PAY0_API_URL, postData);
        console.log(`Pay0 response:`, data);
        res.json(data);
    } catch (error) {
        console.error('Create order error:', error);
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
        
        console.log(`Checking status for order: ${order_id}`);
        
        const data = await makeRequest(PAY0_CHECK_ORDER_URL, postData);
        console.log(`Status response:`, data);
        res.json(data);
    } catch (error) {
        console.error('Check order status error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== WEBHOOK ENDPOINT ==========
app.post('/webhook', (req, res) => {
    const { status, order_id, remark1, transaction_id, amount } = req.body;
    console.log(`========== WEBHOOK RECEIVED ==========`);
    console.log(`Order ID: ${order_id}`);
    console.log(`Status: ${status}`);
    console.log(`Transaction ID: ${transaction_id}`);
    console.log(`======================================`);
    const fs = require('fs');
    const logEntry = `${new Date().toISOString()} | ${status} | ${order_id} | ${transaction_id}\n`;
    fs.appendFileSync('payments.log', logEntry);
    res.send('Webhook received');
});

// ========== PAYMENT CALLBACK PAGE ==========
app.get('/payment-callback', (req, res) => {
    const { status, order_id, transaction_id } = req.query;
    res.redirect(`/?payment_status=${status || 'pending'}&order_id=${order_id}&transaction_id=${transaction_id}`);
});

// ========== SERVE MAIN PAGE ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Check order status API: POST /api/check-order-status`);
});
