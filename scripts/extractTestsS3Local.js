const unzipper = require('unzipper')
const yauzl = require('yauzl')
const { argv } = require('yargs')
const pMap = require('p-map')
const { promisify } = require('util')
const { S3 } = require('aws-sdk')
const BPromise = require('bluebird')

const s3Client = new S3({
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  endpoint: 'http://127.0.0.1:9000',
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
})

const inputBucketName = 'input'
const outputBucketName = 'output'

const generateUnpackBasePath = key => key.replace(/^(incoming)\//, 'unpacked/').replace(/\.zip$/, '/')
const getS3Object = (objectKey, bucket = inputBucketName) => s3Client
  .getObject({
    Bucket: bucket,
    Key: objectKey
  }).promise()

const unz = async (zipFileKey) => {
  console.log('UNZ: grabbing file')
  const zip = s3Client.getObject({
    Bucket: inputBucketName,
    Key: zipFileKey
  })
    .createReadStream()
    .pipe(unzipper.Parse({ forceStream: true }))

  const promises = []
  const outputFolder = generateUnpackBasePath(zipFileKey)
  for await (const entry of zip) {
    const type = entry.type
    if (type !== 'File') {
      promises.push(entry.autodrain().promise())
    } else {
      const uploadParams = {
        Bucket: outputBucketName,
        Key: `${outputFolder}${entry.path}`,
        Body: entry
      }
      promises.push(s3Client.upload(uploadParams).promise())
    }
  }
  return Promise.all(promises)
}

const unzb = async (zipFileKey) => {
  console.log('UNZB: grabbing file')
  const zip = await getS3Object(zipFileKey)
  const outputFolder = generateUnpackBasePath(zipFileKey)
  const directory = await unzipper.Open.buffer(zip.Body)
  const promises = directory.files.map(entry => {
    const type = entry.type
    if (type !== 'File') return Promise.resolve()
    const uploadParams = {
      Bucket: outputBucketName,
      Key: `${outputFolder}${entry.path}`,
      Body: entry.stream()
    }
    return s3Client.upload(
      uploadParams,
      {
        partSize: process.env.UPLOAD_PART_SIZE || 10 * 1024 * 1024,
        queueSize: process.env.UPLOAD_QUEUE_SIZE || 10
      }
    )
      .promise()
  })
  return Promise.all(promises)
}
const unzs = async (zipFileKey) => {
  console.log('UNZS: grabbing file')
  const directory = await unzipper.Open.s3(s3Client, { Bucket: inputBucketName, Key: zipFileKey })
  const outputFolder = generateUnpackBasePath(zipFileKey)
  // return pMap(
  //   directory.files,
  // entry => {
  const promises = directory.files.map(entry => {
    const type = entry.type
    if (type !== 'File') return Promise.resolve(true)
    const uploadParams = {
      Bucket: outputBucketName,
      Key: `${outputFolder}${entry.path}`,
      Body: entry.stream()
    }
    return s3Client.upload(uploadParams)
      .promise()
      .catch(err => console.log('Failed to upload', entry.path, err.message))
  })
  // },
  // { concurrency: 1 }
  // )
  return Promise.all(promises)
}

const yauzlFromBuffer = promisify(yauzl.fromBuffer)
const yauzlUploadToS3 = (zipFile, outputFolder, outputBucket = outputBucketName) => {
  return new Promise((resolve, reject) => {
    const promises = []
    zipFile.readEntry()
    zipFile.on('entry', function (entry) {
      if (/\/$/.test(entry.fileName)) return zipFile.readEntry()
      zipFile.openReadStream(entry, function (err, readStream) {
        if (err) throw err
        readStream.on('end', () => zipFile.readEntry())
        const uploadParams = {
          Bucket: outputBucket,
          Key: `${outputFolder}${entry.fileName}`,
          Body: readStream
        }
        promises.push(s3Client.upload(uploadParams).promise())
      })
    })
    zipFile.on('end', () => resolve(promises))
    zipFile.on('error', err => reject(err))
  })
    .then(uploadPromises => Promise.all(uploadPromises))
}
const yau = zipFileKey => getS3Object(zipFileKey)
  .then(zip => yauzlFromBuffer(zip.Body, { lazyEntries: true }))
  .then(zipFile => yauzlUploadToS3(
    zipFile,
    generateUnpackBasePath(zipFileKey)
  ))

function displayMemoryUsage () {
  const formatMemoryUsage = (data) => `${Math.round(data / 1024 / 1024 * 100) / 100} MB`
  const memoryData = process.memoryUsage()
  console.log('Total memory allocated for the process execution: ', formatMemoryUsage(memoryData.rss))
}

const unzs2 = async (zipFileKey) => {
  console.log('UNZS2: grabbing file')
  const directory = await unzipper.Open.s3(s3Client, { Bucket: inputBucketName, Key: zipFileKey })
  const outputFolder = generateUnpackBasePath(zipFileKey)

  return BPromise.map(directory.files, entry => {
    return new Promise((resolve, reject) => {
      const type = entry.type
      if (type !== 'File') return Promise.resolve(true)
      const body = entry.stream()

      // body.on('data', (chunk) => {
      //   console.log(`Received ${chunk.length} bytes of data.`);
      // })

      // execSync(`mkdir -p ./tmp/${composedPath}`)

      // r = body.pipe(fs.createWriteStream(`./tmp/${entry.path}`))
      //   .on('data', console.log)
      //   .on('error', resolve)
      //   .on('finish', resolve)

      const uploadParams = {
        Bucket: outputBucketName,
        Key: `${outputFolder}${entry.path}`,
        Body: body
      }

      s3Client.upload(uploadParams, function (err, data) {
        if (err) resolve()
        console.log('Uploaded the file at', data.Location)
        resolve()
      })
    })
  }, { concurrency: 10 })
}

const strategies = {
  unz,
  unzb,
  unzs,
  yau,
  unzs2
}

async function main (strategy, fileKey) {
  try {
    displayMemoryUsage()
    await strategies[strategy](fileKey)
    displayMemoryUsage()
  } catch (err) {
    displayMemoryUsage()
    console.log('Error extracting zip file:', err)
  }
}

const strategy = argv.s || 'unzs'
const fileKey = argv.f || 'lesmiserables.zip'

main(strategy, fileKey)
