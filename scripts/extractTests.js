const fs = require('fs')
const unzipper = require('unzipper')
const yauzl = require('yauzl')
const AdmZip = require('adm-zip')
const { argv } = require('yargs')

const unzipperBuffer = (filePath) => {
  console.log('STRATEGY: unzipperBuffer')
  return fs.createReadStream(filePath)
    .pipe(unzipper.Parse())
    .on('entry', function (entry) {
      const type = entry.type
      if (type === 'File') {
        entry.pipe(fs.createWriteStream(`/tmp/test/${entry.path}`))
      } else {
        if (!fs.existsSync(`/tmp/test/${entry.path}`)) {
          fs.mkdirSync(`/tmp/test/${entry.path}`)
        }
        entry.autodrain()
      }
    })
    .promise()
    .then(() => console.log('done'), e => console.log('error', e))
}

const unzipperStream = async (filePath) => {
  console.log('STRATEGY: unzipperStream')
  const directory = await unzipper.Open.file(filePath)
  const promises = directory.files.map(file => {
    return new Promise((resolve, reject) => {
      if (file.type === 'Directory') {
        if (!fs.existsSync(`/tmp/test/${file.path}`)) {
          fs.mkdirSync(`/tmp/test/${file.path}`)
        }
        resolve()
        // try {
        // file.autodrain()
        // } catch (err) {
        //   console.log(err)
        //   console.log(file.path)
        // }
      } else {
        file
          .stream()
          .pipe(fs.createWriteStream(`/tmp/test/${file.path}`))
          .on('error', reject)
          .on('finish', resolve)
      }
    })
  })
  return Promise.all(promises).then(() => console.log('done'), e => console.log('error', e))
}

const yauzlStream = async (filePath) => {
  console.log('STRATEGY: yauzlStream')
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, function (err, zipFile) {
      if (err) reject(err)
      zipFile.readEntry()
      zipFile.on('entry', function (entry) {
        if (/\/$/.test(entry.fileName)) {
          if (!fs.existsSync(`/tmp/test/${entry.fileName}`)) {
            fs.mkdirSync(`/tmp/test/${entry.fileName}`)
          }
          zipFile.readEntry()
        } else {
          zipFile.openReadStream(entry, function (err, readStream) {
            if (err) throw err
            readStream.on('end', function () {
              zipFile.readEntry()
            })
            readStream.pipe(fs.createWriteStream(`/tmp/test/${entry.fileName}`))
          })
        }
      })
      zipFile.on('end', () => resolve())
      zipFile.on('error', (err) => reject(err))
    })
  })
}

const adm = async (filePath) => {
  const zip = new AdmZip(filePath)
  zip.extractAllTo('/tmp/test/', true)
}

function displayMemoryUsage () {
  const formatMemoryUsage = (data) => `${Math.round(data / 1024 / 1024 * 100) / 100} MB`
  const memoryData = process.memoryUsage()
  const memoryUsage = {
    rss: `${formatMemoryUsage(memoryData.rss)} -> Resident Set Size - total memory allocated for the process execution`,
    heapTotal: `${formatMemoryUsage(memoryData.heapTotal)} -> total size of the allocated heap`,
    heapUsed: `${formatMemoryUsage(memoryData.heapUsed)} -> actual memory used during the execution`,
    external: `${formatMemoryUsage(memoryData.external)} -> V8 external memory`
  }
  console.log('memoryUsage: ', memoryUsage)
}

const strategies = {
  unzipperBuffer,
  unzipperStream,
  yauzlStream,
  adm
}

async function main (strategy, filePath) {
  displayMemoryUsage()
  await strategies[strategy](filePath)
  displayMemoryUsage()
}

const strategy = argv.s || 'unzipperBuffer'
const filePath = argv.f || '/home/lostrego/Downloads/lesmiserables.zip'

main(strategy, filePath)
