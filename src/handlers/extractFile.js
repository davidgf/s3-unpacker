const { S3 } = require('aws-sdk')
const unzipper = require('unzipper')

const s3Client = new S3()
const outputBucketName = process.env.OUTPUT_BUCKET

const generateUnpackBasePath = key => key.replace(/^(incoming)\//, 'unpacked/').replace(/\.zip$/, '/')
const streamAllFiles = async (inputBucketName, zipFileKey, outputBucketName, outputFolder) => {
  // console.log('grabbing file')
  // const s3Response = await s3Client.getObject({
  //   Bucket: inputBucketName,
  //   Key: zipFileKey
  // })
  //   .promise()
  // console.log('got file')

  // const zip = await unzipper.Open.buffer(s3Response.Body)
  // console.log('zip.files: ', zip.files.length)
  // const promises = zip.files.map(entry => {
  //   const type = entry.type
  //   if (type !== 'File') return entry.autodrain().promise()
  //   const uploadParams = {
  //     Bucket: outputBucketName,
  //     Key: `${outputFolder}${entry.path}`,
  //     Body: entry.stream()
  //   }
  //   return s3Client.upload(
  //     uploadParams,
  //     {
  //       partSize: process.env.UPLOAD_PART_SIZE || 10 * 1024 * 1024,
  //       queueSize: process.env.UPLOAD_QUEUE_SIZE || 10
  //     }
  //   ).promise()
  // })

  console.log('grabbing file')
  const zip = s3Client.getObject({
    Bucket: inputBucketName,
    Key: zipFileKey
  })
    .createReadStream()
    .pipe(unzipper.Parse({ forceStream: true }))
  console.log('got file')

  const promises = []

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

  // const directory = await unzipper.Open.s3(s3Client, { Bucket: inputBucketName, Key: zipFileKey })
  // const promises = directory.files.map(entry => {
  //   const type = entry.type
  //   if (type !== 'File') return entry.autodrain().promise()
  //   const uploadParams = {
  //     Bucket: outputBucketName,
  //     Key: `${outputFolder}${entry.path}`,
  //     Body: entry.stream()
  //   }
  //   return s3Client.upload(
  //     uploadParams,
  //     {
  //       partSize: process.env.UPLOAD_PART_SIZE || 10 * 1024 * 1024,
  //       queueSize: process.env.UPLOAD_QUEUE_SIZE || 10
  //     }
  //   )
  //     .promise()
  // })

  return Promise.all(promises)
}

// const yauzl = require('yauzl')

// const streamAllFiles = async (inputBucketName, zipFileKey, outputBucketName, outputFolder) => {
//   const zip = await s3Client.getObject({
//     Bucket: inputBucketName,
//     Key: zipFileKey
//   }).promise()

//   yauzl.fromBuffer(zip.body, { }, function (err, zipFile) {
//     if (err) throw err
//     zipFile.readEntry()
//     zipFile.on('entry', function (entry) {
//       if (/\/$/.test(entry.fileName)) {
//         zipFile.readEntry()
//       } else {
//         zipFile.openReadStream(entry, function (err, readStream) {
//           if (err) throw err
//           readStream.on('end', function () {
//             zipFile.readEntry()
//           })
//           readStream.pipe(somewhere)
//         })
//       }
//     })
//   })

//   for await (const e of zip) {
//     const entry = e

//     const type = entry.type
//     if (type === 'File') {
//       const uploadParams = {
//         Bucket: outputBucketName,
//         Key: `${outputFolder}${entry.path}`,
//         Body: entry
//       }
//       promises.push(s3Client.upload(
//         uploadParams,
//         {
//           partSize: process.env.UPLOAD_PART_SIZE || 10 * 1024 * 1024,
//           queueSize: process.env.UPLOAD_QUEUE_SIZE || 10
//         }
//       )
//         .promise())
//     } else {
//       entry.autodrain()
//     }
//   }

//   return Promise.all(promises)
// }

module.exports.handler = async (event) => {
  console.log('starting')
  const zipFileKey = event.object.key
  const originBucketName = event.bucket.name
  const outputFolder = generateUnpackBasePath(zipFileKey)
  await streamAllFiles(originBucketName, zipFileKey, outputBucketName, outputFolder)
  return {
    originalFileKey: event.key,
    outputFolder
  }
}
