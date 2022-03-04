import * as fs from 'fs'
import 'dotenv/config'
import * as path from 'path'
import process from 'process';
import { exec, execSync, spawn } from 'child_process'
import PQueue from 'p-queue';
import M3U8FileParser from 'm3u8-file-parser';
import * as CryptoJS from "crypto-js";
import { slice } from 'ramda';
import bitwise from 'bitwise';
import Blob from 'blob';
// import { create, globSource, CID } from 'ipfs-http-client'
import { packToFs } from 'ipfs-car/pack/fs'
import { NFTStorage, File } from 'nft.storage'
import { Web3Storage, getFilesFromPath } from 'web3.storage'
// import * as mime from 'mime'

// edit info here
const args = process.argv.slice(2)
const startPoint = parseInt(args[0]);
const endPoint = parseInt(args[1]);;
const fileType = 'video' // 'audio';
const VGM = 'VGMV'; // 'VGMA'
// const quality = '480';
// const prefix = '/home/vgm/Desktop'; // '/home/vgm/Desktop'; // execSync('pwd', {encoding: 'utf8'}).replace('\n',''); 
const queue = new PQueue({ concurrency: 2 });
const txtPath = `${__dirname}/database/${fileType}Single.txt`;
const convertedPath = `VGM-Converted:vgmencrypted/encrypted/${VGM}`;
const localTemp = `${__dirname}/database/tmp/${VGM}`;; // `/home/vgm/Desktop/VGMEncrypted/${VGM}`  `/mnt/ntfs/VGMEncrypted/${VGM}`   `${__dirname}/database/tmp/${VGM}`;
const apiPath = `${__dirname}/database/API-convert/items/single`;
// const gateway = `https://cdn.vgm.tv/encrypted/${VGM}`;
// const originalTemp = `${prefix}/database/tmp`;
// edit info end


// initiate ipfs storage connection
// const ipfsClient = create({ host: 'localhost', port: 9095 }) // http://ipfs-cluster-stackos.hjm.bid/ port: 80 localhost port:9095
// test nft storage
// import { getFilesFromPath } from 'web3.storage'
const web3Token = process.env.WEB3_TOKEN as string;
const web3Storage = new Web3Storage({ token: web3Token });
const nftToken = process.env.NFT_TOKEN as string;
const nftStorage = new NFTStorage({ token: nftToken })

import { createReadStream } from 'fs'
import { CarReader } from '@ipld/car'


// const checkFileExists = async (fileUrl) => {
//       return new Promise((resolve) => {
//         const url = `${gateway}/${fileUrl}/${quality}p.m3u8`; // if video 480p.m3u8 audio 128p.m3u8
//         console.log('checking url:', url);

//         // // check thumb url
//         exec(`curl --silent --head --fail ${url}`, async (error, stdout, stderr) => {
//           if (error) {
//             console.log('file exist:', false);
//             await fs.appendFileSync(`${prefix}/database/${fileType}-inipfs-count.txt`, `\n${url} --fileMissing`);
//             resolve(false)
//           };
//           if (stderr) console.log('stderr', stderr);
//           if (stdout) {
//             console.log('file exist:', true);
//             // await fs.appendFileSync(`${prefix}/database/${fileType}-converted-count.txt`, `\n${url} --fileExist`);
//             resolve(true);
//           };
//         });
//       });
//     }

const checkFileIsFull = async (outPath, fType) => {
  return new Promise(async (resolve) => {
    const keyPath = `${outPath}/key.vgmk`;
    const m3u8Path = fType === 'video' ? `${outPath}/480p.m3u8` : `${outPath}/128p.m3u8`;
    if (fs.existsSync(outPath) && fs.existsSync(keyPath) && fs.existsSync(m3u8Path)) {
      const reader = new M3U8FileParser();
      const segment = await fs.readFileSync(m3u8Path, { encoding: 'utf-8' });
      reader.read(segment);
      const m3u8 = reader.getResult();
      for await (const segment of m3u8.segments) {
        if (!fs.existsSync(`${outPath}/${segment.url}`)) {
          resolve(false);
          break;
        }
      }
      resolve(true);
    } else {
      resolve(false);
    }
  })
}

const downloadConverted = async (fileLocation, outPath) => {
  console.log('download converted file', `${convertedPath}/${fileLocation}/`, `${outPath}/`);
  return new Promise(async (resolve) => {
    const startDownload = () => {
      const rclone = spawn('rclone', ['copy', '--progress', '--no-update-modtime', `${convertedPath}/${fileLocation}/`, `${outPath}/`]);
      rclone.stdout.on('data', async (data) => {
        console.log(`rclone download converted stdout: ${data}`);
      });
      rclone.stderr.on('data', async (data) => {
        console.log(`Stderr: ${data}`);
      });
      rclone.on('close', async (code) => {
        console.log(`download converted file done with code:`, code);
        resolve(true);
      })
    }
    const fileIsFull = await checkFileIsFull(outPath, fileType);
    console.log('fileIsFull:', fileIsFull);
    if (fileIsFull) {
      resolve(true);
    } else {
      startDownload();
    }
  });
}


// // ipfs Storage store CAR function
async function storeCarFile(filename) {
  const inStream = createReadStream(filename)
  const car = await CarReader.fromIterable(inStream)
  return car;
}


const uploadIPFS = async (input) => {
  console.log('uploadingIPFS:', `${input}`);
  return new Promise(async (resolve) => {
    console.time(path.parse(input).name)
    let nftCID;
    let web3CID;
    if (path.extname(input) === '.vgmk') {
      // store file
      const content = await fs.promises.readFile(input);
      const keyFile = new File([content], path.basename(input));
      web3CID = await web3Storage.put([keyFile], { wrapWithDirectory: false })
      console.log('WEB3 key res:', web3CID);
      fs.rmSync(input, { recursive: true, force: true });
    } else {
      // store folder
      await packToFs({
        input: input,
        output: `${input}.car`,
        wrapWithDirectory: false
      })
      const car = await storeCarFile(`${input}.car`);
      nftCID = await nftStorage.storeCar(car);
      console.log('cid from NFT:', nftCID);
      web3CID = await web3Storage.putCar(car);
      console.log('cid from WEB3:', web3CID);
      const status = await nftStorage.status(nftCID)
      console.log(status)
      fs.rmSync(`${input}.car`, { recursive: true, force: true });
    }
    if (web3CID) {
      console.timeEnd(path.parse(input).name)
      resolve(web3CID)
    }



    // add folder to IPFS
    // let cid: CID;

    // for await (const file of ipfsClient.addAll(globSource(dir, '**/*'), { wrapWithDirectory: true })) {
    //   cid = file.cid;
    //   console.log('Hash:', cid);
    // }

    // if (cid) {
    //   resolve(cid);
    // }
    // let cid;
    // const ls = spawn('ipfs-cluster-ctl', ['add', '-r', '-Q', dir]); // 'ipfs', ['--api', '/ip4/127.0.0.1/tcp/9095', 'add', '-r', '--local','-Q', dir] // 'ipfs-cluster-ctl', ['add', '-r', '--local','-Q', dir]
    // ls.stdout.on('data', (data) => {
    //   console.log(`got QMMM: ${data}`);
    //   if (data) {
    //     cid = data.toString().split('\n')[0];
    //   }
    // });
    // ls.stdout.on('error', (err) => {
    //   console.log(`upload IPFS Error: ${err}`);
    // });
    // ls.on('close', (code) => {
    //   console.log(`child process exited with code ${code}`);
    //   resolve(cid);
    // });

  });
}

const processFile = async (file: string, fType) => {
  console.log('processing:', file);
  return new Promise(async (resolve) => {
    try {
      const jsonString = await fs.readFileSync(`${apiPath}/${file}.json`, { encoding: 'utf8' });
      let fileInfo: any = JSON.parse(jsonString);
      console.log('old file info', fileInfo);
      const cloudPath = file.replace(/\./g, '\/');
      const downloadTmpDir = `${localTemp}/${cloudPath}`; // `${localTemp}/${cloudPath}`; // `${localTemp}/${file}`;
      await downloadConverted(cloudPath, downloadTmpDir);

      // get decrypted key hash and upload to ipfs
      // get iv info
      const reader = new M3U8FileParser();
      let keyPath: string = fType === 'audio' ? `${downloadTmpDir}/128p.m3u8` : `${downloadTmpDir}/480p.m3u8`;
      const segment = await fs.readFileSync(keyPath, { encoding: 'utf-8' });
      reader.read(segment);
      const m3u8 = reader.getResult();
      const secret = `VGM-${m3u8.segments[0].key.iv.slice(0, 6).replace("0x", "")}`;
      // get buffer from key and iv
      const code = Buffer.from(secret);
      const key: Buffer = await fs.readFileSync(`${downloadTmpDir}/key.vgmk`);
      const encrypted = bitwise.buffer.xor(key, code, false);
      const keyTmpPath = `${__dirname}/database/tmp/${file}.vgmk`;
      await fs.writeFileSync(keyTmpPath, encrypted, { encoding: 'binary' });
      const kHash: any = await uploadIPFS(keyTmpPath);
      fileInfo.khash = kHash.toString();
      // console.log('decrypted key hash:', fileInfo.khash);

      // const decrypted = CryptoJS.AES.decrypt(fileInfo.khash,  slice(0, 32, fileInfo.url + 'gggggggggggggggggggggggggggggggg'));
      // const decryptedKeyHash = decrypted.toString(CryptoJS.enc.Utf8);
      // console.log(`bash edit-m3u8-key.sh "${downloadTmpDir}" '${fileType}' '${fileInfo.khash}'`);
      await execSync(`bash edit-m3u8-key.sh "${downloadTmpDir}" '${fileType}' '${fileInfo.khash}'`);
      const cid: any = await uploadIPFS(downloadTmpDir);
      // console.log('cid from ipfs:', cid);
      fileInfo.qm = cid.toString();
      const secretKey = slice(0, 32, `${fileInfo.url}gggggggggggggggggggggggggggggggg`);
      fileInfo.hash = CryptoJS.AES.encrypt(fileInfo.qm, secretKey).toString();
      console.log('updated fileInfo:', fileInfo);
      if (kHash && cid) {
        // // rm downloaded directory when finish - comment if keep
        await fs.rmdirSync(downloadTmpDir, { recursive: true })
        resolve(`${kHash}|${cid}`)
      }
    } catch (error) {
      resolve(false)
      console.log('error:', error);
    }
  })
};

const main = async () => {
  try {
    // start script here
    const raw = fs.readFileSync(txtPath, { encoding: 'utf8' });
    if (raw) {
      let list = raw.split('\n');
      list.pop();
      console.log('total files', list.length);
      const listLength = endPoint ? endPoint : list.length;
      for (let i = startPoint; i < listLength; i++) { // list.length or endPoint
        (async () => {
          queue.add(async () => {
            const start = new Date();
            const startTime = start.getFullYear() + '-' + (start.getMonth() + 1) + '-' + start.getDate() + '|' + start.getHours() + ":" + start.getMinutes() + ":" + start.getSeconds();
            const result = await processFile(list[i], fileType);
            const end = new Date();
            const endTime = end.getFullYear() + '-' + (end.getMonth() + 1) + '-' + end.getDate() + '|' + end.getHours() + ":" + end.getMinutes() + ":" + end.getSeconds();
            //   console.log('processed files', i, dateTime);
            if (result) {
              await fs.appendFileSync(`${__dirname}/database/${fileType}-ipfs-count.txt`, `\n${i}|${list[i]}|${result}|${startTime}|${endTime}`);
            } else {
              await fs.appendFileSync(`${__dirname}/database/${fileType}-ipfs-count.txt`, `\n${i}|notfound|${list[i]}`);
            }
          });
        })();
      }
    }
  } catch (error) {
    console.log(error);
  }
}



main();