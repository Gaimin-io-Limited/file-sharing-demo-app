const axios = require('axios');
const fs = require('fs');

const FILE_NAME = '305-536x354.jpg'

const file = fs.readFileSync(`./${FILE_NAME}`);
const stats = fs.statSync(`./${FILE_NAME}`)


// from 5mb to 5gb
const chunkSize = 5 * 1024 * 1024;
const numChunks = Math.ceil(stats.size / chunkSize);

// for prod env remove '.qa'
const cloudServerAPI = 'https://api.gaimin.cloud/api/v0/file-sharing'
const authServerAPI = 'https://api.auth.gaimin.io/api'

const gaiminSSOtoken = 'Bearer eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJzdWIiOiI3MjYiLCJpc3MiOiJodHRwczovL2FwaS5xYS5hdXRoLmdhaW1pbi5pbyIsImlhdCI6MTc0MjQ4MjYzMywiZXhwIjoxNzQyNDg2MjMzfQ.Pm_Xztk-orDwyv0rL4tOuVFVHq7QlolBP17MmbQ2Jmie4GoUXhJxDWRSlV13MoVKuaePfatiLRpyZiAkRzJH-A'
let gaiminSecretKey = ''


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

async function getApiToken(){
    const response = await axios.post(authServerAPI + '/auth/api-token', {
        "secretKey": gaiminSecretKey
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': gaiminSSOtoken,
        },
    });

    jsonAndAuthHeader.Authorization = response.data['data']
}


const jsonAndAuthHeader = {
    'Authorization': '',
    'Content-Type': "application/json",
    'accept': '*/*'
}



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

//> 5GB, for smaller file it can be one single chunk
async function uploadLargeFile({fileName: fileName, uploadUrls: presignedUrls,uuid}) {
    const etags = [];

    for (let partNumber = 0; partNumber < numChunks; partNumber++) {
        const start = partNumber * chunkSize;
        const end = Math.min(start + chunkSize, stats.size);
        const presignedUrl = presignedUrls[partNumber];

        try {
            const etag = await uploadChunk(file, presignedUrl, partNumber + 1, start, end);
            etags.push({PartNumber: partNumber + 1, ETag: etag});
        } catch (error) {
            console.error(`Error uploading part ${partNumber + 1}`, error);
            return;
        }
    }

    return [etags,uuid];
}

async function uploadChunk(file, presignedUrl, partNumber, start, end) {
    const chunk = file.slice(start, end);
    const response = await axios.put(presignedUrl, chunk, {
        headers: {
            'Content-Type': 'application/octet-stream',
        },
        timeout: 99999999,
    });
    return response.headers['etag'].slice(1, -1);
}

async function markFileUploadAsCompleted(filename, etags, uuid) {
    const url = cloudServerAPI + '/files/upload/complete'

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


function initUpload(){
    getPreSignedUrl().then(({data}) => {
        console.log('data', data)
        uploadLargeFile(data).then((uploadFileData) => {
            const [etags,uuid] = uploadFileData

            markFileUploadAsCompleted(data.fileName, etags, uuid).then((completeData) => {
                console.log(completeData);
            })
        });
    })
}

async function init(){
    if (gaiminSecretKey) {
        await getApiToken()
        await initUpload();
    }
    else {
        await getSecretKey();
        await getApiToken()
        await initUpload();
    }

}

init().then();




