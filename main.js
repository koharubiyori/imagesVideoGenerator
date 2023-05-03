const path = require('path')
const fsPromise = require('fs/promises')
const childProcess = require('child_process')
const nodeCanvas = require('canvas')

const videoWidth = 1920
const videoHeight = 1088
const transitionDuration = 2000
const videoFrameRate = 30
const videoDuration = '0:20'

const inputsPath = './inputs'
const framesPath = './frames'

const canvas = nodeCanvas.createCanvas(videoWidth, videoHeight)
const ctx = canvas.getContext('2d')

ctxConfig(ctx)

/**
 * @param {nodeCanvas.CanvasRenderingContext2D} ctx 
 */
function ctxConfig(ctx) {
  ctx.patternQuality = 'best'
  ctx.quality = 'best'
}

async function main() {
  await clearFramesDir()

  const imgPaths = (await fsPromise.readdir(inputsPath))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(item => path.join(inputsPath, item))
  const [minutes, seconds] = videoDuration.split(':').map(item => parseInt(item))
  const totalDuration = (minutes * 60 + seconds) * 1000
  const singleImgDuration = Math.floor(totalDuration / imgPaths.length) - transitionDuration
  const totalFrames = totalDuration / 1000 * 30

  /**
   * 
   * @param {string} fileName 
   * @param {Buffer} data 
   * @returns {Promise<void>}
   */
  async function saveImg(fileName, data) {
    await fsPromise.writeFile(path.join(framesPath, fileName + '.png'), data)
    console.log(`生成帧：${fileName} / ${totalFrames}`)
  }

  let frameCount = 0

  const firstImg = await nodeCanvas.loadImage(imgPaths[0])
  const firstImgBuffer = image2buffer(firstImg)
  ctx.drawImage(firstImg, 0, 0)
  await framesCountGenerator(singleImgDuration + transitionDuration, videoFrameRate, async () => {
    await saveImg(++frameCount, firstImgBuffer)
  })

  for (let i=1, len=imgPaths.length; i < len; i++) {
    const currentImg = await nodeCanvas.loadImage(imgPaths[i])
    const prevImg = await nodeCanvas.loadImage(imgPaths[i - 1])
    const currentImgData = image2imageData(currentImg)

    await framesCountGenerator(transitionDuration, videoFrameRate, async (progress) => {
      const opacityModifiedImg = await imageData2image(withImgDataOpacity(currentImgData, progress))
      renderMiddleFrame(opacityModifiedImg, prevImg)
      const frameBuffer = canvas.toBuffer('image/png', { compressionLevel: 0 })
      await saveImg(++frameCount, frameBuffer)
    })

    ctx.drawImage(currentImg, 0, 0)
    const imgBuffer = image2buffer(currentImg)
    await framesCountGenerator(singleImgDuration, videoFrameRate, async () => {
      await saveImg(++frameCount, imgBuffer)
    })
  }

  // 使用最后一张图片补充因计算singleImgDuration时舍余取整导致的帧数不足
  if (frameCount < totalFrames) {
    const lastImgBuffer = await fsPromise.readFile(imgPaths[imgPaths.length - 1])
    while (frameCount < totalFrames) {
      await saveImg(++frameCount, lastImgBuffer)
    }
  }

  await joinToVideo()
}

main()

async function clearFramesDir() {
  return Promise.all(
    (await fsPromise.readdir(framesPath))
      .map(item => fsPromise.rm(path.join(framesPath, item)))
  )
}

/**
 * @param {nodeCanvas.Image} currentImg 
 * @param {nodeCanvas.Image} prevImg 
 */
function renderMiddleFrame(currentImg, prevImg) {
  ctx.clearRect(0, 0, videoWidth, videoHeight)
  ctx.drawImage(prevImg, 0, 0)
  ctx.drawImage(currentImg, 0, 0)
}

/**
 * @param {number} duration 
 * @param {number} frameRate 
 * @param {(process: number) => void} cb 
 */
async function framesCountGenerator(duration, frameRate, cb) {
  for (let i=1, len=Math.floor(duration * frameRate / 1000); i <= len; i++) {
    await cb(i / len)
  }
}

/**
 * @param {nodeCanvas.ImageData} imgData
 * @param {number} opacity
 * @returns {nodeCanvas.ImageData} 
 */

function withImgDataOpacity(imgData, opacity) {
  const newImgDataRawArr = []
  for (let i=0, len=imgData.data.length; i < len; i+=4) {
    newImgDataRawArr.push(imgData.data[i], imgData.data[i + 1], imgData.data[i + 2], Math.round(255 * opacity))
  }

  return nodeCanvas.createImageData(Uint8ClampedArray.from(newImgDataRawArr), videoWidth, videoHeight)
}


const [
  image2imageData, image2buffer, imageData2buffer,
] = (() => {
  const canvas = nodeCanvas.createCanvas(videoWidth, videoHeight)
  const ctx = canvas.getContext('2d')
  ctxConfig(ctx)

  /**
   * @param {nodeCanvas.Image} image
   * @returns {nodeCanvas.ImageData}
   */
  const image2imageData = image => {
    ctx.clearRect(0, 0, videoWidth, videoHeight)
    ctx.drawImage(image, 0, 0)
    return ctx.getImageData(0, 0, videoWidth, videoHeight)
  }

  /**
   * @param {nodeCanvas.Image} image
   * @returns {Buffer}
   */
  const image2buffer = image => {
    ctx.clearRect(0, 0, videoWidth, videoHeight)
    ctx.drawImage(image, 0, 0)
    return canvas.toBuffer()
  }

  /**
   * @param {nodeCanvas.ImageData} image
   * @returns {Buffer}
   */
  const imageData2buffer = imageData => {
    ctx.clearRect(0, 0, videoWidth, videoHeight)
    ctx.putImageData(imageData, 0, 0)
    return canvas.toBuffer()
  }

  return [image2imageData, image2buffer, imageData2buffer]
})()

/**
 * @param {nodeCanvas.ImageData} imageData 
 * @returns {Promise<nodeCanvas.Image>}
 */
function imageData2image(imageData) {
  return new Promise((resolve, reject) => {
    const image = new nodeCanvas.Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    
    image.src = imageData2buffer(imageData)
  })
}

function joinToVideo() {
  return new Promise(resolve => {
    const command = ['ffmpeg', '-r 30 -f image2 -s 1920x1088 -i ./frames/%d.png -vcodec libx264 -crf 10 -pix_fmt yuv420p result.mp4 -y'.split(' ')]
    const cpSpawn = childProcess.spawn(...command)
  
    cpSpawn.stdout.on('data', data => process.stdout.write(data.toString()))
    cpSpawn.stderr.on('data', data => process.stdout.write(data.toString()))

    cpSpawn.addListener('exit', () => {
      console.log('完毕！')
      resolve()
    })
  })
}