const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

const PAY0_API_URL = 'https://pay0.shop/api/create-order';
const PAY0_CHECK_ORDER_URL = 'https://pay0.shop/api/check-order-status';
const PAY0_API_KEY = 'f112200bfde077dca7e44302f88c5423';

// ========== CREATE ORDER API ==========
app.post('/api/create-order', async (req, res) => {
    try {
        const { customer_mobile, amount, order_id, redirect_url, customer_name } = req.body;
        
        if (!customer_mobile || !amount || !order_id) {
            return res.status(400).json({ status: false, message: 'Missing required fields' });
        }
        
        const formData = new URLSearchParams();
        formData.append('customer_mobile', customer_mobile);
        formData.append('customer_name', customer_name || 'Customer');
        formData.append('user_token', PAY0_API_KEY);
        formData.append('amount', amount.toString());
        formData.append('order_id', order_id);
        formData.append('redirect_url', redirect_url || `${req.protocol}://${req.get('host')}/payment-callback`);
        formData.append('remark1', 'IMO Recharge');
        formData.append('remark2', order_id);
        
        console.log(`Creating order: ${order_id} for ₹${amount}`);
        
        const response = await fetch(PAY0_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        
        const data = await response.json();
        console.log(`Pay0 response:`, data);
        res.json(data);
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== CHECK ORDER STATUS API (FOR POLLING) ==========
app.post('/api/check-order-status', async (req, res) => {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ status: false, message: 'Missing order_id' });
        }
        
        const formData = new URLSearchParams();
        formData.append('user_token', PAY0_API_KEY);
        formData.append('order_id', order_id);
        
        const response = await fetch(PAY0_CHECK_ORDER_URL, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        console.log(`Status check for ${order_id}:`, data);
        res.json(data);
    } catch (error) {
        console.error('Check order status error:', error);
        res.status(500).json({ status: false, message: error.message });
    }
});

// ========== WEBHOOK ENDPOINT (FOR FUTURE USE) ==========
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
