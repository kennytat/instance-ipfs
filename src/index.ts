import * as fs from 'fs'
// import * as path from 'path'
import { exec, execSync, spawn} from 'child_process'
import PQueue from 'p-queue';
import M3U8FileParser from 'm3u8-file-parser';
// import * as CryptoJS from "crypto-js";
// import { slice } from 'ramda';
// import { create, globSource, CID } from 'ipfs-http-client'
// edit info here
const startPoint = 0; // start at 5652 next 
const endPoint = 1;
const fileType = 'video' // 'audio';
const quality = '480';
const VGM = 'VGMV'; // 'VGMA'
const prefix = '/home/vgm/Desktop'; // '/home/vgm/Desktop'; // execSync('pwd', {encoding: 'utf8'}).replace('\n',''); 
const queue = new PQueue({ concurrency: 2 });
const txtPath = `${prefix}/database/${VGM}Single.txt`;
const convertedPath = `VGM-Converted:vgmencrypted/encrypted/${VGM}`;
// const gateway = `https://cdn.vgm.tv/encrypted/${VGM}`;
const localTemp = `${prefix}/database/tmp` ; // `/mnt/6TBHDD/VGMDATA/${VGM}`  // `${prefix}/database/tmp`
// const originalTemp = `${prefix}/database/tmp`;
// const apiPath = `${prefix}/database/API/items/single`;
// const ipfsClient = create({ host: 'localhost', port: 9095 }) // http://ipfs-cluster-stackos.hjm.bid/ port: 80 localhost port:9095
// edit info end

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

// const checkFileIsFull = async (outPath) => {
//    return new Promise(async (resolve) => { 
//     const keyPath = `${outPath}/key.vgmk`;
//     const m3u8Path = `${outPath}/128p.m3u8`;
//     if (fs.existsSync(outPath) && fs.existsSync(keyPath) && fs.existsSync(m3u8Path)) {
//       const reader = new M3U8FileParser();
//       const segment = await fs.readFileSync(m3u8Path, { encoding: 'utf-8' });
//       reader.read(segment);
//       const m3u8 = reader.getResult();
//       for await (const segment of m3u8.segments) {
//         if (!fs.existsSync(`${outPath}/${segment.url}`)) {
//           resolve(false);
//           break;
//         }
//       }
//       resolve(true);
//     } else {
//       resolve(false);
//     }
//    })
// }

const downloadConverted = async (fileLocation, outPath) => {
  console.log('download converted file', `${convertedPath}/${fileLocation}/`, `${outPath}/`);
  return new Promise(async (resolve) => {
    // const startDownload = () => {
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
    // }
    // const fileIsFull = await checkFileIsFull(outPath);
    // console.log('fileIsFull:',fileIsFull);
      // if (fileIsFull) {
      //   resolve(true);
      // } else {
      //   startDownload();
      // }
  });
}

const uploadIPFS = async (dir) => {
      console.log('uploadIPFS', `${dir}`);
      return new Promise(async (resolve) => {
        // add folder to IPFS
        // let cid: CID;

        // for await (const file of ipfsClient.addAll(globSource(dir, '**/*'), { wrapWithDirectory: true })) {
        //   cid = file.cid;
        //   console.log('Hash:', cid);
        // }

        // if (cid) {
        //   resolve(cid);
        // }
        let cid;
        const ls = spawn('ipfs-cluster-ctl', ['add', '-r', '-Q', dir]);
        ls.stdout.on('data', (data) => {
          console.log(`got QMMM: ${data}`);
          if (data) {
            cid = data.toString().split('\n')[0];
          }
        });
        ls.on('close', (code) => {
          resolve(cid);
          console.log(`child process exited with code ${code}`);
        });
      });
    }

const processFile = async (file: string) => {
  console.log('processing:',file);
  return new Promise(async (resolve) => {
    // const jsonString = await fs.readFileSync(`${apiPath}/${file}.json`, { encoding: 'utf8' });
    // let fileInfo: any = JSON.parse(jsonString);
    // console.log('old file info', fileInfo);
    const cloudPath = file.replace(/\./g, '\/');
    const fileDir = `${localTemp}/${file}`; // `${localTemp}/${cloudPath}`; // `${localTemp}/${file}`;
    // const fileExist = await checkFileExists(cloudPath);
    const fileExist = await execSync(`rclone lsf '${convertedPath}/${cloudPath}/${quality}p.m3u8'`, {encoding: 'utf8'}) ? true : false; // if video 480p.m3u8 audio 128p.m3u8
    console.log('file Existtttt:',fileExist);
    
    if (fileExist) {
      await downloadConverted(cloudPath, fileDir);
      // await execSync(`bash mv-vgmx.sh "${fileDir}"`); // for audio only
      const cid:any = await uploadIPFS(fileDir);
      console.warn('cid from ipfs', cid);
      // fileInfo.qm = cid.toString();
      // const secretKey = slice(0, 32, `${fileInfo.url}gggggggggggggggggggggggggggggggg`);
      // fileInfo.hash = CryptoJS.AES.encrypt(fileInfo.qm, secretKey).toString();
      // console.log('updated fileInfo', fileInfo);
      if (cid) {
        // await fs.rmdirSync(fileDir, {recursive: true})
        resolve(cid)
      }
    } else {
      resolve(false);
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
        // list.reverse();
        console.log('total files', list.length);
        // let i = startPoint;
        for (let i = startPoint; i < endPoint; i++) { // list.length or endPoint
          (async () => {
            queue.add(async () => {
              const result = await processFile(list[i]);
              console.log('processed files', i);
              if (result) {
                await fs.appendFileSync(`${prefix}/database/${fileType}-inipfs-count.txt`, `\n${i}|${list[i]}|${result}`);
              } else {
                await fs.appendFileSync(`${prefix}/database/${fileType}-inipfs-count.txt`, `\n${i}-notfound: ${list[i]}`);
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