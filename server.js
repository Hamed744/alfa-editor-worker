const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const HF_WORKERS = [
    'https://ezmary-alfa-editor-worker-1.hf.space',
    'https://ezmary-alfa-editor-worker-2.hf.space',
    'https://ezmary-alfa-editor-worker-3.hf.space'
];

let nextWorkerIndex = 0;
const getNextWorker = () => {
    const workerUrl = HF_WORKERS[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % HF_WORKERS.length;
    console.log(`[Load Balancer] Using worker: ${workerUrl}`);
    return workerUrl;
};

app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/edit', upload.single('image'), async (req, res) => {
    if (!req.file || !req.body.prompt) {
        return res.status(400).json({ error: 'Image and prompt are required' });
    }

    const workerUrl = getNextWorker();
    const apiUrl = `${workerUrl}/edit`;
    
    console.log(`[API Proxy] Forwarding to: ${apiUrl}`);

    try {
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });
        formData.append('prompt', req.body.prompt);

        const hfResponse = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
            timeout: 180000
        });

        const contentType = hfResponse.headers.get('content-type');
        
        if (contentType && contentType.includes('image/png')) {
            const imageBuffer = await hfResponse.buffer();
            res.setHeader('Content-Type', 'image/png');
            return res.send(imageBuffer);
        }
        
        if (contentType && contentType.includes('application/json')) {
            const errorBody = await hfResponse.json();
            const errorMsg = errorBody.error || errorBody.detail || 'Unknown error from worker';
            throw new Error(errorMsg);
        }
        
        const textResponse = await hfResponse.text();
        throw new Error(textResponse || 'Unknown error from worker');

    } catch (error) {
        console.error('[Proxy Error]', error.message);
        res.status(502).json({ error: `Processing error: ${error.message}` });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Alfa Image Proxy Server running on port ${PORT}`);
    console.log(`Load balancing across: ${HF_WORKERS.join(', ')}`);
});
