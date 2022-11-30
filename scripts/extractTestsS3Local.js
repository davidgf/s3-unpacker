const unzipper = require('unzipper')
const yauzl = require('yauzl')
const { argv } = require('yargs')
const { promisify } = require('util')
const { S3 } = require('aws-sdk')

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

const unzipperStreamForAwait = async (zipFileKey) => {
  console.log('unzipperStreamForAwait: grabbing file', zipFileKey)
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

const unzipperLocalFile = async (zipFileKey) => {
  console.log('unzipperLocalFile: grabbing file')
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

const unzipperStream = async (zipFileKey) => {
  console.log(`unzipperStream: grabbing file ${zipFileKey}`)
  const directory = await unzipper.Open.s3(s3Client, { Bucket: inputBucketName, Key: zipFileKey })
  const outputFolder = generateUnpackBasePath(zipFileKey)
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
const yauzlLocalFile = zipFileKey => getS3Object(zipFileKey)
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

const strategies = {
  unzipperStreamForAwait,
  unzipperLocalFile,
  unzipperStream,
  yauzlLocalFile
}

async function main (strategy, fileKey) {
  try {
    displayMemoryUsage()
    await strategies[strategy](fileKey)
    displayMemoryUsage()
  } catch (err) {
    displayMemoryUsage()
    console.log(`Error extracting zip file ${fileKey}:`, err)
  }
}

const strategy = argv.s || 'unzs'
const fileKey = argv.f || 'incoming/test.zip'

main(strategy, fileKey)
