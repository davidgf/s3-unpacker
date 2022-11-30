const { S3 } = require('aws-sdk')
const unzipper = require('unzipper')

const localConfig = {
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  endpoint: 'http://172.19.0.1:9000',
  s3ForcePathStyle: true,
  signatureVersion: 'v4'
}
const s3Config = process.env.AWS_SAM_LOCAL ? localConfig : {}
const s3Client = new S3(s3Config)

const outputBucketName = process.env.OUTPUT_BUCKET

const generateUnpackBasePath = key => key.replace(/\.zip$/, '/')
const streamAllFiles = async (inputBucketName, zipFileKey, outputBucketName, outputFolder) => {
  const zip = s3Client.getObject({
    Bucket: inputBucketName,
    Key: zipFileKey
  })
    .createReadStream()
    .pipe(unzipper.Parse({ forceStream: true }))
    .on('error', function (err) {
      console.error(err)
    })

  const promises = []

  for await (const entry of zip) {
    try {
      const type = entry.type
      if (type !== 'File') {
        promises.push(entry.autodrain().promise())
      } else {
        const uploadParams = {
          Bucket: outputBucketName,
          Key: `${outputFolder}${entry.path}`,
          Body: entry
        }
        promises.push(
          s3Client.upload(uploadParams).promise()
            .catch(err => console.log('Failed to upload', entry.path, err.message))
        )
      }
    } catch (err) {
      console.log('Failed to upload', entry.path, err.message)
    }
  }

  return Promise.all(promises)
}

module.exports.handler = async (event) => {
  const s3Event = event.Records[0].s3
  const incomingBucketName = s3Event.bucket.name
  if (incomingBucketName === outputBucketName) throw new Error('The incoming and target buckets must be different.')
  const zipFileKey = s3Event.object.key
  const originBucketName = s3Event.bucket.name
  const outputFolder = generateUnpackBasePath(zipFileKey)
  await streamAllFiles(originBucketName, zipFileKey, outputBucketName, outputFolder)
  return {
    originalFileKey: zipFileKey,
    outputFolder
  }
}
