// Required Node.js modules to handle HTTP requests and access file system operations.
const axios = require('axios'); // For making HTTP requests
const fs = require('fs'); // For interacting with the file system

// Name / path of the file to be uploaded
const FILE_NAME = '305-536x354.jpg';

// Read the entire file into memory
const file = fs.readFileSync(`./${FILE_NAME}`);

// Get file metadata (e.g., file size)
const stats = fs.statSync(`./${FILE_NAME}`);

// Define chunk size (5MB) and calculate the number of chunks required for upload
const chunkSize = 5 * 1024 * 1024; // 5MB
const numChunks = Math.ceil(stats.size / chunkSize); // Total number of chunks

// Define API endpoints for file-sharing and authentication
const cloudServerAPI = 'https://api.gaimin.cloud/api/v0/file-sharing';
const authServerAPI = 'https://api.auth.gaimin.io/api';

// Authentication Tokens:
// SSO Token (obtained from UI, should be replaced with a valid one)
const gaiminSSOtoken = 'Bearer eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJzdWIiOiI3MjYiLCJpc3MiOiJodHRwczovL2FwaS5xYS5hdXRoLmdhaW1pbi5pbyIsImlhdCI6MTc0MjQ4MjYzMywiZXhwIjoxNzQyNDg2MjMzfQ.Pm_Xztk-orDwyv0rL4tOuVFVHq7QlolBP17MmbQ2Jmie4GoUXhJxDWRSlV13MoVKuaePfatiLRpyZiAkRzJH-A';
// Static secret key (can be retrieved via API or UI)
let gaiminSecretKey = '$2a$10$Qv3BQzvt5o61mFSUfJahMuJMp.0wkgTMM4oQ5z80ip4ua.9iuw0cy';

// Step 1: Get the secret key using SSO token (scoped for file-sharing)
async function getSecretKey() {
    const response = await axios.post(authServerAPI + '/auth/secret-key', {
        "scopes": ["SCOPE_FS"]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': gaiminSSOtoken,
        },
    });
    gaiminSecretKey = response.data['data']; // Store the retrieved secret key
}

// Step 2: Get API token using the retrieved secret key
async function getApiToken() {
    const response = await axios.post(authServerAPI + '/auth/api-token', {
        "secretKey": gaiminSecretKey
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': gaiminSecretKey,
        },
    });
    jsonAndAuthHeader.Authorization = response.data['data']; // Store API token
}

// Headers to be used with authenticated requests
const jsonAndAuthHeader = {
    'Authorization': '',
    'Content-Type': "application/json",
    'accept': '*/*'
};

// Step 3: Get pre-signed URLs for each chunk upload
async function getPreSignedUrl() {
    const url = cloudServerAPI + '/files/upload/start';

    const data = {
        fileName: `${FILE_NAME}`,
        "numberOfParts": numChunks,
        unlimitedDistribution: false
    };

    // Request pre-signed URLs from the server
    const request = await axios.post(url, JSON.stringify(data), {
        headers: jsonAndAuthHeader
    });

    return await request.data;
}

// Step 4: Upload each chunk of the file to its corresponding pre-signed URL
async function uploadLargeFile({ fileName, uploadUrls: presignedUrls, uuid }) {
    const etags = []; // Store ETags for each uploaded chunk

    for (let partNumber = 0; partNumber < numChunks; partNumber++) {
        const start = partNumber * chunkSize;
        const end = Math.min(start + chunkSize, stats.size);
        const presignedUrl = presignedUrls[partNumber];

        try {
            // Upload a single chunk and store its ETag
            const etag = await uploadChunk(file, presignedUrl, partNumber + 1, start, end);
            etags.push({ PartNumber: partNumber + 1, ETag: etag });
        } catch (error) {
            console.error(`Error uploading part ${partNumber + 1}`, error);
            return;
        }
    }

    return [etags, uuid];
}

// Helper: Upload a single chunk to a given pre-signed URL
async function uploadChunk(file, presignedUrl, partNumber, start, end) {
    const chunk = file.slice(start, end);
    const response = await axios.put(presignedUrl, chunk, {
        headers: {
            'Content-Type': 'application/octet-stream',
        },
        timeout: 99999999, // Large timeout for large file uploads
    });

    // Return the ETag (used later to finalize the upload)
    return response.headers['etag'].slice(1, -1);
}

// Step 5: Notify the server that upload is complete and provide all ETags
async function markFileUploadAsCompleted(filename, etags, uuid) {
    const url = cloudServerAPI + '/files/upload/complete';

    // Format ETags as required by the API
    const etagsData = etags.map((el) => ({
        partNumber: el.PartNumber,
        eTag: el.ETag
    }));

    const data = {
        "fileName": filename,
        "parts": etagsData,
        uuid
    };

    // Notify the server that the upload is complete
    const request = await axios.post(url, JSON.stringify(data), {
        headers: jsonAndAuthHeader
    });

    return request.data;
}

// Main function: Initializes upload process
function initUpload() {
    getPreSignedUrl().then(({ data }) => {
        console.log('Pre-signed URLs received:', data);
        uploadLargeFile(data).then((uploadFileData) => {
            const [etags, uuid] = uploadFileData;

            markFileUploadAsCompleted(data.fileName, etags, uuid).then((completeData) => {
                console.log('Upload completed:', completeData);
                // Server response contains a downloadable link:
                // {
                //     data: {
                //         uuid: '3b5b08a8-16e2-425f-9b8f-3db53cbef673',
                //         name: 'index.js',
                //         sizeInBytes: 5773,
                //         url: 'https://api.gaimin.cloud/api/file-sharing/files/3b5b08a8-16e2-425f-9b8f-3db53cbef673',
                //         status: 'SHARING'
                //     },
                //     success: true
                // }
            });
        });
    });
}

// Entry point: Authenticate and start the upload process
async function init() {
    if (gaiminSecretKey) {
        await getApiToken(); // Reuse existing secret key
        await initUpload();
    } else {
        await getSecretKey(); // Fetch secret key first
        await getApiToken();  // Get API token
        await initUpload();   // Then start the upload process
    }
}

// Run the script
init().then();
