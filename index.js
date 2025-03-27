// Required Node.js modules to be ablr to run requsts and excess files.
const axios = require('axios');
const fs = require('fs');

// Name / path  of the file to upload
const FILE_NAME = 'index.js'

// Read the entire file into memory
const file = fs.readFileSync(`./${FILE_NAME}`);

// Get file metadata (like size)
const stats = fs.statSync(`./${FILE_NAME}`)

// Define chunk size (5MB) and calculate how many chunks the file needs
const chunkSize = 5 * 1024 * 1024;
const numChunks = Math.ceil(stats.size / chunkSize);

// Define API endpoints for cloud file upload and authentication
const cloudServerAPI = 'https://api.gaimin.cloud/api/v0/file-sharing'
const authServerAPI = 'https://api.auth.gaimin.io/api'

// Gaimin SSO token - token used mainly on UI, can be copied from Auth header
const gaiminSSOtoken = 'Bearer eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJzdWIiOiI3MjYiLCJpc3MiOiJodHRwczovL2FwaS5xYS5hdXRoLmdhaW1pbi5pbyIsImlhdCI6MTc0MjQ4MjYzMywiZXhwIjoxNzQyNDg2MjMzfQ.Pm_Xztk-orDwyv0rL4tOuVFVHq7QlolBP17MmbQ2Jmie4GoUXhJxDWRSlV13MoVKuaePfatiLRpyZiAkRzJH-A'
// Secret key - static all time active token. can be received via API or on UI. Recommended way to get API token
let gaiminSecretKey = '$2a$10$Qv3BQzvt5o61mFSUfJahMuJMp.0wkgTMM4oQ5z80ip4ua.9iuw0cy'

// Step 1: Get the secret key using SSO token (scoped for file-sharing)
async function getSecretKey(){
    const response = await axios.post(authServerAPI + '/auth/secret-key', {
        "scopes": [
            "SCOPE_FS"
        ]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': gaiminSSOtoken,
        },
    });
    gaiminSecretKey = response.data['data'];
}

// Step 2: Get API token using the retrieved secret key
// API token - short time living token used to access all file-sharing endpoints
async function getApiToken(){
    const response = await axios.post(authServerAPI + '/auth/api-token', {
        "secretKey": gaiminSecretKey
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': gaiminSecretKey,
        },
    });
    // Store the API token to use in headers for next requests
    jsonAndAuthHeader.Authorization = response.data['data']
}

// Headers to use with authenticated JSON requests
const jsonAndAuthHeader = {
    'Authorization': '',
    'Content-Type': "application/json",
    'accept': '*/*'
}


// Step 3: Request a list of pre-signed URLs for multipart upload
async function getPreSignedUrl() {
    const url = cloudServerAPI + '/files/upload/start'

    const data = {
        fileName: `${FILE_NAME}`,
        "numberOfParts": numChunks,
        unlimitedDistribution: false
    }

    const request = await axios.post(url, JSON.stringify(data), {
        headers: jsonAndAuthHeader
    })

    return await request.data
}

// Step 4: Upload each chunk of the file to its corresponding pre-signed URL
async function uploadLargeFile({fileName: fileName, uploadUrls: presignedUrls,uuid}) {
    const etags = [];

    for (let partNumber = 0; partNumber < numChunks; partNumber++) {
        const start = partNumber * chunkSize;
        const end = Math.min(start + chunkSize, stats.size);
        const presignedUrl = presignedUrls[partNumber];

        try {
            // Upload a single part of the file
            const etag = await uploadChunk(file, presignedUrl, partNumber + 1, start, end);
            etags.push({PartNumber: partNumber + 1, ETag: etag});
        } catch (error) {
            console.error(`Error uploading part ${partNumber + 1}`, error);
            return;
        }
    }

    return [etags,uuid];
}

// Helper: Upload a single chunk to a given presigned URL
async function uploadChunk(file, presignedUrl, partNumber, start, end) {
    const chunk = file.slice(start, end);
    const response = await axios.put(presignedUrl, chunk, {
        headers: {
            'Content-Type': 'application/octet-stream',
        },
        timeout: 99999999,
    });

    // Return the ETag (used later to finalize the upload)
    return response.headers['etag'].slice(1, -1);
}

// Step 5: Notify the server that upload is complete and provide all ETags
async function markFileUploadAsCompleted(filename, etags, uuid) {
    const url = cloudServerAPI + '/files/upload/complete'

    // Format the ETags into expected format
    const etagsData = etags.map((el) => {
        return {
            partNumber: el.PartNumber,
            eTag: el.ETag
        }
    })

    const data = {
        "fileName": filename,
        "parts": etagsData,
        uuid
    }

    const request = await axios.post(url, JSON.stringify(data), {
        headers: jsonAndAuthHeader
    })

    return request.data
}

// Main flow: Starts upload process by getting pre-signed URLs, uploading file parts, and finalizing
function initUpload(){
    getPreSignedUrl().then(({data}) => {
        console.log('data', data)
        uploadLargeFile(data).then((uploadFileData) => {
            const [etags,uuid] = uploadFileData

            markFileUploadAsCompleted(data.fileName, etags, uuid).then((completeData) => {
                console.log('completeData' , completeData);
                // correct response with url ( download link)
                // {
                //     data: {
                //         uuid: '3b5b08a8-16e2-425f-9b8f-3db53cbef673',
                //             createdAt: '2025-03-27T09:59:44.631372Z',
                //             updatedAt: '2025-03-27T09:59:49.710597199Z',
                //             name: 'index.js',
                //             sizeInBytes: 5773,
                //             url: 'https://api.gaimin.cloud/api/file-sharing/files/3b5b08a8-16e2-425f-9b8f-3db53cbef673',
                //             status: 'SHARING',
                //             contentId: 'QmepVLotNhk5XucQJMmgBb94rKs47fUNH1LjLXcphXSJtx'
                //     },
                //     success: true
                // }

            })
        });
    })
}

// Entry point: authenticate then run upload process
async function init(){
    if (gaiminSecretKey) {
        await getApiToken(); // reuse existing secret key
        await initUpload();
    }
    else {
        await getSecretKey();
        await getApiToken();  // fetch secret key
        await initUpload(); // then get API token
    }

}

init().then();




