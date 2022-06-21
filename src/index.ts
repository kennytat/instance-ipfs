import * as fs from 'fs'
import 'dotenv/config'
import * as path from 'path'
import process from 'process';
import { exec, execSync, spawn } from 'child_process'
import PQueue from 'p-queue';
import M3U8FileParser from 'm3u8-file-parser';
import * as os from 'os';
// import * as CryptoJS from "crypto-js";
// import { slice } from 'ramda';
import bitwise from 'bitwise';
// import pRetry, { AbortError } from 'p-retry';
// import delay from 'delay';
// import { resolve } from 'path';

// edit info here
const args = process.argv.slice(2)
const fileType = args[0]; // 'audio' | 'video';
const concurrency = parseInt(args[1].replace('concurrency=', '')) || 1;
const startPoint = parseInt(args[2].replace('start=', ''));
const endPoint = parseInt(args[3].replace('end=', ''));
const VGM = fileType === 'audio' ? 'VGMA' : fileType === 'video' ? 'VGMV' : undefined; // 'VGMV' 'VGMA'
const queue = new PQueue({ concurrency: concurrency });
const txtPath = `${__dirname}/database/${fileType}Single.txt`;
const convertedPath = `converted-vgm-local:vgm-converted/encrypted/${VGM}`//`vgm-aliyun:vgm/output/${VGM}`;  // `VGM-Converted:vgmencrypted/encrypted/${VGM}`; 
// const mountedInput = `${__dirname}/database/mountedInput/${VGM}`; // `${__dirname}/database/mountedInput/${VGM}`;  `/mnt/ntfs/VGMEncrypted/${VGM}`   
const downloadTemp = `${os.tmpdir()}/${VGM}`; // `/home/vgm/Desktop/VGMEncrypted/${VGM}`  `/mnt/ntfs/VGMEncrypted/${VGM}`   `${__dirname}/database/tmp/${VGM}`;
const localTemp = os.tmpdir();
const ipfsGateway = 'http://ipfs.vgm.local:32095';
// edit info end


// const checkFileIsFull = async (outPath, fType) => {
// 	return new Promise(async (resolve) => {
// 		const keyPath = `${outPath}/key.vgmk`;
// 		const m3u8Path = fType === 'video' ? `${outPath}/480p.m3u8` : `${outPath}/128p.m3u8`;
// 		if (fs.existsSync(outPath) && fs.existsSync(keyPath) && fs.existsSync(m3u8Path)) {
// 			const reader = new M3U8FileParser();
// 			const segment = await fs.readFileSync(m3u8Path, { encoding: 'utf-8' });
// 			reader.read(segment);
// 			const m3u8 = reader.getResult();
// 			for await (const segment of m3u8.segments) {
// 				if (!fs.existsSync(`${outPath}/${segment.url}`)) {
// 					resolve(false);
// 					break;
// 				}
// 			}
// 			resolve(true);
// 		} else {
// 			resolve(false);
// 		}
// 	})
// }

const downloadConverted = async (fileLocation, outPath) => {
	console.log('download converted file', `${convertedPath}/${fileLocation}/`, `${outPath}/`);
	return new Promise(async (resolve) => {
		// const startDownload = () => {
		const rclone = spawn('rclone', ['copy', '--progress', `${convertedPath}/${fileLocation}/`, `${outPath}/`]);
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
		// const fileIsFull = await checkFileIsFull(outPath, fileType);
		// console.log('fileIsFull:', fileIsFull);
		// if (fileIsFull) {
		// 	resolve(true);
		// } else {
		// 	startDownload();
		// }
	});
}


const packCar = async (input, output) => {
	console.log('packing Car:', input, output);
	return new Promise(async (resolve, reject) => {
		if (!fs.existsSync(output)) {
			await execSync(`ipfs-car --wrapWithDirectory false --pack ${input} --output ${output}`);
			console.log('packed car done');
		}
		resolve(true);
	})
}


const uploadIPFS = async (carPath) => {
	console.log('uploadingIPFS:', carPath);
	console.time(path.parse(carPath).name)
	return new Promise(async (resolve) => {
		try {
			// add via dag import
			exec(`curl -X POST -F file=@${carPath} "${ipfsGateway}/api/v0/dag/import"`, async (err, stdout, stderr) => {
				if (stdout) {
					const cid = JSON.parse(stdout).Root.Cid["/"];
					console.timeEnd(path.parse(carPath).name)
					await fs.unlinkSync(carPath);
					resolve(cid.toString());
				}
				if (err) {
					console.timeEnd(path.parse(carPath).name)
					await fs.unlinkSync(carPath);
					resolve(false);
				}
			})

		} catch (error) {
			console.log(error);
		}

	});
}

const processFile = async (file: string, fType) => {
	console.log('processing:', file);
	return new Promise(async (resolve) => {
		try {
			const cloudPath = file.replace(/\./g, '\/');
			// // download from s3 to local
			const downloadTmpDir = `${downloadTemp}/${cloudPath}`; // `${localTemp}/${cloudPath}`; // `${localTemp}/${file}`;
			const downloaded = await downloadConverted(cloudPath, downloadTmpDir);
			// // // mounted directly from s3
			// const downloadTmpDir = `${mountedInput}/${cloudPath}`; 

			// get decrypted key hash and upload to ipfs
			// get iv info
			if (downloaded) {
				// // upload encrypted from car
				const encryptedCarPath = `${localTemp}/${path.basename(downloadTmpDir)}-encrypted.car`;
				await packCar(downloadTmpDir, encryptedCarPath);
				const encryptedCID: any = await uploadIPFS(encryptedCarPath);
				// decrypte key && edit m3u8
				let keyPath: string = fType === 'audio' ? `${downloadTmpDir}/128p.m3u8` : `${downloadTmpDir}/480p.m3u8`;
				const reader = new M3U8FileParser();
				const segment = await fs.readFileSync(keyPath, { encoding: 'utf-8' });
				reader.read(segment);
				const m3u8 = reader.getResult();
				const secret = `VGM-${m3u8.segments[0].key.iv.slice(0, 6).replace("0x", "")}`;
				const code = Buffer.from(secret);
				const key: Buffer = await fs.readFileSync(`${downloadTmpDir}/key.vgmk`);
				const encrypted = bitwise.buffer.xor(key, code, false);

				// // upload decrypted from car
				const decryptedTempDir = `${localTemp}/${path.basename(downloadTmpDir)}-decrypted`;
				const decryptedCarPath = `${localTemp}/${path.basename(downloadTmpDir)}-decrypted.car`;
				await execSync(`bash symlink.sh "${downloadTmpDir}" "${decryptedTempDir}"`);

				const keyTmpPath = `${decryptedTempDir}/key.vgmk`;
				await fs.writeFileSync(keyTmpPath, encrypted, { encoding: 'binary' });
				await packCar(decryptedTempDir, decryptedCarPath);
				await fs.rmSync(decryptedTempDir, { recursive: true })
				// then upload decrypted to ipfs
				const decryptedCID: any = await uploadIPFS(decryptedCarPath);
				if (encryptedCID && decryptedCID) {
					// // rm downloaded directory when finish - comment if keep
					await fs.rmSync(downloadTmpDir, { recursive: true })
					console.log('removed downloadTmpDir');
					resolve(`${encryptedCID.toString()}|${decryptedCID.toString()}`)
				}
				// resolve('done123')
			} else {
				resolve(false);
			}

		} catch (error) {
			resolve(false)
			console.log('error:', error);
		}
	})
};


// const processFile = async (file: string, fType) => {
//   return new Promise(async (resolve) => {
//     try {

//       const jsonString = await fs.readFileSync(`${apiPath}/${file}.json`, { encoding: 'utf8' });
//       let fileInfo: any = JSON.parse(jsonString);
//       const { url, hash } = fileInfo;
//       const decrypted = CryptoJS.AES.decrypt(hash, slice(0, 32, url + 'gggggggggggggggggggggggggggggggg'));
//       const ipfsCID = decrypted.toString(CryptoJS.enc.Utf8);
//       const result = await ipfsClient.pin.add(ipfsCID)

//       console.log(ipfsCID, result);

//       resolve(ipfsCID)
//     } catch (error) {
//       console.log(error);

//     }
//   })
// }

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
						console.log('Processing file:', list[i]);
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




// // pin pinata service

// const pinStart = async (hash) => {
//   return new Promise(async (resolve) => {

//     const url = `https://api.pinata.cloud/pinning/pinByHash`;
//     const body = {
//       hashToPin: hash,
//       hostNodes: [
//         '/ip4/131.153.50.133/tcp/4001/p2p/12D3KooWHN6Xw6jNWRc4buLcsmZguQssDtj2QKw92Cs5LyJy9ppo',
//       ]
//     };
//     axios.post(url, body, {
//       headers: {
//         pinata_api_key: '8dc31c935600e541668c',
//         pinata_secret_api_key: '592996b85be3c1476cb724de4a83062338f26efdcc9975371f933be1a8572495'
//       }
//     }).then(async function (response) {
//       console.log('res:', response.status);
//       resolve(response.status);
//       //handle response here
//     }).catch(async function (error) {
//       console.log(`Server error: ${error.response.status} pausing for 3 minute`);
//       resolve(error.response.status);
//     });
//   })
// }


// const main = async () => {
//   // start script here
//   const raw = fs.readFileSync('/home/vgm/Desktop/speaker-hash.txt', { encoding: 'utf8' });
//   if (raw) {
//     let list = raw.split('\n');
//     list.pop();
//     console.log('total files', list.length);
//     const listLength = endPoint ? endPoint : list.length;
//     for (let i = startPoint; i < listLength; i++) { // list.length or endPoint
//       (async () => {
//         queue.add(async () => {
//           try {
//             await delay(1000);
//             console.log('processing:', i, list[i]);
//             // const result = await pinByHash(list[i]);
//             const pinByHash = async () => {
//               const result: any = await pinStart(list[i]);
//               if (result !== 200) {
//                 await delay(300000);
//                 throw new AbortError('SERVER ERROR: retying in 5 minute');
//               }
//               return result;
//             };
//             const result: any = await pRetry(await pinByHash, { retries: 3 });
//             if (result) {
//               await fs.appendFileSync(`${__dirname}/database/${fileType}-pinata-count.txt`, `\n${i}|${list[i]}`);
//             } else {
//               await fs.appendFileSync(`${__dirname}/database/${fileType}-pinata-count.txt`, `\n${i}|error`);
//             }
//           } catch (error) {
//             console.log(error);
//           }
//         });
//       })();
//     }
//   }
// }


main();
