const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (your HTML, CSS, JS)
app.use(express.static('.'));

// Pay0 API Configuration
const PAY0_API_URL = 'https://pay0.shop/api/create-order';
const PAY0_CHECK_ORDER_URL = 'https://pay0.shop/api/check-order-status';
const PAY0_API_KEY = 'f112200bfde077dca7e44302f88c5423';

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Create Order endpoint
app.post('/api/create-order', async (req, res) => {
    try {
        const { customer_mobile, amount, order_id, redirect_url, customer_name } = req.body;
        
        // Validate required fields
        if (!customer_mobile || !amount || !order_id) {
            return res.status(400).json({ 
                status: false, 
                message: 'Missing required fields: customer_mobile, amount, order_id' 
            });
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
        
        console.log(`Creating order: ${order_id} for amount ₹${amount}`);
        
        const response = await fetch(PAY0_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        const data = await response.json();
        console.log(`Pay0 response for ${order_id}:`, data);
        
        res.json(data);
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ 
            status: false, 
            message: 'Internal server error: ' + error.message 
        });
    }
});

// Check Order Status endpoint
app.post('/api/check-order-status', async (req, res) => {
    try {
        const { order_id } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ 
                status: false, 
                message: 'Missing order_id' 
            });
        }
        
        const formData = new FormData();
        formData.append('user_token', PAY0_API_KEY);
        formData.append('order_id', order_id);
        
        const response = await fetch(PAY0_CHECK_ORDER_URL, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Check order status error:', error);
        res.status(500).json({ 
            status: false, 
            message: 'Internal server error' 
        });
    }
});

// Webhook endpoint for Pay0 to send payment confirmation
app.post('/webhook', (req, res) => {
    const { status, order_id, remark1, transaction_id } = req.body;
    
    console.log(`Webhook received - Order: ${order_id}, Status: ${status}, TXN: ${transaction_id}`);
    
    if (status === 'SUCCESS' || status === 'COMPLETED') {
        // Here you can update your database or Firebase
        // For now, just log it
        console.log(`✅ Payment successful for order: ${order_id}`);
        // You can also store this in a file or database
        const fs = require('fs');
        const logEntry = `${new Date().toISOString()} | SUCCESS | ${order_id} | ${transaction_id}\n`;
        fs.appendFileSync('payments.log', logEntry);
        
        res.send('Webhook received successfully');
    } else if (status === 'FAILED') {
        console.log(`❌ Payment failed for order: ${order_id}`);
        res.send('Webhook received - payment failed');
    } else {
        res.status(400).send(`Invalid status: ${status}`);
    }
});

// Payment callback page (after user pays)
app.get('/payment-callback', (req, res) => {
    const { status, order_id, transaction_id } = req.query;
    
    // Serve HTML that will redirect to WhatsApp
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payment Status</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background: linear-gradient(145deg, #f0f4fe 0%, #e8edf8 100%);
                    margin: 0;
                }
                .container {
                    text-align: center;
                    padding: 2rem;
                }
                .success { color: green; }
                .failed { color: red; }
                .loader {
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #7b2d8e;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </div>
        </style>
    </head>
    <body>
        <div class="container">
            <div class="loader"></div>
            <h2 id="message">Processing your payment...</h2>
        </div>
        <script>
            const status = "${status || 'pending'}";
            const orderId = "${order_id || ''}";
            const txnId = "${transaction_id || ''}";
            
            if (status === 'success' || status === 'SUCCESS') {
                document.getElementById('message').innerHTML = '✅ Payment successful!<br>Redirecting to WhatsApp...';
                // Redirect to WhatsApp after 2 seconds
                setTimeout(() => {
                    window.location.href = '/?payment_success=' + orderId;
                }, 2000);
            } else if (status === 'failed' || status === 'FAILED') {
                document.getElementById('message').innerHTML = '❌ Payment failed. Please try again.<br>Redirecting back...';
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            } else {
                // Check order status via API
                fetch('/api/check-order-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_id: orderId })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'COMPLETED') {
                        document.getElementById('message').innerHTML = '✅ Payment successful!<br>Redirecting to WhatsApp...';
                        setTimeout(() => window.location.href = '/?payment_success=' + orderId, 2000);
                    } else {
                        document.getElementById('message').innerHTML = '⚠️ Payment status unknown.<br>Redirecting back...';
                        setTimeout(() => window.location.href = '/', 3000);
                    }
                })
                .catch(() => {
                    document.getElementById('message').innerHTML = 'Redirecting back...';
                    setTimeout(() => window.location.href = '/', 2000);
                });
            }
        </script>
    </body>
    </html>
    `);
});

// Serve main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 API endpoints:`);
    console.log(`   POST /api/create-order - Create payment order`);
    console.log(`   POST /api/check-order-status - Check order status`);
    console.log(`   POST /webhook - Webhook for Pay0 callbacks`);
    console.log(`   GET /payment-callback - Payment return page`);
});